import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import PricingService from './pricing.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';

export default class PricingController {
  static async calculate(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      subtotalAmount: Joi.number().positive().required(),
      discountAmount: Joi.number().min(0).default(0),
      shippingAmount: Joi.number().min(0).default(0),
      storeId: Joi.string().optional(),
      sellerId: Joi.string().optional(),
      sellerPlan: Joi.string().optional(),
      categoryId: Joi.string().optional(),
      providerId: Joi.string().optional(),
      paymentMethodId: Joi.string().optional(),
      paymentMethodCode: Joi.string().optional(),
      paymentMethodType: Joi.string().optional(),
      paymentFeePayerPolicy: Joi.string().valid('BUYER', 'SELLER', 'PLATFORM', 'SHARED').optional(),
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

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await PricingService.createPricingConfiguration(req.body);
      return responseSuccess(res, 201, data, 'Pricing configuration created');
    } catch (error) {
      next(error);
    }
  }
}
