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

  static async createPayout(payload: {
    sellerId: string;
    payoutMethod: string;
    settlementIds: string[];
    referenceNo?: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const settlements = await tx.settlements.findMany({
        where: {
          id: { in: payload.settlementIds },
          sellerId: payload.sellerId,
          status: 'RELEASED',
          payoutItem: null,
        },
      });

      if (settlements.length === 0) {
        throw new Error('No eligible released settlements found for payout.');
      }

      const totalAmount = settlements.reduce((sum, s) => sum + Number(s.sellerNetAmount), 0);

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
