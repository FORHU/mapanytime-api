import { prisma } from '../../utils/prisma';
import { RETURNSTATUS } from '@prisma/client';

export default class ReturnRepository {
  static async createReturnRequest(data: {
    orderId: string;
    buyerId: string;
    sellerId: string;
    reason: string;
    refundAmount: number;
  }) {
    return prisma.returnRequests.create({
      data: {
        orderId: data.orderId,
        buyerId: data.buyerId,
        sellerId: data.sellerId,
        reason: data.reason,
        refundAmount: data.refundAmount,
        status: 'PENDING',
      },
      include: {
        order: true,
        buyer: { select: { id: true, displayName: true } },
        seller: { select: { id: true, userId: true } },
      },
    });
  }

  static async findById(id: string) {
    return prisma.returnRequests.findUnique({
      where: { id },
      include: {
        order: true,
        buyer: { select: { id: true, displayName: true } },
        seller: { select: { id: true, userId: true } },
      },
    });
  }

  static async findByBuyerId(buyerId: string) {
    return prisma.returnRequests.findMany({
      where: { buyerId },
      include: {
        order: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async findBySellerId(sellerId: string) {
    return prisma.returnRequests.findMany({
      where: { sellerId },
      include: {
        order: true,
        buyer: { select: { id: true, displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async updateStatus(id: string, status: RETURNSTATUS) {
    return prisma.returnRequests.update({
      where: { id },
      data: { status },
    });
  }
}
