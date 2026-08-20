import { prisma } from '../../utils/prisma';
import { PAYOUTSTATUS } from '@prisma/client';

export default class PayoutService {
  static async getPayoutsBySeller(sellerId: string) {
    return prisma.sellerPayouts.findMany({
      where: { sellerId },
      include: {
        items: { include: { settlement: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Pay a seller for a set of released settlements.
   *
   * When `settlementIds` is omitted every released, not-yet-paid settlement for
   * the seller is swept. Requiring the caller to name ids by hand meant an
   * admin had to query the ledger themselves before they could pay anyone.
   */
  static async createPayout(payload: {
    sellerId: string;
    payoutMethod: string;
    settlementIds?: string[];
    referenceNo?: string;
  }) {
    if (!payload.sellerId) throw { status: 400, message: 'sellerId is required.' };
    if (!payload.payoutMethod) throw { status: 400, message: 'payoutMethod is required.' };

    return prisma.$transaction(async (tx) => {
      const settlements = await tx.settlements.findMany({
        where: {
          ...(payload.settlementIds?.length ? { id: { in: payload.settlementIds } } : {}),
          sellerId: payload.sellerId,
          status: 'RELEASED',
          payoutItem: null,
        },
      });

      if (settlements.length === 0) {
        throw {
          status: 400,
          message:
            'No eligible released settlements found for payout. Settlements become ' +
            'eligible once their hold period has elapsed and no return is open.',
        };
      }

      const totalAmount = Number(
        settlements.reduce((sum, s) => sum + Number(s.sellerNetAmount), 0).toFixed(2),
      );

      // Cash sales book a negative settlement — commission the seller owes us —
      // which nets off the gateway-funded ones here. A non-positive total means
      // the commission they owe meets or exceeds what we owe them, so there is
      // nothing to send; the debits stay unpaid and roll into the next run.
      if (totalAmount <= 0) {
        const owed = Math.abs(totalAmount).toFixed(2);
        throw {
          status: 400,
          message:
            totalAmount === 0
              ? 'Nothing to pay out — this balance is exactly zero.'
              : `Nothing to pay out — this seller owes ₱${owed} more in commission on cash ` +
                'sales than the platform currently owes them. The balance carries forward.',
        };
      }

      const payoutNumber = `PO-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

      const payout = await tx.sellerPayouts.create({
        data: {
          sellerId: payload.sellerId,
          payoutNumber,
          totalAmount,
          status: 'PROCESSING',
          payoutMethod: payload.payoutMethod,
          referenceNo: payload.referenceNo ?? null,
          items: {
            create: settlements.map((s) => ({
              settlementId: s.id,
              amount: Number(s.sellerNetAmount),
            })),
          },
        },
        include: { items: true },
      });

      return payout;
    });
  }

  static async updatePayoutStatus(id: string, status: PAYOUTSTATUS, referenceNo?: string) {
    const payout = await prisma.sellerPayouts.findUnique({ where: { id } });
    if (!payout) throw { status: 404, message: 'Payout not found.' };

    // COMPLETED means the money has left. Reopening it would let the same
    // settlements be swept into a second payout and pay the seller twice.
    if (payout.status === 'COMPLETED' && status !== 'COMPLETED') {
      throw {
        status: 409,
        message: 'A completed payout cannot be reopened.',
      };
    }

    return prisma.sellerPayouts.update({
      where: { id },
      data: {
        status,
        ...(referenceNo ? { referenceNo } : {}),
        ...(status === 'COMPLETED' ? { processedAt: new Date() } : {}),
      },
    });
  }
}
