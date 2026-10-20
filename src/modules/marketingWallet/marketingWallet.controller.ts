import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import MarketingWalletService from './marketingWallet.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';
import { money } from '../../helpers/money.helper';
import type { AuthUser } from '../auth/auth.repository';

const depositSchema = Joi.object({
  amount: money().positive().required(),
  referenceKey: Joi.string().trim().max(100).optional(),
  description: Joi.string().trim().max(255).optional(),
  metadata: Joi.object().optional(),
});

const transactionsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  type: Joi.string().valid('DEPOSIT', 'AD_SPEND', 'REFUND', 'ADJUSTMENT').optional(),
});

export default class MarketingWalletController {
  static async getWallet(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user as AuthUser;
      if (!user) return responseError(res, 401, 'Unauthorized');

      const data = await MarketingWalletService.getWallet(user);
      return responseSuccess(res, 200, data, 'Marketing wallet retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async deposit(req: Request, res: Response, next: NextFunction) {
    const { error, value } = depositSchema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const user = req.user as AuthUser;
      if (!user) return responseError(res, 401, 'Unauthorized');

      const data = await MarketingWalletService.deposit(
        user,
        value.amount,
        value.referenceKey,
        value.description,
        value.metadata,
      );
      return responseSuccess(res, 201, data, 'Marketing wallet deposit successful');
    } catch (error) {
      next(error);
    }
  }

  static async getTransactions(req: Request, res: Response, next: NextFunction) {
    const { error, value } = transactionsQuerySchema.validate(req.query);
    if (error) return responseError(res, 400, error.message);

    try {
      const user = req.user as AuthUser;
      if (!user) return responseError(res, 401, 'Unauthorized');

      const data = await MarketingWalletService.getTransactions(user, value);
      return responseSuccess(
        res,
        200,
        data,
        'Marketing wallet transactions retrieved successfully',
      );
    } catch (error) {
      next(error);
    }
  }
}
