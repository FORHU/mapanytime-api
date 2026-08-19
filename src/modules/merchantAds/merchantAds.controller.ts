import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import MerchantAdsService from './merchantAds.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';

const productLinkSchema = Joi.object({
  productId: Joi.string().required(),
  variantId: Joi.string().optional(),
});

const adFieldsSchema = {
  kind: Joi.string().valid('PROMO', 'JOB', 'EVENT').optional(),
  title: Joi.string().required(),
  description: Joi.string().required(),
  imageUrl: Joi.string().optional(),
  badgeLabel: Joi.string().optional(),
  ctaLabel: Joi.string().optional(),
  salaryLabel: Joi.string().optional(),
  goal: Joi.string().valid('STORE_VISITS', 'IMPRESSIONS', 'PURCHASES').optional(),
  format: Joi.string()
    .valid('MAP_FLOATING_CARD', 'PROMOTED_PIN', 'DISCOVERY_CAROUSEL', 'SPONSORED_SEARCH')
    .optional(),
  radiusKm: Joi.number().integer().min(1).max(50).optional(),
  targetLat: Joi.number().optional(),
  targetLng: Joi.number().optional(),
  dailyBudget: Joi.number().min(0).optional(),
  totalBudget: Joi.number().min(0).optional(),
  discountType: Joi.string().valid('BOGO', 'PERCENTAGE', 'FIXED_AMOUNT').optional(),
  buyQuantity: Joi.number()
    .integer()
    .min(1)
    .when('discountType', { is: 'BOGO', then: Joi.required() }),
  freeQuantity: Joi.number()
    .integer()
    .min(1)
    .when('discountType', { is: 'BOGO', then: Joi.required() }),
  discountValue: Joi.number()
    .positive()
    .when('discountType', {
      switch: [
        { is: 'PERCENTAGE', then: Joi.number().positive().max(100).required() },
        { is: 'FIXED_AMOUNT', then: Joi.number().positive().required() },
      ],
      otherwise: Joi.forbidden(),
    }),
  expiresAt: Joi.date().iso().optional(),
  products: Joi.array()
    .items(productLinkSchema)
    .when('kind', { is: 'EVENT', then: Joi.array().min(1).required() })
    .when('discountType', { is: 'BOGO', then: Joi.array().min(1).required() })
    .optional(),
};

const nearbySchema = Joi.object({
  north: Joi.number().required(),
  south: Joi.number().required(),
  east: Joi.number().required(),
  west: Joi.number().required(),
  lat: Joi.number().optional(),
  lng: Joi.number().optional(),
  limit: Joi.number().integer().min(1).max(50).default(20),
});

export default class MerchantAdsController {
  static async nearby(req: Request, res: Response, next: NextFunction) {
    const { error, value } = nearbySchema.validate(req.query);
    if (error) return responseError(res, 400, error.message);

    try {
      const data = await MerchantAdsService.getNearbyDeals(
        value.north,
        value.south,
        value.east,
        value.west,
        value.lat,
        value.lng,
        value.limit,
      );
      return responseSuccess(res, 200, data);
    } catch (error) {
      next(error);
    }
  }

  static async index(req: Request, res: Response, next: NextFunction) {
    const storeId = req.query.storeId as string;

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized');

      if (!storeId) {
        // Return all ads across all stores owned by seller
        const data = await MerchantAdsService.listAllMyAds(userId);
        return responseSuccess(res, 200, data);
      }

      const data = await MerchantAdsService.listMyAds(userId, storeId);
      return responseSuccess(res, 200, data);
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      storeId: Joi.string().required(),
      ...adFieldsSchema,
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized');

      const data = await MerchantAdsService.createAd(userId, value);
      return responseSuccess(res, 201, data, 'Merchant promotion/ad created successfully');
    } catch (error) {
      next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object(adFieldsSchema);

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized');

      const data = await MerchantAdsService.updateAd(userId, req.params.id, value);
      return responseSuccess(res, 200, data, 'Merchant promotion/ad updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async destroy(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized');

      await MerchantAdsService.deleteAd(userId, req.params.id);
      return responseSuccess(res, 200, null, 'Merchant promotion/ad deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  static async toggle(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({ isActive: Joi.boolean().required() });
    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized');

      const data = await MerchantAdsService.setActive(userId, req.params.id, value.isActive);
      return responseSuccess(
        res,
        200,
        data,
        `Merchant promotion/ad ${value.isActive ? 'enabled' : 'disabled'}`,
      );
    } catch (error) {
      next(error);
    }
  }

  static async analytics(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized');

      const data = await MerchantAdsService.getAnalytics(userId, req.params.id);
      return responseSuccess(res, 200, data);
    } catch (error) {
      next(error);
    }
  }

  static async recordEvent(req: Request, res: Response, next: NextFunction) {
    // revenueAmount is deliberately not accepted here: this route is public, and
    // the value it feeds (attributedRevenue) drives ROAS and ad billing. It is
    // derived from the referenced order server-side instead.
    const schema = Joi.object({
      eventType: Joi.string().valid('IMPRESSION', 'CLICK', 'CONVERSION').required(),
      sessionId: Joi.string().optional(),
      orderId: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const buyerId = (req.user as { id: string })?.id;
      await MerchantAdsService.trackEvent(req.params.id, {
        ...value,
        buyerId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return responseSuccess(res, 200, null, 'Ad event logged successfully');
    } catch (error) {
      next(error);
    }
  }
}
