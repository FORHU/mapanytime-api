import { Prisma } from '@prisma/client';

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
}
