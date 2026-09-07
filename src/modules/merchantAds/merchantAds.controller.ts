import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import MerchantAdsService from './merchantAds.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';
import { money, MAX_MONEY } from '../../helpers/money.helper';
import { MIN_WINDOW_MS, MAX_HORIZON_MS } from './adWindow';
import type { AuthUser } from '../auth/auth.repository';

const productLinkSchema = Joi.object({
  productId: Joi.string().required(),
  variantId: Joi.string().optional(),
});

/**
 * Cross-field schedule rules that need no database read. Rules that do — start
 * not-in-the-past, the start lock on a running ad, and product overlap — live
 * in the service, which has the stored row to compare against.
 */
const scheduleWindow = (
  value: { startAt?: Date; expiresAt?: Date; badgeId?: string | null; badgeLabel?: string | null },
  helpers: Joi.CustomHelpers,
) => {
  const { startAt, expiresAt, badgeId, badgeLabel } = value;

  if (startAt && expiresAt) {
    const durationMs = expiresAt.getTime() - startAt.getTime();

    if (durationMs < MIN_WINDOW_MS) {
      const minutes = Math.max(0, Math.round(durationMs / 60000));
      return helpers.message({
        custom:
          `This promotion would run for ${minutes} minute${minutes === 1 ? '' : 's'}. ` +
          'Give it at least 5 minutes so it can be shown to buyers.',
      } as Joi.LanguageMessages);
    }
  }

  if (startAt && startAt.getTime() > Date.now() + MAX_HORIZON_MS) {
    return helpers.message({
      custom: 'Start time is more than a year away. Check the year on the start date.',
    } as Joi.LanguageMessages);
  }

  if (badgeId && badgeLabel) {
    return helpers.message({
      custom: 'Choose a preset badge or type a custom one, not both.',
    } as Joi.LanguageMessages);
  }

  return value;
};

const adFieldsSchema = {
  kind: Joi.string().valid('PROMO', 'JOB', 'EVENT').optional(),
  title: Joi.string().required(),
  description: Joi.string().required(),
  imageUrl: Joi.string().optional(),
  badgeId: Joi.string().allow(null).optional(),
  badgeLabel: Joi.string().trim().max(24).allow(null, '').optional(),
  ctaLabel: Joi.string().optional(),
  salaryLabel: Joi.string().optional(),
  goal: Joi.string().valid('STORE_VISITS', 'IMPRESSIONS', 'PURCHASES').optional(),
  format: Joi.string()
    .valid('MAP_FLOATING_CARD', 'PROMOTED_PIN', 'DISCOVERY_CAROUSEL', 'SPONSORED_SEARCH')
    .optional(),
  radiusKm: Joi.number().integer().min(1).max(50).optional(),
  targetLat: Joi.number().optional(),
  targetLng: Joi.number().optional(),
  dailyBudget: money().optional(),
  totalBudget: money().optional(),
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
        { is: 'FIXED_AMOUNT', then: Joi.number().positive().max(MAX_MONEY).required() },
      ],
      otherwise: Joi.forbidden(),
    }),
  startAt: Joi.date().iso().optional().allow(null),
  // .greater() is applied only when startAt is present: an unresolvable
  // reference makes Joi reject the field outright, which would break every
  // request that sets an end date and no start date.
  expiresAt: Joi.date()
    .iso()
    .when('startAt', {
      is: Joi.exist().not(null),
      then: Joi.date().greater(Joi.ref('startAt')).messages({
        'date.greater': 'End time must be after the start time.',
      }),
    })
    .optional()
    .allow(null),
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

  static async badges(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await MerchantAdsService.listBadges();
      return responseSuccess(res, 200, data);
    } catch (error) {
      next(error);
    }
  }

  static async index(req: Request, res: Response, next: NextFunction) {
    const storeId = req.query.storeId as string;

    try {
      const user = req.user as AuthUser;
      if (!user) return responseError(res, 401, 'Unauthorized');

      if (!storeId) {
        // Every store the caller can reach — all of the organization's for an
        // admin, only the assigned ones for staff.
        const data = await MerchantAdsService.listAllMyAds(user);
        return responseSuccess(res, 200, data);
      }

      const data = await MerchantAdsService.listMyAds(user, storeId);
      return responseSuccess(res, 200, data);
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      storeId: Joi.string().required(),
      ...adFieldsSchema,
    }).custom(scheduleWindow);

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const user = req.user as AuthUser;
      if (!user) return responseError(res, 401, 'Unauthorized');

      const data = await MerchantAdsService.createAd(user, value);
      return responseSuccess(res, 201, data, 'Merchant promotion/ad created successfully');
    } catch (error) {
      next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object(adFieldsSchema).custom(scheduleWindow);

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const user = req.user as AuthUser;
      if (!user) return responseError(res, 401, 'Unauthorized');

      const data = await MerchantAdsService.updateAd(user, req.params.id, value);
      return responseSuccess(res, 200, data, 'Merchant promotion/ad updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async destroy(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user as AuthUser;
      if (!user) return responseError(res, 401, 'Unauthorized');

      await MerchantAdsService.deleteAd(user, req.params.id);
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
      const user = req.user as AuthUser;
      if (!user) return responseError(res, 401, 'Unauthorized');

      const data = await MerchantAdsService.setActive(user, req.params.id, value.isActive);
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
      const user = req.user as AuthUser;
      if (!user) return responseError(res, 401, 'Unauthorized');

      const data = await MerchantAdsService.getAnalytics(user, req.params.id);
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
