import { prisma } from '../utils/prisma';

export default class PaymentRepository {
  static async getPaymentByOrderId(orderId: string) {
    return prisma.payments.findFirst({
      where: { orderId },
      include: { order: true },
    });
  }

  static async updatePaymentSuccess(paymentId: string, referenceNumber: string) {
    return prisma.payments.update({
      where: { id: paymentId },
      data: {
        status: 'COMPLETED',
        referenceNumber: referenceNumber,
        paidAt: new Date(),
      },
    });
  }

  static async updatePaymentFailed(paymentId: string) {
    return prisma.payments.update({
      where: { id: paymentId },
      data: { status: 'FAILED' },
    });
  }
}
