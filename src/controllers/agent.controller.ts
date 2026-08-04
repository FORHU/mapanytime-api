import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import AgentService from '../services/agent.service';
import { responseSuccess, responseError } from '../helpers/response.helper';

const documentSchema = Joi.object({
  mayorsPermitFileName: Joi.string(),
  mayorsPermitKey: Joi.string(),
  dtiCertificateFileName: Joi.string(),
  dtiCertificateKey: Joi.string(),
  birCertificateFileName: Joi.string(),
  birCertificateKey: Joi.string(),
  secCertificateFileName: Joi.string(),
  secCertificateKey: Joi.string(),
}).optional();

const onboardingSchema = Joi.object({
  storeData: Joi.object({
    storeName: Joi.string().required(),
    description: Joi.string().allow('').optional(),
    categoryIds: Joi.array().items(Joi.string()).min(1).required(),
    email: Joi.string().email({ tlds: { allow: false } }).optional(),
    phone: Joi.string().allow('').optional(),
  }).required(),
  locationData: Joi.object({
    currentAddress: Joi.string().required(),
    homeAddress: Joi.string().required(),
    city: Joi.string().required(),
    province: Joi.string().required(),
    zipCode: Joi.string().required(),
    country: Joi.string().required(),
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
  }).required(),
  hoursData: Joi.array().items(Joi.object({
    dayOfWeek: Joi.number().integer().min(0).max(6).required(),
    openMinutes: Joi.number().integer().min(0).max(1440).required(),
    closeMinutes: Joi.number().integer().min(0).max(1440).required(),
    isClosed: Joi.boolean().default(false),
  })).min(1).required(),
  documents: documentSchema,
});

export default class AgentController {
  static async registerSeller(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      firstName: Joi.string().required(),
      lastName: Joi.string().required(),
      email: Joi.string().email({ tlds: { allow: false } }).required(),
      phoneNumber: Joi.string().allow('').optional(),
      storeName: Joi.string().required(),
      businessEmail: Joi.string().email({ tlds: { allow: false } }).required(),
      businessPhone: Joi.string().required(),
      sellerPlan: Joi.string().required(),
      agentNotes: Joi.string().allow('').optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const result = await AgentService.registerSeller({
        ...value,
        agentId: (req.user as { id: string }).id,
      });
      return responseSuccess(res, 201, result, 'Seller registered successfully');
    } catch (err) {
      next(err);
    }
  }

  static async onboardSeller(req: Request, res: Response, next: NextFunction) {
    const { error, value } = onboardingSchema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const result = await AgentService.onboardSeller(req.params.sellerId, value);
      return responseSuccess(res, 200, result, 'Seller onboarding completed');
    } catch (err) {
      next(err);
    }
  }
}
