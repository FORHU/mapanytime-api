import Stripe from 'stripe';
import { PAYMENTSTATUS, RESERVATIONSTATUS } from '@prisma/client';
import { prisma } from '../../../utils/prisma';
import logger from '../../../utils/logger';
import InventoryStockRepository from '../../inventory/inventoryStock.repository';

export class PaymentReconciliationJob {
  private stripe: Stripe | null = null;

  constructor(stripeClient?: Stripe) {
    if (stripeClient) {
      this.stripe = stripeClient;
    } else if (process.env.STRIPE_SECRET_KEY) {
      this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: '2025-02-24.acacia' as Stripe.LatestApiVersion,
      });
    }
  }

  /**
   * Sweeps pending Stripe payments that are older than `olderThanMinutes` and
   * verifies their real state against the Stripe API.
   */
  async runReconciliation(olderThanMinutes: number = 10): Promise<{
    inspected: number;
    completed: number;
    failed: number;
    skipped: number;
  }> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);

    const stripeProvider = await prisma.paymentProviders.findUnique({
      where: { code: 'STRIPE' },
    });

    if (!stripeProvider) {
      logger.debug('[PaymentReconciliation] Stripe provider record not found in database.');
      return { inspected: 0, completed: 0, failed: 0, skipped: 0 };
    }

    const pendingPayments = await prisma.payments.findMany({
      where: {
        providerId: stripeProvider.id,
        status: PAYMENTSTATUS.PENDING,
        createdAt: { lte: cutoff },
      },
      include: {
        provider: true,
      },
    });

    if (pendingPayments.length === 0) {
      return { inspected: 0, completed: 0, failed: 0, skipped: 0 };
    }

    logger.info(
      `[PaymentReconciliation] Found ${pendingPayments.length} pending Stripe payment(s) to reconcile.`,
    );

    let completed = 0;
    let failed = 0;
    let skipped = 0;

    for (const payment of pendingPayments) {
      const intentId = payment.paymentIntentId;
      if (!intentId) {
        skipped++;
        continue;
      }

      if (!this.stripe) {
        logger.warn('[PaymentReconciliation] Stripe client is not configured; skipping lookup.');
        skipped++;
        continue;
      }

      try {
        const intent = await this.stripe.paymentIntents.retrieve(intentId);

        if (intent.status === 'succeeded') {
          await prisma.$transaction(async (tx) => {
            const updated = await tx.payments.updateMany({
              where: {
                id: payment.id,
                status: PAYMENTSTATUS.PENDING,
              },
              data: {
                status: PAYMENTSTATUS.COMPLETED,
                providerReference: intent.id,
                paidAt: new Date(),
              },
            });

            if (updated.count > 0) {
              await tx.orders.updateMany({
                where: { id: payment.orderId, status: 'PENDING' },
                data: { status: 'PROCESSING' },
              });
              completed++;
            } else {
              skipped++;
            }
          });
        } else if (intent.status === 'canceled') {
          await prisma.$transaction(async (tx) => {
            const updated = await tx.payments.updateMany({
              where: {
                id: payment.id,
                status: PAYMENTSTATUS.PENDING,
              },
              data: {
                status: PAYMENTSTATUS.FAILED,
                failureReason: 'Intent was canceled at gateway',
              },
            });

            if (updated.count > 0) {
              await tx.orders.updateMany({
                where: { id: payment.orderId, status: 'PENDING' },
                data: { status: 'FAILED' },
              });
              await InventoryStockRepository.releaseOrderReservations(
                tx,
                payment.orderId,
                RESERVATIONSTATUS.RELEASED,
              );
              failed++;
            } else {
              skipped++;
            }
          });
        } else {
          // If status is 'requires_payment_method' and older than 30m, expire it
          const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
          if (
            payment.createdAt <= thirtyMinutesAgo &&
            intent.status === 'requires_payment_method'
          ) {
            await prisma.$transaction(async (tx) => {
              const updated = await tx.payments.updateMany({
                where: {
                  id: payment.id,
                  status: PAYMENTSTATUS.PENDING,
                },
                data: {
                  status: PAYMENTSTATUS.FAILED,
                  failureReason: 'Payment expired without payment method',
                },
              });

              if (updated.count > 0) {
                await tx.orders.updateMany({
                  where: { id: payment.orderId, status: 'PENDING' },
                  data: { status: 'FAILED' },
                });
                await InventoryStockRepository.releaseOrderReservations(
                  tx,
                  payment.orderId,
                  RESERVATIONSTATUS.RELEASED,
                );
                failed++;
              } else {
                skipped++;
              }
            });
          } else {
            skipped++;
          }
        }
      } catch (err) {
        logger.error(`[PaymentReconciliation] Failed to reconcile payment ${payment.id}:`, err);
        skipped++;
      }
    }

    return {
      inspected: pendingPayments.length,
      completed,
      failed,
      skipped,
    };
  }
}
