import OrderRepository from '../repositories/order.repository';
import ProductRepository from '../repositories/product.repository';
import { prisma } from '../utils/prisma';
import { emitNotificationToUser } from '../infrastructure/socket';

export default class OrderService {
  static async createOrder(payload: {
    buyerId: string;
    storeId: string;
    type: 'DELIVERY' | 'PICKUP';
    paymentMethod: 'BANK' | 'GCASH' | 'CASH_ON_DELIVERY';
    items: { productId: string; quantity: number }[];
  }) {
    // The Service initiates the transaction to secure the logic phase
    const order = await prisma.$transaction(async (tx) => {
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

        const itemTotal = product.price * item.quantity;
        totalAmount += itemTotal;

        orderItemsData.push({
          productId: product.id,
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

      // Construct the raw data object to pass to the repository
      const orderData = {
        buyerId: payload.buyerId,
        storeId: payload.storeId,
        totalAmount,
        type: payload.type,
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

    // After commit: push a realtime "new order" notification to the seller who
    // owns the store. Best-effort — a socket failure must not fail the order.
    try {
      const store = await prisma.stores.findUnique({
        where: { id: order.storeId },
        include: { seller: { select: { userId: true } } },
      });
      if (store?.seller?.userId) {
        emitNotificationToUser(store.seller.userId, {
          id: order.id,
          title: 'New order',
          body: `You have a new order worth ₱${order.totalAmount.toLocaleString()}.`,
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
    // Fetch the seller using the optimized repository method
    const seller = await ProductRepository.getSellerByUserId(userId);
    if (!seller || seller.applicationStatus !== 'APPROVED') {
      throw { status: 403, message: 'User is not an approved seller profile.' };
    }

    // Fetch the store and verify ownership using a direct foreign key check
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

      // Payment Validation
      const payment = await tx.payments.findFirst({
        where: { orderId: orderId },
        orderBy: { createdAt: 'desc' },
      });

      if (!payment) {
        throw new Error('No payment record found for this order.');
      }

      if (payment.status !== 'COMPLETED') {
        throw new Error(`Cannot fulfill order. Payment status is currently: ${payment.status}.`);
      }

      for (const item of order.orderitems) {
        const inventory = await tx.inventory.findUnique({
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
          const inventory = await tx.inventory.findUnique({
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
}
