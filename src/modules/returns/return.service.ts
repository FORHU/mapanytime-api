import ReturnRepository from './return.repository';
import { RETURNSTATUS } from '@prisma/client';
import { prisma } from '../../utils/prisma';

export default class ReturnService {
  static async createReturnRequest(payload: { orderId: string; buyerId: string; reason: string }) {
    const order = await prisma.orders.findUnique({
      where: { id: payload.orderId },
      include: { store: true },
    });

    if (!order) {
      throw { status: 404, message: 'Order not found.' };
    }
    if (order.buyerId !== payload.buyerId) {
      throw { status: 403, message: 'You are not authorized to initiate a return for this order.' };
    }

    return ReturnRepository.createReturnRequest({
      orderId: payload.orderId,
      buyerId: payload.buyerId,
      sellerId: order.store.sellerId,
      reason: payload.reason,
      refundAmount: Number(order.totalAmount),
    });
  }

  static async getReturnsByBuyer(buyerId: string) {
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
