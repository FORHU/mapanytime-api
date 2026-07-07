import PaymentRepository from '../repositories/payment.repository';
import ProductRepository from '../repositories/product.repository';
import { PAYMENTSTATUS } from '@prisma/client';
import { prisma } from '../utils/prisma';

export default class PaymentService {
  static async generateQrPayload(userId: string, orderId: string) {
    const seller = await ProductRepository.getSellerByUserId(userId);
    if (!seller || seller.applicationStatus !== 'APPROVED') {
      throw { status: 403, message: 'Unauthorized seller profile.' };
    }

    const payment = await PaymentRepository.getPaymentByOrderId(orderId);
    if (!payment) throw { status: 404, message: 'Payment record not found.' };

    if (payment.paymentMethod !== 'GCASH' && payment.paymentMethod !== 'BANK') {
      throw { status: 400, message: 'QR codes are only available for GCash and Bank transfers.' };
    }

    const store = await ProductRepository.getStoreById(payment.order.storeId);
    if (!store || store.sellerId !== seller.id) {
      throw { status: 403, message: 'You do not own the store fulfilling this order.' };
    }

    if (payment.status !== 'PENDING') {
      throw { status: 400, message: `Payment is already ${payment.status}.` };
    }

    // The data the frontend will use to generate the QR code
    return {
      orderId: payment.orderId,
      amount: payment.amount,
      storeName: store.storeName,
      paymentMethod: payment.paymentMethod,
    };
  }

  static async processMockWebhook(
    orderId: string,
    status: PAYMENTSTATUS,
    referenceNumber?: string,
  ) {
    return prisma.$transaction(async (tx) => {
      const payment = await tx.payments.findFirst({
        where: { orderId },
        orderBy: { createdAt: 'desc' }, // Get the most recent payment attempt
      });

      if (!payment) throw { status: 404, message: 'Payment record not found.' };
      if (payment.status === 'COMPLETED') return payment;

      let updatedPayment;

      if (status === 'COMPLETED') {
        if (!referenceNumber) {
          throw { status: 400, message: 'A reference number is required for successful payments.' };
        }
        updatedPayment = await tx.payments.update({
          where: { id: payment.id },
          data: {
            status: 'COMPLETED',
            referenceNumber,
            paidAt: new Date(),
          },
        });
      } else {
        updatedPayment = await tx.payments.update({
          where: { id: payment.id },
          data: { status },
        });

        // Automatically cancel the order if the payment fails
        if (status === 'FAILED') {
          await tx.orders.update({
            where: { id: orderId },
            data: { status: 'FAILED' },
          });
        }
      }

      return updatedPayment;
    });
  }
}
