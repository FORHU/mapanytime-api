import OrderRepository from './order.repository';
import ProductRepository from '../products/product.repository';
import { prisma } from '../../utils/prisma';
import { emitNotificationToUser } from '../../infrastructure/socket';
import { PAYMENTMETHOD, FULLFILLMENTTYPE, ORDERSTATUS } from '@prisma/client';

export default class OrderService {
  static async createOrder(payload: {
    buyerId: string;
    storeId: string;
    type: FULLFILLMENTTYPE;
    paymentMethod: PAYMENTMETHOD;
    pickupAt?: Date;
    items: { productId: string; quantity: number }[];
  }) {
    const order = await prisma.$transaction(async (tx) => {
      const store = await tx.stores.findUnique({
        where: { id: payload.storeId },
      });

      if (!store) {
        throw { status: 404, message: 'Store not found.' };
      }
      if (!store.isActive) {
        throw {
          status: 400,
          message: `Store ${store.storeName} is currently inactive and cannot accept orders.`,
        };
      }

      let totalAmount = 0;
      const orderItemsData = [];

      for (const item of payload.items) {
        const product = await tx.products.findUnique({
          where: { id: item.productId },
          include: { inventory: true },
        });

        if (!product) throw new Error(`Product with ID ${item.productId} not found.`);
        if (!product.isActive)
          throw new Error(`Product ${product.name} is currently inactive and cannot be ordered.`);
        if (product.storeId !== payload.storeId)
          throw new Error(`Product ${product.name} does not belong to the selected store.`);

        const inventory = product.inventory[0];
        if (!inventory) throw new Error(`Inventory record missing for ${product.name}.`);

        const availableStock = inventory.quantityOnHand - inventory.quantityReserved;
        if (availableStock < item.quantity) {
          throw new Error(`Insufficient stock for ${product.name}. Only ${availableStock} left.`);
        }

        const numericPrice = Number(product.price);
        const itemTotal = numericPrice * item.quantity;
        totalAmount += itemTotal;

        orderItemsData.push({
          productId: product.id,
          productName: product.name,
          quantity: item.quantity,
          unitPrice: product.price,
        });

        await tx.inventory.update({
          where: { id: inventory.id },
          data: {
            quantityReserved: { increment: item.quantity },
          },
        });
      }

      const orderData = {
        buyerId: payload.buyerId,
        storeId: payload.storeId,
        totalAmount,
        type: payload.type,
        pickupAt: payload.pickupAt ?? null,
        status: 'PENDING' as const,
        orderitems: {
          create: orderItemsData,
        },
        payment: {
          create: {
            amount: totalAmount,
            paymentMethod: payload.paymentMethod,
            status: 'PENDING' as const,
          },
        },
      };

      return OrderRepository.insertOrder(orderData, tx);
    });

    try {
      const [store, buyer] = await Promise.all([
        prisma.stores.findUnique({
          where: { id: order.storeId },
          include: { seller: { select: { userId: true } } },
        }),
        prisma.buyers.findUnique({
          where: { id: order.buyerId },
          select: { userId: true },
        }),
      ]);

      if (store?.seller?.userId) {
        emitNotificationToUser(store.seller.userId, {
          id: order.id,
          title: 'New order',
          body: `You have a new order worth ₱${order.totalAmount.toLocaleString()}.`,
          metadata: { orderId: order.id, storeId: order.storeId, type: 'ORDER_CREATED' },
          sentAt: new Date().toISOString(),
        });
      }

      if (buyer?.userId) {
        emitNotificationToUser(buyer.userId, {
          id: order.id,
          title: 'Order Placed',
          body: `Your order #${order.id.slice(0, 8).toUpperCase()} has been placed successfully.`,
          metadata: { orderId: order.id, storeId: order.storeId, type: 'ORDER_CREATED' },
          sentAt: new Date().toISOString(),
        });
      }
    } catch {
      // Swallow — notification delivery is non-critical.
    }

    return order;
  }

  static async completeOrder(userId: string, orderId: string, storeId: string) {
    const seller = await ProductRepository.getSellerByUserId(userId);
    if (!seller || seller.applicationStatus !== 'APPROVED') {
      throw { status: 403, message: 'User is not an approved seller profile.' };
    }

    const store = await ProductRepository.getStoreById(storeId);
    if (!store || store.sellerId !== seller.id) {
      throw { status: 403, message: 'You do not have administrative access to this branch.' };
    }

    return prisma.$transaction(async (tx) => {
      const order = await OrderRepository.getOrderById(orderId, tx);

      if (!order) throw new Error('Order not found.');
      if (order.storeId !== storeId) throw new Error('Unauthorized store fulfillment.');
      if (order.status === 'COMPLETED') throw new Error('Order is already completed.');
      if (order.status === 'CANCELLED' || order.status === 'FAILED') {
        throw new Error(`Cannot complete a ${order.status.toLowerCase()} order.`);
      }

      const payment = await tx.payments.findFirst({
        where: { orderId: orderId },
        orderBy: { createdAt: 'desc' },
      });

      if (!payment) {
        throw new Error('No payment record found for this order.');
      }

      if (payment.status !== 'COMPLETED' && payment.paymentMethod !== 'CASH_ON_DELIVERY') {
        await tx.payments.update({
          where: { id: payment.id },
          data: { status: 'COMPLETED' },
        });
      }

      for (const item of order.orderitems) {
        const inventory = await tx.inventory.findFirst({
          where: { productId: item.productId },
        });

        if (!inventory)
          throw new Error(`Inventory tracking ledger missing for product ID ${item.productId}.`);

        await tx.inventory.update({
          where: { id: inventory.id },
          data: {
            quantityOnHand: { decrement: item.quantity },
            quantityReserved: { decrement: item.quantity },
          },
        });

        await tx.products.update({
          where: { id: item.productId },
          data: {
            totalSold: { increment: item.quantity },
          },
        });
      }

      return OrderRepository.updateOrderStatus(orderId, 'COMPLETED', 'COMPLETED', tx);
    });
  }

  static async cancelOrder(userId: string, orderId: string) {
    const buyer = await prisma.buyers.findUnique({
      where: { userId: userId },
    });

    if (!buyer) {
      throw { status: 403, message: 'Only registered buyers can cancel orders.' };
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const order = await OrderRepository.getOrderById(orderId, tx);

        if (!order) throw new Error('Order not found.');
        if (order.buyerId !== buyer.id) throw new Error('Unauthorized. You do not own this order.');
        if (order.status !== 'PENDING')
          throw new Error(`Cannot cancel an order with status: ${order.status}.`);

        for (const item of order.orderitems) {
          const inventory = await tx.inventory.findFirst({
            where: { productId: item.productId },
          });

          if (!inventory)
            throw new Error(`Inventory tracking ledger missing for product ID ${item.productId}.`);

          await tx.inventory.update({
            where: { id: inventory.id },
            data: {
              quantityReserved: { decrement: item.quantity },
            },
          });
        }

        return OrderRepository.updateOrderStatus(orderId, 'CANCELLED', 'FAILED', tx);
      });
    } catch (error) {
      const err = error as Error;
      throw { status: 400, message: err.message };
    }
  }

  static async getMyOrders(userId: string) {
    let buyer = await prisma.buyers.findUnique({
      where: { userId: userId },
    });

    if (!buyer) {
      const user = await prisma.users.findUnique({ where: { id: userId } });
      const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Buyer';
      buyer = await prisma.buyers.create({
        data: { userId: userId, displayName },
      });
    }

    return OrderRepository.getOrdersByBuyerId(buyer.id);
  }

  static async getStoreOrders(userId: string, storeId?: string) {
    const seller = await prisma.sellers.findUnique({
      where: { userId: userId },
      include: { stores: true },
    });

    if (!seller) {
      throw { status: 403, message: 'Only registered sellers can view store orders.' };
    }

    const sellerStoreIds = seller.stores.map((s) => s.id);

    if (!storeId || storeId === 'ALL') {
      return OrderRepository.getOrdersByStoreIds(sellerStoreIds);
    }

    if (!sellerStoreIds.includes(storeId)) {
      throw { status: 403, message: 'Unauthorized store access.' };
    }

    return OrderRepository.getOrdersByStoreId(storeId);
  }

  static async updateFulfillmentStatus(userId: string, orderId: string, inputStatus: string) {
    const statusUpper = (inputStatus || '').toUpperCase();
    let normalizedStatus: ORDERSTATUS;

    if (['PREPARING', 'PROCESSING'].includes(statusUpper)) {
      normalizedStatus = 'PROCESSING';
    } else if (['READY_FOR_PICKUP', 'READY'].includes(statusUpper)) {
      normalizedStatus = 'READY_FOR_PICKUP';
    } else if (['COMPLETED', 'PICKED_UP', 'SHIPPED', 'FULFILLED'].includes(statusUpper)) {
      normalizedStatus = 'COMPLETED';
    } else if (['CANCELLED', 'CANCELED'].includes(statusUpper)) {
      normalizedStatus = 'CANCELLED';
    } else {
      throw {
        status: 400,
        message: `Invalid status '${inputStatus}'. Allowed: PREPARING, READY_FOR_PICKUP, COMPLETED, CANCELLED`,
      };
    }

    const order = await prisma.orders.findUnique({
      where: { id: orderId },
      include: { buyer: true },
    });
    if (!order) throw { status: 404, message: 'Order not found.' };

    if (normalizedStatus === 'COMPLETED') {
      return this.completeOrder(userId, orderId, order.storeId);
    }
    if (normalizedStatus === 'CANCELLED') {
      return this.cancelOrder(userId, orderId);
    }

    const seller = await prisma.sellers.findUnique({ where: { userId } });
    if (!seller) throw { status: 403, message: 'Only registered sellers can update order status.' };
    const store = await prisma.stores.findUnique({ where: { id: order.storeId } });
    if (!store || store.sellerId !== seller.id) {
      throw { status: 403, message: 'Unauthorized. You do not own the store for this order.' };
    }

    const updated = await OrderRepository.updateOrderStatus(orderId, normalizedStatus);

    try {
      const titles: Record<string, string> = {
        PROCESSING: 'Order is being prepared',
        READY_FOR_PICKUP: 'Order is ready for pickup!',
      };
      const title = titles[normalizedStatus] || `Order status updated to ${normalizedStatus}`;
      emitNotificationToUser(order.buyer.userId, {
        id: orderId,
        title,
        body: `Your order status changed to ${normalizedStatus.replace(/_/g, ' ')}.`,
        metadata: { orderId, status: normalizedStatus, type: 'ORDER_UPDATED' },
        sentAt: new Date().toISOString(),
      });
    } catch {
      // non-critical socket emission
    }

    return updated;
  }
}
