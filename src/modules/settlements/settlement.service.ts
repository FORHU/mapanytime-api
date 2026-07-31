import { prisma } from '../../utils/prisma';
import { SETTLEMENTSTATUS } from '@prisma/client';

export default class SettlementService {
  static async getSettlementsBySeller(sellerId: string) {
    return prisma.settlements.findMany({
      where: { sellerId },
      include: {
        order: { select: { id: true, totalAmount: true, completedAt: true } },
        payoutItem: { include: { payout: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async getSettlementByOrder(orderId: string) {
    return prisma.settlements.findUnique({
      where: { orderId },
      include: {
        order: true,
        seller: { select: { id: true, userId: true } },
      },
    });
  }

  static async updateSettlementStatus(id: string, status: SETTLEMENTSTATUS) {
    return prisma.settlements.update({
      where: { id },
      data: {
        status,
        ...(status === 'RELEASED' ? { settledAt: new Date() } : {}),
      },
    });
  }
}
