import { Request, Response, NextFunction } from 'express';
import PayoutService from './payout.service';
import { responseSuccess } from '../../helpers/response.helper';
import { prisma } from '../../utils/prisma';

export default class PayoutController {
  /** The authenticated seller's own payout history — no id taken from the client. */
  static async getMyPayouts(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as { id: string })?.id;
      const seller = await prisma.sellers.findUnique({ where: { userId } });
      if (!seller) throw { status: 403, message: 'No seller profile for this account.' };
      const payouts = await PayoutService.getPayoutsBySeller(seller.id);
      return responseSuccess(res, 200, payouts, 'Seller payouts fetched successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async getSellerPayouts(req: Request, res: Response, next: NextFunction) {
    try {
      const { sellerId } = req.params;
      const payouts = await PayoutService.getPayoutsBySeller(sellerId);
      return responseSuccess(res, 200, payouts, 'Seller payouts fetched successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async createPayout(req: Request, res: Response, next: NextFunction) {
    try {
      const payout = await PayoutService.createPayout(req.body);
      return responseSuccess(res, 201, payout, 'Seller payout requested successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async updatePayoutStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { status, referenceNo } = req.body;
      const updated = await PayoutService.updatePayoutStatus(id, status, referenceNo);
      return responseSuccess(res, 200, updated, 'Payout status updated successfully.');
    } catch (error) {
      next(error);
    }
  }
}
