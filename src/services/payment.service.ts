import PaymentRepository from '../repositories/payment.repository';
import ProductRepository from '../repositories/product.repository';
import { PAYMENTSTATUS } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { emitNotificationToUser } from '../infrastructure/socket';

export default class PaymentService {
  static async generateQrPayload(userId: string, orderId: string) {
    const seller = await ProductRepository.getSellerByUserId(userId);
    if (!seller || seller.applicationStatus !== 'APPROVED') {
      throw { status: 403, message: 'Unauthorized seller profile.' };
    }

    const payment = await PaymentRepository.getPaymentByOrderId(orderId);
    if (!payment) throw { status: 404, message: 'Payment record not found.' };

    if (payment.paymentMethod !== 'E_WALLET' && payment.paymentMethod !== 'BANK') {
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
    const { payment, justCompleted } = await prisma.$transaction(async (tx) => {
      const existing = await tx.payments.findFirst({
        where: { orderId },
        orderBy: { createdAt: 'desc' }, // Get the most recent payment attempt
      });

      if (!existing) throw { status: 404, message: 'Payment record not found.' };
      // Idempotent replay: already settled, nothing to transition or notify.
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

        // Advance the order so its status reflects reality: PENDING = unpaid,
        // PROCESSING = paid and awaiting seller fulfillment. Scoped to PENDING
        // so we never regress an order that's already further along.
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

      // On failure: cancel the order AND release the stock it reserved at
      // creation, so a failed/abandoned order doesn't lock inventory forever.
      if (status === 'FAILED') {
        const order = await tx.orders.findUnique({
          where: { id: orderId },
          include: { orderitems: true },
        });

        // Only release when the reservation is still active (order not already
        // terminal), so we never double-decrement quantityReserved.
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

    // After commit: on a real PENDING → COMPLETED transition, push a realtime
    // "payment received" notification to the buyer. Best-effort — a socket
    // failure must not fail the webhook.
    if (justCompleted) {
      try {
        const order = await prisma.orders.findUnique({
          where: { id: orderId },
          include: { buyer: { select: { userId: true } }, store: { select: { storeName: true } } },
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
      } catch {
        // Swallow — notification delivery is non-critical.
      }
    }

    return payment;
  }
}
