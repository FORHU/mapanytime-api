import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';

export default class OrderRepository {
  // Executes the final insertion of the order and its relations
  static async insertOrder(
    data: Prisma.OrdersCreateInput | Prisma.OrdersUncheckedCreateInput,
    tx: Prisma.TransactionClient,
  ) {
    return tx.orders.create({
      data,
      include: {
        orderitems: true,
        payment: true,
      },
    });
  }

  // Fetches the order data needed for business validations
  static async getOrderById(orderId: string, tx: Prisma.TransactionClient) {
    return tx.orders.findUnique({
      where: { id: orderId },
      include: { orderitems: true, payment: true },
    });
  }

  // Executes the atomic status updates for completions and cancellations
  static async updateOrderStatus(
    orderId: string,
    orderStatus: 'COMPLETED' | 'CANCELLED',
    paymentStatus: 'COMPLETED' | 'FAILED',
    tx: Prisma.TransactionClient,
  ) {
    return tx.orders.update({
      where: { id: orderId },
      data: {
        status: orderStatus,
        completedAt: orderStatus === 'COMPLETED' ? new Date() : null,
        payment: {
          updateMany: {
            where: { orderId: orderId },
            data: { status: paymentStatus },
          },
        },
      },
      include: { orderitems: true, payment: true },
    });
  }

  // Fetches a buyer's order history
  static async getOrdersByBuyerId(buyerId: string) {
    const orders = await prisma.orders.findMany({
      where: { buyerId },
      orderBy: { createdAt: 'desc' },
      include: {
        store: { select: { storeName: true } },
        orderitems: true,
      },
    });

    // Manually stitch product names since Prisma schema is missing OrderItems -> Products relation
    if (orders.length === 0) return [];
    
    const productIds = orders.flatMap((o) => o.orderitems.map((i) => i.productId));
    const products = await prisma.products.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true },
    });
    
    const productMap = Object.fromEntries(products.map((p) => [p.id, p.name]));

    return orders.map((o) => ({
      ...o,
      orderitems: o.orderitems.map((item) => ({
        ...item,
        product: { name: productMap[item.productId] ?? 'Unknown Product' },
      })),
    }));
  }
}
