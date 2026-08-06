import { NextFunction, Request, Response } from 'express';
import Joi from 'joi';
import { responseError, responseSuccess } from '../../helpers/response.helper';
import PropertyService from './property.service';

const propertySchema = Joi.object({
  sellerCapacity: Joi.string().valid('owner', 'broker', 'proxy').required(),
  legalName: Joi.string().trim().min(1).required(),
  phone: Joi.string().trim().min(1).required(),
  email: Joi.string().email().required(),
  governmentIdName: Joi.string().trim().allow('').optional(),
  propertyType: Joi.string().valid('house-lot', 'raw-land').required(),
  address: Joi.string().trim().min(1).required(),
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required(),
  subdivision: Joi.string().trim().allow('').optional(),
});

const sellerCapacityMap = {
  owner: 'OWNER',
  broker: 'BROKER',
  proxy: 'PROXY',
} as const;

const propertyTypeMap = {
  'house-lot': 'HOUSE_LOT',
  'raw-land': 'RAW_LAND',
} as const;

export default class PropertyController {
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = propertySchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
      });

      if (error) {
        return responseError(res, 400, 'Invalid property data.', {
          details: error.details.map((detail) => detail.message),
        });
      }

      const sellerId = req.user?.seller?.id;
      if (!sellerId) {
        return responseError(res, 403, 'User is not registered as a seller.');
      }

      const property = await PropertyService.createProperty(sellerId, {
        ...value,
        sellerCapacity: sellerCapacityMap[value.sellerCapacity as keyof typeof sellerCapacityMap],
        propertyType: propertyTypeMap[value.propertyType as keyof typeof propertyTypeMap],
        latitude: value.lat,
        longitude: value.lng,
      });

      return responseSuccess(res, 201, property, 'House or lot saved successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async getMine(req: Request, res: Response, next: NextFunction) {
    try {
      const sellerId = req.user?.seller?.id;
      if (!sellerId) {
        return responseError(res, 403, 'User is not registered as a seller.');
      }

      const properties = await PropertyService.getMyProperties(sellerId);
      return responseSuccess(res, 200, properties);
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const sellerId = req.user?.seller?.id;
      if (!sellerId) {
        return responseError(res, 403, 'User is not registered as a seller.');
      }

      const property = await PropertyService.getPropertyById(sellerId, req.params.id);
      return responseSuccess(res, 200, property);
    } catch (error) {
      const err = error as { status?: 404; message?: string };
      if (err.status) {
        return responseError(res, err.status, err.message || 'Property not found.');
      }
      next(error);
    }
  }
}
