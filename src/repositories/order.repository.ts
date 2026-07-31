import { Prisma, ORDERSTATUS } from '@prisma/client';
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

  // Executes atomic status updates for order state transitions
  static async updateOrderStatus(
    orderId: string,
    orderStatus: ORDERSTATUS,
    paymentStatus?: 'PENDING' | 'COMPLETED' | 'FAILED',
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? prisma;
    return client.orders.update({
      where: { id: orderId },
      data: {
        status: orderStatus,
        completedAt: orderStatus === 'COMPLETED' ? new Date() : undefined,
        ...(paymentStatus && {
          payment: {
            updateMany: {
              where: { orderId: orderId },
              data: { status: paymentStatus },
            },
          },
        }),
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

  // Fetches orders for a single store ID
  static async getOrdersByStoreId(storeId: string) {
    return this.getOrdersByStoreIds([storeId]);
  }

  // Fetches orders across multiple store IDs (e.g. all stores owned by a merchant)
  static async getOrdersByStoreIds(storeIds: string[]) {
    if (storeIds.length === 0) return [];

    const orders = await prisma.orders.findMany({
      where: { storeId: { in: storeIds } },
      orderBy: { createdAt: 'desc' },
      include: {
        store: { select: { storeName: true } },
        buyer: { select: { displayName: true } },
        orderitems: true,
      },
    });

    if (orders.length === 0) return [];

    const productIds = orders.flatMap((o) => o.orderitems.map((i) => i.productId));
    const products = await prisma.products.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true },
    });

    const productMap = Object.fromEntries(products.map((p) => [p.id, p.name]));

    return orders.map((order) => ({
      ...order,
      orderitems: order.orderitems.map((item) => ({
        ...item,
        product: { name: productMap[item.productId] ?? 'Unknown Product' },
      })),
    }));
  }
}
