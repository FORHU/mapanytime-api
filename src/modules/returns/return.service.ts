import ReturnRepository from './return.repository';
import { RETURNSTATUS } from '@prisma/client';
import { prisma } from '../../utils/prisma';

export default class ReturnService {
  /**
   * Resolves the `Buyers` row for an authenticated `Users` id. `Orders.buyerId`
   * and `ReturnRequests.buyerId` both reference `Buyers`, never `Users`.
   */
  private static async resolveBuyerId(userId: string) {
    const buyer = await prisma.buyers.findUnique({ where: { userId } });
    if (!buyer) {
      throw { status: 403, message: 'Only registered buyers can request a return.' };
    }
    return buyer.id;
  }

  static async createReturnRequest(payload: { orderId: string; userId: string; reason: string }) {
    const buyerId = await this.resolveBuyerId(payload.userId);

    const order = await prisma.orders.findUnique({
      where: { id: payload.orderId },
      include: { store: true },
    });

    if (!order) {
      throw { status: 404, message: 'Order not found.' };
    }
    if (order.buyerId !== buyerId) {
      throw { status: 403, message: 'You are not authorized to initiate a return for this order.' };
    }

    return ReturnRepository.createReturnRequest({
      orderId: payload.orderId,
      buyerId,
      sellerId: order.store.sellerId,
      reason: payload.reason,
      refundAmount: Number(order.totalAmount),
    });
  }

  /** [userId] is the authenticated `Users` id, resolved to its buyer profile. */
  static async getReturnsByBuyer(userId: string) {
    const buyerId = await this.resolveBuyerId(userId);
    return ReturnRepository.findByBuyerId(buyerId);
  }

  static async getReturnsBySeller(sellerId: string) {
    return ReturnRepository.findBySellerId(sellerId);
  }

  static async updateReturnStatus(id: string, status: RETURNSTATUS) {
    const returnRequest = await ReturnRepository.findById(id);
    if (!returnRequest) {
      throw { status: 404, message: 'Return request not found.' };
    }
    return ReturnRepository.updateStatus(id, status);
  }
}
