import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import MerchantAdsService from './merchantAds.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';

const productLinkSchema = Joi.object({
  productId: Joi.string().required(),
  variantId: Joi.string().optional(),
});

export default class MerchantAdsController {
  static async index(req: Request, res: Response, next: NextFunction) {
    const storeId = req.query.storeId as string;
    if (!storeId) return responseError(res, 400, 'storeId query parameter is required');

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized');

      const data = await MerchantAdsService.listMyAds(userId, storeId);
      return responseSuccess(res, 200, data);
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      storeId: Joi.string().required(),
      kind: Joi.string().valid('PROMO', 'JOB', 'EVENT').required(),
      title: Joi.string().required(),
      description: Joi.string().required(),
      imageUrl: Joi.string().optional(),
      badgeLabel: Joi.string().optional(),
      ctaLabel: Joi.string().optional(),
      salaryLabel: Joi.string().optional(),
      buyQuantity: Joi.number().integer().min(1).optional(),
      freeQuantity: Joi.number().integer().min(1).optional(),
      expiresAt: Joi.date().iso().optional(),
      products: Joi.array()
        .items(productLinkSchema)
        .when('kind', { is: 'EVENT', then: Joi.array().min(1).required() })
        .when('buyQuantity', { is: Joi.exist(), then: Joi.array().min(1).required() })
        .optional(),
    }).and('buyQuantity', 'freeQuantity');

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized');

      const data = await MerchantAdsService.createAd(userId, value);
      return responseSuccess(res, 201, data, 'Merchant ad created successfully');
    } catch (error) {
      next(error);
    }
  }

  static async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized');

      await MerchantAdsService.archiveAd(userId, req.params.id);
      return responseSuccess(res, 200, null, 'Merchant ad archived successfully');
    } catch (error) {
      next(error);
    }
  }
}
