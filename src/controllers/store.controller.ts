import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import StoreService from '../services/store.service';
import { responseSuccess, responseError } from '../helpers/response.helper';
import { Users } from '@prisma/client';

export default class StoreController {
  static async createStore(req: Request, res: Response, next: NextFunction) {
    try {
      const schema = Joi.object({
        storeData: Joi.object({
          storeName: Joi.string().required(),
          description: Joi.string().allow('', null).optional(),
          categoryIds: Joi.array().items(Joi.string()).min(1).required(),
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

        hoursData: Joi.array()
          .items(
            Joi.object({
              dayOfWeek: Joi.number().min(0).max(6).required(),
              openTime: Joi.string().required(),
              closeTime: Joi.string().required(),
              isClosed: Joi.boolean().default(false),
            }),
          )
          .min(1)
          .required(),

        // Validation for the raw S3 keys
        documents: Joi.object({
          mayorsPermitFileName: Joi.string().required(),
          mayorsPermitKey: Joi.string().required(),
          dtiCertificateFileName: Joi.string().required(),
          dtiCertificateKey: Joi.string().required(),
          birCertificateFileName: Joi.string().required(),
          birCertificateKey: Joi.string().required(),
          secCertificateFileName: Joi.string().required(),
          secCertificateKey: Joi.string().required(),
        }).optional(), // revert to required to return to original logic
      });

      const { error, value } = schema.validate(req.body);
      if (error) return responseError(res, 400, error.message);

      const user = req.user as Users & { seller?: { id: string } };
      const sellerId = user.seller?.id;

      if (!sellerId) {
        return responseError(res, 403, 'User is not registered as a seller.');
      }

      // Controller passes the raw data object directly to the service.
      const newStore = await StoreService.createStoreWithDocuments(
        sellerId,
        value.storeData,
        value.locationData,
        value.hoursData,
        value.documents,
      );

      return responseSuccess(res, 201, newStore, 'Store created successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async getNearby(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      north: Joi.number().required(),
      south: Joi.number().required(),
      east: Joi.number().required(),
      west: Joi.number().required(),
      limit: Joi.number().integer().min(1).max(500).default(100),
      offset: Joi.number().integer().min(0).default(0),
      categoryId: Joi.string().optional(),
      // Optional free-text filter on store name / description.
      search: Joi.string().trim().allow('').optional(),
      // Optional: user's exact position for precise distance calculation.
      // Falls back to bounding-box midpoint in the service if omitted.
      lat: Joi.number().optional(),
      lng: Joi.number().optional(),
    });

    const { error, value } = schema.validate(req.query);
    if (error) return responseError(res, 400, error.message);

    try {
      const data = await StoreService.getNearbyStores(
        value.north,
        value.south,
        value.east,
        value.west,
        value.limit,
        value.offset,
        value.categoryId,
        value.lat,
        value.lng,
        value.search,
      );
      return responseSuccess(res, 200, data);
    } catch (error) {
      next(error);
    }
  }

  static async getMyStores(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user as Users & { seller?: { id: string } };
      const sellerId = user.seller?.id;

      if (!sellerId) {
        return responseError(res, 403, 'User is not registered as a seller.');
      }

      const stores = await StoreService.getMyStores(sellerId);

      return responseSuccess(res, 200, stores);
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    const { id } = req.params;

    if (!id) {
      return responseError(res, 400, 'Store id is required.');
    }

    try {
      const store = await StoreService.getStoreById(id);
      return responseSuccess(res, 200, store);
    } catch (error) {
      const err = error as { status?: Parameters<typeof responseError>[1]; message?: string };
      if (err.status) {
        return responseError(res, err.status, err.message || 'An error occurred');
      }
      next(error);
    }
  }
}
