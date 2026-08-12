import OrderRepository from './order.repository';
import ProductRepository from '../products/product.repository';
import TaxationService from '../taxation/taxation.service';
import { validateOrderTransition } from './order.state';
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
        include: {
          storeLocations: true,
          seller: { include: { users: true } },
        },
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

      // Snapshot merchant info at order time so receipts are immutable
      const loc = store.storeLocations;
      const storeAddressSnapshot = loc
        ? [loc.currentAddress, loc.city, loc.province, loc.country].filter(Boolean).join(', ')
        : null;
      const sellerPhoneSnapshot = store.phone ?? store.seller?.users?.phoneNumber ?? null;
      const storeEmailSnapshot = store.email ?? store.seller?.users?.email ?? null;

      let subtotalAmount = 0;
      let totalDiscount = 0;
      const orderItemsData = [];
      let primaryCategoryId: string | undefined;

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

        if (!primaryCategoryId && product.categoryId) {
          primaryCategoryId = product.categoryId;
        }

        const inventory = product.inventory[0];
        if (!inventory) throw new Error(`Inventory record missing for ${product.name}.`);

        const availableStock = inventory.quantityOnHand - inventory.quantityReserved;
        if (availableStock < item.quantity) {
          throw new Error(`Insufficient stock for ${product.name}. Only ${availableStock} left.`);
        }

        const numericPrice = Number(product.price);
        const itemTotal = numericPrice * item.quantity;
        subtotalAmount += itemTotal;

        // Buy-X-take-Y (e.g. buy 1 take 1): find an active ad linking this
        // product to a BOGO rule for this store, and give away the free
        // units. variantId is left out — cart items are product-only today.
        const bogoLink = await tx.merchantAdProducts.findFirst({
          where: {
            productId: item.productId,
            ad: {
              storeId: payload.storeId,
              isActive: true,
              buyQuantity: { not: null },
              freeQuantity: { not: null },
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
          },
          include: { ad: true },
        });
        const bogoAd = bogoLink?.ad;

        let itemDiscount = 0;
        let appliedAdId: string | null = null;
        if (bogoAd && bogoAd.buyQuantity && bogoAd.freeQuantity) {
          // Bundle size is buy+free (e.g. "buy 1 take 1" = pay for 1, get 2
          // total per bundle) — dividing by buyQuantity alone would give
          // away a free unit for every single unit bought, not every pair.
          const bundleSize = bogoAd.buyQuantity + bogoAd.freeQuantity;
          const freeUnits = Math.min(
            item.quantity,
            Math.floor(item.quantity / bundleSize) * bogoAd.freeQuantity,
          );
          if (freeUnits > 0) {
            itemDiscount = freeUnits * numericPrice;
            appliedAdId = bogoAd.id;
          }
        }
        totalDiscount += itemDiscount;

        orderItemsData.push({
          productId: product.id,
          productName: product.name,
          quantity: item.quantity,
          unitPrice: product.price,
          discountAmount: itemDiscount,
          appliedAdId,
        });

        await tx.inventory.update({
          where: { id: inventory.id },
          data: {
            quantityReserved: { increment: item.quantity },
          },
        });

        await tx.inventoryReservations.create({
          data: {
            inventoryId: inventory.id,
            buyerId: payload.buyerId,
            quantity: item.quantity,
            status: 'RESERVED',
            expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15-minute TTL
          },
        });
      }

      // Calculate taxation, commission, and financial breakdown
      const financials = await TaxationService.calculateOrderFinancials({
        subtotalAmount,
        categoryId: primaryCategoryId,
        discountAmount: totalDiscount,
      });

      const orderData = {
        buyerId: payload.buyerId,
        storeId: payload.storeId,
        storeName: store.storeName,
        storeAddressSnapshot,
        sellerPhoneSnapshot,
        storeEmailSnapshot,
        totalAmount: financials.totalAmount,
        subtotalAmount: financials.subtotalAmount,
        discountAmount: financials.discountAmount,
        taxAmount: financials.taxAmount,
        marketplaceFeeAmount: financials.marketplaceFeeAmount,
        sellerNetAmount: financials.sellerNetAmount,
        type: payload.type,
        pickupAt: payload.pickupAt ?? null,
        status: 'PENDING' as const,
        orderitems: {
          create: orderItemsData,
        },
        payment: {
          create: {
            amount: financials.totalAmount,
            paymentMethod: payload.paymentMethod,
            status: 'PENDING' as const,
          },
        },
      };

      const createdOrder = await OrderRepository.insertOrder(orderData, tx);

      // Link newly created reservations to the order
      await tx.inventoryReservations.updateMany({
        where: {
          buyerId: payload.buyerId,
          orderId: null,
          status: 'RESERVED',
        },
        data: {
          orderId: createdOrder.id,
        },
      });

      return createdOrder;
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

      validateOrderTransition(order.status, 'COMPLETED');

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

      await tx.inventoryReservations.updateMany({
        where: { orderId: orderId, status: 'RESERVED' },
        data: { status: 'CONSUMED' },
      });

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

        validateOrderTransition(order.status, 'CANCELLED');

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

        await tx.inventoryReservations.updateMany({
          where: { orderId: orderId, status: 'RESERVED' },
          data: { status: 'RELEASED' },
        });

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

    validateOrderTransition(order.status, normalizedStatus);

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
