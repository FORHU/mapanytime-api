import PaymentRepository from './payment.repository';
import ProductRepository from '../products/product.repository';
import { PAYMENTSTATUS, PAYMENTMETHOD } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { emitNotificationToUser } from '../../infrastructure/socket';

export default class PaymentService {
  static async generateQrPayload(userId: string, orderId: string) {
    const seller = await ProductRepository.getSellerByUserId(userId);
    if (!seller || seller.applicationStatus !== 'APPROVED') {
      throw { status: 403, message: 'Unauthorized seller profile.' };
    }

    const payment = await PaymentRepository.getPaymentByOrderId(orderId);
    if (!payment) throw { status: 404, message: 'Payment record not found.' };

    if (
      payment.paymentMethod !== PAYMENTMETHOD.E_WALLET &&
      payment.paymentMethod !== PAYMENTMETHOD.BANK
    ) {
      throw {
        status: 400,
        message: 'QR codes are only available for E-Wallet and Bank transfers.',
      };
    }

    const store = await ProductRepository.getStoreById(payment.order.storeId);
    if (!store || store.sellerId !== seller.id) {
      throw { status: 403, message: 'You do not own the store fulfilling this order.' };
    }

    if (payment.status !== 'PENDING') {
      throw { status: 400, message: `Payment is already ${payment.status}.` };
    }

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
    const { payment, justCompleted } = await prisma.$transaction(async (tx) => {
      const existing = await tx.payments.findFirst({
        where: { orderId },
        orderBy: { createdAt: 'desc' },
      });

      if (!existing) throw { status: 404, message: 'Payment record not found.' };
      if (existing.status === 'COMPLETED') return { payment: existing, justCompleted: false };

      if (status === 'COMPLETED') {
        if (!referenceNumber) {
          throw { status: 400, message: 'A reference number is required for successful payments.' };
        }
        const updated = await tx.payments.update({
          where: { id: existing.id },
          data: {
            status: 'COMPLETED',
            referenceNumber,
            paidAt: new Date(),
          },
        });

        await tx.orders.updateMany({
          where: { id: orderId, status: 'PENDING' },
          data: { status: 'PROCESSING' },
        });

        return { payment: updated, justCompleted: true };
      }

      const updated = await tx.payments.update({
        where: { id: existing.id },
        data: { status },
      });

      if (status === 'FAILED') {
        const order = await tx.orders.findUnique({
          where: { id: orderId },
          include: { orderitems: true },
        });

        if (order && (order.status === 'PENDING' || order.status === 'PROCESSING')) {
          for (const item of order.orderitems) {
            await tx.inventory.updateMany({
              where: { productId: item.productId },
              data: { quantityReserved: { decrement: item.quantity } },
            });
          }

          await tx.orders.update({
            where: { id: orderId },
            data: { status: 'FAILED' },
          });
        }
      }

      return { payment: updated, justCompleted: false };
    });

    if (justCompleted) {
      try {
        const order = await prisma.orders.findUnique({
          where: { id: orderId },
          include: {
            buyer: { select: { userId: true } },
            store: {
              include: {
                seller: { select: { userId: true } },
              },
            },
          },
        });
        if (order?.buyer?.userId) {
          emitNotificationToUser(order.buyer.userId, {
            id: payment.id,
            title: 'Payment received',
            body: `Your payment of ₱${payment.amount.toLocaleString()} to ${order.store.storeName} was successful.`,
            metadata: { orderId, type: 'PAYMENT_COMPLETED' },
            sentAt: new Date().toISOString(),
          });
        }
        if (order?.store?.seller?.userId) {
          emitNotificationToUser(order.store.seller.userId, {
            id: order.id,
            title: 'Order Paid & Ready',
            body: `Order ₱${payment.amount.toLocaleString()} is paid and ready for preparation.`,
            metadata: { orderId, type: 'ORDER_PAID' },
            sentAt: new Date().toISOString(),
          });
        }
      } catch {
        // Swallow — notification delivery is non-critical.
      }
    }

    return payment;
  }
}
