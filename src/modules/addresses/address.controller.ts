import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import AddressService from './address.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';

const ADDRESS_TYPES = ['HOME', 'OFFICE', 'BILLING'];

/** Optional text part: empty means "not given" and is stored as null. */
const optionalPart = (max: number) => Joi.string().trim().max(max).allow('', null).optional();

const fields = {
  addressType: Joi.string().valid(...ADDRESS_TYPES),
  recipientName: Joi.string().trim().max(120),
  phoneNumber: Joi.string()
    .trim()
    .pattern(/^\+?[0-9][0-9\s-]{6,19}$/)
    .messages({ 'string.pattern.base': 'phoneNumber must be a phone number' }),
  addressLine1: Joi.string().trim().max(300),
  addressLine2: optionalPart(300),
  barangay: optionalPart(100),
  city: optionalPart(100),
  province: optionalPart(100),
  zipCode: Joi.string()
    .trim()
    .pattern(/^\d{4}$/)
    .allow('', null)
    .optional()
    .messages({ 'string.pattern.base': 'zipCode must be 4 digits' }),
  isDefault: Joi.boolean(),
};

const createSchema = Joi.object({
  ...fields,
  recipientName: fields.recipientName.required(),
  phoneNumber: fields.phoneNumber.required(),
  addressLine1: fields.addressLine1.required(),
});

const updateSchema = Joi.object(fields).min(1);

/** Empty optional parts become null, so "cleared" and "never set" look alike. */
function emptyToNull<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, v === '' ? null : v])) as T;
}

function userIdOf(req: Request) {
  return (req.user as { id: string } | undefined)?.id;
}

export default class AddressController {
  /** GET /api/v1/addresses — the caller's addresses, default first. */
  static async index(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = userIdOf(req);
      if (!userId) return responseError(res, 401, 'Unauthorized access.');
      const data = await AddressService.list(userId);
      return responseSuccess(res, 200, data, 'Addresses fetched successfully');
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/v1/addresses — returns the existing row for a duplicate. */
  static async create(req: Request, res: Response, next: NextFunction) {
    const { error, value } = createSchema.validate(req.body);
    if (error) return responseError(res, 400, error.message);
    try {
      const userId = userIdOf(req);
      if (!userId) return responseError(res, 401, 'Unauthorized access.');
      const { address, created } = await AddressService.add(userId, emptyToNull(value));
      return created
        ? responseSuccess(res, 201, address, 'Address added')
        : responseSuccess(res, 200, address, 'You already have this address');
    } catch (error) {
      next(error);
    }
  }

  /** PATCH /api/v1/addresses/:id */
  static async update(req: Request<{ id: string }>, res: Response, next: NextFunction) {
    const { error, value } = updateSchema.validate(req.body);
    if (error) return responseError(res, 400, error.message);
    try {
      const userId = userIdOf(req);
      if (!userId) return responseError(res, 401, 'Unauthorized access.');
      const data = await AddressService.update(userId, req.params.id, emptyToNull(value));
      return responseSuccess(res, 200, data, 'Address updated');
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/v1/addresses/:id/default */
  static async setDefault(req: Request<{ id: string }>, res: Response, next: NextFunction) {
    try {
      const userId = userIdOf(req);
      if (!userId) return responseError(res, 401, 'Unauthorized access.');
      const data = await AddressService.setDefault(userId, req.params.id);
      return responseSuccess(res, 200, data, 'Default address updated');
    } catch (error) {
      next(error);
    }
  }

  /** DELETE /api/v1/addresses/:id */
  static async remove(req: Request<{ id: string }>, res: Response, next: NextFunction) {
    try {
      const userId = userIdOf(req);
      if (!userId) return responseError(res, 401, 'Unauthorized access.');
      await AddressService.remove(userId, req.params.id);
      return responseSuccess(res, 200, null, 'Address deleted');
    } catch (error) {
      next(error);
    }
  }
}
