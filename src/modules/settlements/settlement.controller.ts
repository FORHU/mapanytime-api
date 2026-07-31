import { Request, Response, NextFunction } from 'express';
import SettlementService from './settlement.service';
import { responseSuccess } from '../../helpers/response.helper';

export default class SettlementController {
  static async getSellerSettlements(req: Request, res: Response, next: NextFunction) {
    try {
      const { sellerId } = req.params;
      const settlements = await SettlementService.getSettlementsBySeller(sellerId);
      return responseSuccess(res, 200, settlements, 'Seller settlements fetched successfully.');
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
