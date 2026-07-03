import { prisma } from '../utils/prisma';

export default class OrderRepository {
  static async createOrder(data: {
    buyerId: string;
    storeId: string;
    type: 'DELIVERY' | 'PICKUP';
    paymentMethod: 'BANK' | 'GCASH' | 'CASH_ON_DELIVERY';
    items: { productId: string; quantity: number }[];
  }) {
    return prisma.$transaction(async (tx) => {
      let totalAmount = 0;
      const orderItemsData = [];

      for (const item of data.items) {
        const product = await tx.products.findUnique({
          where: { id: item.productId },
          include: { inventory: true },
        });

        if (!product) {
          throw new Error(`Product with ID ${item.productId} not found.`);
        }

        if (!product.isActive) {
          throw new Error(`Product ${product.name} is currently inactive and cannot be ordered.`);
        }

        if (product.storeId !== data.storeId) {
          throw new Error(`Product ${product.name} does not belong to the selected store.`);
        }

        const inventory = product.inventory[0];
        if (!inventory) {
          throw new Error(`Inventory record missing for ${product.name}.`);
        }

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

      const order = await tx.orders.create({
        data: {
          buyerId: data.buyerId,
          storeId: data.storeId,
          totalAmount,
          type: data.type,
          status: 'PENDING',
          orderitems: {
            create: orderItemsData,
          },
          payment: {
            create: {
              amount: totalAmount,
              paymentMethod: data.paymentMethod,
              status: 'PENDING',
            },
          },
        },
        include: {
          orderitems: true,
          payment: true,
        },
      });

      return order;
    });
  }

  static async completeOrder(orderId: string, storeId: string) {
    return prisma.$transaction(async (tx) => {
      // Fetch the order and its items to verify ownership and contents
      const order = await tx.orders.findUnique({
        where: { id: orderId },
        include: { orderitems: true, payment: true },
      });

      if (!order) throw new Error('Order not found.');
      if (order.storeId !== storeId) throw new Error('Unauthorized store fulfillment.');
      if (order.status === 'COMPLETED') throw new Error('Order is already completed.');
      if (order.status === 'CANCELLED' || order.status === 'FAILED') {
        throw new Error(`Cannot complete a ${order.status.toLowerCase()} order.`);
      }

      // Loop through the items to process stock updates and metrics
      for (const item of order.orderitems) {
        // Fetch inventory row for this specific product/store combo
        const inventory = await tx.inventory.findUnique({
          where: { productId: item.productId },
        });

        if (!inventory) {
          throw new Error(`Inventory tracking ledger missing for product ID ${item.productId}.`);
        }

        // Hard deduct from physical stock and release the placeholder reservation
        await tx.inventory.update({
          where: { id: inventory.id },
          data: {
            quantityOnHand: { decrement: item.quantity },
            quantityReserved: { decrement: item.quantity },
          },
        });

        // Update the aggregate sales counter
        await tx.products.update({
          where: { id: item.productId },
          data: {
            totalSold: { increment: item.quantity },
          },
        });
      }

      // Finalize status updates across both Order and Payment ledgers
      const updatedOrder = await tx.orders.update({
        where: { id: orderId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          payment: {
            updateMany: {
              where: { orderId: orderId },
              data: { status: 'COMPLETED' },
            },
          },
        },
        include: { orderitems: true, payment: true },
      });

      return updatedOrder;
    });
  }
}
