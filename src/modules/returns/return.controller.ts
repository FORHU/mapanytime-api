import { Request, Response, NextFunction } from 'express';
import ReturnService from './return.service';
import { responseSuccess } from '../../helpers/response.helper';

export default class ReturnController {
  static async createReturn(req: Request, res: Response, next: NextFunction) {
    try {
      const returnReq = await ReturnService.createReturnRequest({
        orderId: req.body.orderId,
        reason: req.body.reason,
        userId: req.user?.id,
      });
      return responseSuccess(res, 201, returnReq, 'Return request submitted successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async getBuyerReturns(req: Request, res: Response, next: NextFunction) {
    try {
      // Always scope to the caller. Honouring `:buyerId` from the path would
      // let any authenticated buyer read another buyer's returns.
      const returns = await ReturnService.getReturnsByBuyer(req.user?.id);
      return responseSuccess(res, 200, returns, 'Buyer return requests fetched successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async getSellerReturns(req: Request, res: Response, next: NextFunction) {
    try {
      // Scoped to the caller's own seller profile for the same reason
      // getBuyerReturns is — a path id would expose another seller's returns.
      const sellerId = await ReturnService.resolveOwnSellerId(req.user?.id);
      const returns = await ReturnService.getReturnsBySeller(sellerId);
      return responseSuccess(res, 200, returns, 'Seller return requests fetched successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async updateReturnStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const updated = await ReturnService.updateReturnStatus(id, status, req.user?.id);
      return responseSuccess(res, 200, updated, 'Return request status updated successfully.');
    } catch (error) {
      next(error);
    }
  }
}
