import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import PricingService from './pricing.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';

const COMPONENT_TYPES = [
  'BUYER_TRANSACTION_FEE',
  'SELLER_MARKETPLACE_FEE',
  'PAYMENT_PROCESSING_FEE',
  'FIXED_TRANSACTION_FEE',
  'WITHDRAWAL_FEE',
  'ADVERTISING_FEE',
];

const PAYER_POLICIES = ['BUYER', 'SELLER', 'PLATFORM', 'SHARED'];

/**
 * Rates are fractions: 2.00% is 0.02. Capped well below 1 so the
 * percent-versus-fraction slip is caught at the edge rather than after it has
 * repriced live orders.
 */
const componentSchema = Joi.object({
  type: Joi.string()
    .valid(...COMPONENT_TYPES)
    .required(),
  calculationType: Joi.string().valid('PERCENTAGE', 'FIXED', 'HYBRID', 'TIERED').optional(),
  ratePercentage: Joi.number().min(0).max(0.5).optional(),
  fixedAmount: Joi.number().min(0).optional(),
  minFee: Joi.number().min(0).optional(),
  maxFee: Joi.number().min(0).optional(),
  providerId: Joi.string().optional(),
  paymentMethodId: Joi.string().optional(),
  sellerPlan: Joi.string().optional(),
  categoryId: Joi.string().optional(),
  storeId: Joi.string().optional(),
  priority: Joi.number().integer().optional(),
  isActive: Joi.boolean().optional(),
});

export default class PricingController {
  static async calculate(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      subtotalAmount: Joi.number().positive().required(),
      discountAmount: Joi.number().min(0).default(0),
      storeId: Joi.string().optional(),
      sellerId: Joi.string().optional(),
      sellerPlan: Joi.string().optional(),
      categoryId: Joi.string().optional(),
      providerId: Joi.string().optional(),
      paymentMethodId: Joi.string().optional(),
      paymentMethodCode: Joi.string().optional(),
      paymentMethodType: Joi.string().optional(),
      paymentFeePayerPolicy: Joi.string()
        .valid(...PAYER_POLICIES)
        .optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const data = await PricingService.calculatePricing(value);
      return responseSuccess(res, 200, data, 'Pricing calculated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async active(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await PricingService.getActivePricing();
      return responseSuccess(res, 200, data);
    } catch (error) {
      next(error);
    }
  }

  static async index(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await PricingService.listPricingConfigurations();
      return responseSuccess(res, 200, data);
    } catch (error) {
      next(error);
    }
  }

  static async show(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await PricingService.getPricingConfiguration(req.params.id);
      return responseSuccess(res, 200, data);
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      name: Joi.string().required(),
      description: Joi.string().allow('').optional(),
      currency: Joi.string().length(3).optional(),
      effectiveFrom: Joi.date().optional(),
      effectiveUntil: Joi.date().optional(),
      priority: Joi.number().integer().optional(),
      paymentFeePayerPolicy: Joi.string()
        .valid(...PAYER_POLICIES)
        .optional(),
      components: Joi.array().items(componentSchema).optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const data = await PricingService.createPricingConfiguration(value);
      return responseSuccess(res, 201, data, 'Pricing configuration created as a draft');
    } catch (error) {
      next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      name: Joi.string().optional(),
      description: Joi.string().allow('').optional(),
      currency: Joi.string().length(3).optional(),
      effectiveFrom: Joi.date().optional(),
      effectiveUntil: Joi.date().allow(null).optional(),
      priority: Joi.number().integer().optional(),
      paymentFeePayerPolicy: Joi.string()
        .valid(...PAYER_POLICIES)
        .optional(),
    }).min(1);

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const data = await PricingService.updatePricingConfiguration(req.params.id, value);
      return responseSuccess(res, 200, data, 'Pricing configuration updated');
    } catch (error) {
      next(error);
    }
  }

  static async addComponent(req: Request, res: Response, next: NextFunction) {
    const { error, value } = componentSchema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const data = await PricingService.addComponent(req.params.id, value);
      return responseSuccess(res, 201, data, 'Pricing component added');
    } catch (error) {
      next(error);
    }
  }

  static async updateComponent(req: Request, res: Response, next: NextFunction) {
    const { error, value } = componentSchema.fork(['type'], (s) => s.optional()).validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const data = await PricingService.updateComponent(req.params.componentId, value);
      return responseSuccess(res, 200, data, 'Pricing component updated');
    } catch (error) {
      next(error);
    }
  }

  static async deleteComponent(req: Request, res: Response, next: NextFunction) {
    try {
      await PricingService.deleteComponent(req.params.componentId);
      return responseSuccess(res, 200, null, 'Pricing component removed');
    } catch (error) {
      next(error);
    }
  }

  /** Dry run of the activation checks, so an admin can see what is wrong first. */
  static async validate(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await PricingService.validateConfiguration(req.params.id);
      return responseSuccess(res, 200, data);
    } catch (error) {
      next(error);
    }
  }

  static async activate(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await PricingService.activateConfiguration(req.params.id);
      return responseSuccess(res, 200, data, 'Pricing configuration is now live');
    } catch (error) {
      next(error);
    }
  }

  static async archive(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await PricingService.archiveConfiguration(req.params.id);
      return responseSuccess(res, 200, data, 'Pricing configuration archived');
    } catch (error) {
      next(error);
    }
  }
}
