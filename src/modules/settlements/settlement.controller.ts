import { Request, Response, NextFunction } from 'express';
import SettlementService from './settlement.service';
import { responseSuccess } from '../../helpers/response.helper';
import { prisma } from '../../utils/prisma';

/**
 * Resolve the `Sellers` row for the authenticated user. Seller-facing routes
 * take no id from the client: reading another seller's ledger by guessing a
 * path parameter is not a thing that should be possible.
 */
async function resolveOwnSellerId(req: Request): Promise<string> {
  const userId = (req.user as { id: string })?.id;
  const seller = await prisma.sellers.findUnique({ where: { userId } });
  if (!seller) throw { status: 403, message: 'No seller profile for this account.' };
  return seller.id;
}

export default class SettlementController {
  /** The authenticated seller's own settlement ledger. */
  static async getMySettlements(req: Request, res: Response, next: NextFunction) {
    try {
      const sellerId = await resolveOwnSellerId(req);
      const settlements = await SettlementService.getSettlementsBySeller(sellerId);
      return responseSuccess(res, 200, settlements, 'Seller settlements fetched successfully.');
    } catch (error) {
      next(error);
    }
  }

  /** What the authenticated seller can be paid now, and what is still maturing. */
  static async getMyBalance(req: Request, res: Response, next: NextFunction) {
    try {
      const sellerId = await resolveOwnSellerId(req);
      const balance = await SettlementService.getSellerBalance(sellerId);
      return responseSuccess(res, 200, balance, 'Seller balance fetched successfully.');
    } catch (error) {
      next(error);
    }
  }

  /** Admin view of any seller's ledger. */
  static async getSellerSettlements(req: Request, res: Response, next: NextFunction) {
    try {
      const { sellerId } = req.params;
      const settlements = await SettlementService.getSettlementsBySeller(sellerId);
      return responseSuccess(res, 200, settlements, 'Seller settlements fetched successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async getSellerBalance(req: Request, res: Response, next: NextFunction) {
    try {
      const { sellerId } = req.params;
      const balance = await SettlementService.getSellerBalance(sellerId);
      return responseSuccess(res, 200, balance, 'Seller balance fetched successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async getOrderSettlement(req: Request, res: Response, next: NextFunction) {
    try {
      const { orderId } = req.params;
      const settlement = await SettlementService.getSettlementByOrder(orderId);
      return responseSuccess(res, 200, settlement, 'Order settlement fetched successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async updateSettlementStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const updated = await SettlementService.updateSettlementStatus(id, status);
      return responseSuccess(res, 200, updated, 'Settlement status updated successfully.');
    } catch (error) {
      next(error);
    }
  }
}
