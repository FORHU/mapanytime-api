import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import SellerService from './seller.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';
import { parsePagination } from '../../helpers/pagination.helper';

export default class SellerController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>);

      const data = await SellerService.listPendingSellers(page, limit, skip);
      return responseSuccess(res, 200, data, 'Pending sellers retrieved successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async getDetail(req: Request, res: Response, next: NextFunction) {
    try {
      const { sellerId } = req.params;

      if (!sellerId) {
        return responseError(res, 400, 'Seller ID is required.');
      }

      const data = await SellerService.getSellerDetail(sellerId);
      return responseSuccess(res, 200, data);
    } catch (error) {
      next(error);
    }
  }

  static async approve(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized');

      const { sellerId } = req.params;

      if (!sellerId) {
        return responseError(res, 400, 'Seller ID is required.');
      }

      const data = await SellerService.approveSeller(sellerId, userId);
      return responseSuccess(res, 200, data, 'Seller approved successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async reject(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      reason: Joi.string().trim().min(3).max(1000).required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized');

      const { sellerId } = req.params;

      if (!sellerId) {
        return responseError(res, 400, 'Seller ID is required.');
      }

      const data = await SellerService.rejectSeller(sellerId, value.reason, userId);
      return responseSuccess(res, 200, data, 'Seller rejected successfully.');
    } catch (error) {
      next(error);
    }
  }
}
