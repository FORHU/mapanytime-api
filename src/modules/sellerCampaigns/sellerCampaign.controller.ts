import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { CAMPAIGNSTATUS } from '@prisma/client';
import SellerCampaignService from './sellerCampaign.service';
import { createCampaignSchema, updateCampaignSchema } from './sellerCampaign.schema';
import { responseSuccess, responseError } from '../../helpers/response.helper';
import type { AuthUser } from '../auth/auth.repository';

const campaignsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  status: Joi.string()
    .valid(...Object.values(CAMPAIGNSTATUS))
    .optional(),
  storeId: Joi.string().trim().optional(),
});

const transactionsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

export default class SellerCampaignController {
  static async createCampaign(req: Request, res: Response, next: NextFunction) {
    const { error, value } = createCampaignSchema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const user = req.user as AuthUser;
      if (!user) return responseError(res, 401, 'Unauthorized');

      const data = await SellerCampaignService.createCampaign(user, value);
      return responseSuccess(res, 201, data, 'Campaign created successfully');
    } catch (error) {
      next(error);
    }
  }

  static async getCampaigns(req: Request, res: Response, next: NextFunction) {
    const { error, value } = campaignsQuerySchema.validate(req.query);
    if (error) return responseError(res, 400, error.message);

    try {
      const user = req.user as AuthUser;
      if (!user) return responseError(res, 401, 'Unauthorized');

      const data = await SellerCampaignService.getCampaigns(user, value);
      return responseSuccess(res, 200, data, 'Campaigns retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async getCampaignById(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user as AuthUser;
      if (!user) return responseError(res, 401, 'Unauthorized');

      const data = await SellerCampaignService.getCampaignById(user, req.params.id);
      return responseSuccess(res, 200, data, 'Campaign details retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async updateCampaign(req: Request, res: Response, next: NextFunction) {
    const { error, value } = updateCampaignSchema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const user = req.user as AuthUser;
      if (!user) return responseError(res, 401, 'Unauthorized');

      const data = await SellerCampaignService.updateCampaign(user, req.params.id, value);
      return responseSuccess(res, 200, data, 'Campaign updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async getCampaignTransactions(req: Request, res: Response, next: NextFunction) {
    const { error, value } = transactionsQuerySchema.validate(req.query);
    if (error) return responseError(res, 400, error.message);

    try {
      const user = req.user as AuthUser;
      if (!user) return responseError(res, 401, 'Unauthorized');

      const data = await SellerCampaignService.getCampaignTransactions(user, req.params.id, value);
      return responseSuccess(res, 200, data, 'Campaign transactions retrieved successfully');
    } catch (error) {
      next(error);
    }
  }
}
