import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import StoreService from './store.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';
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

        // StoreHours stores minutes since midnight (480 = 08:00), so the
        // payload is validated in the same unit it is persisted in.
        hoursData: Joi.array()
          .items(
            Joi.object({
              dayOfWeek: Joi.number().min(0).max(6).required(),
              openMinutes: Joi.number().integer().min(0).max(1440).required(),
              closeMinutes: Joi.number().integer().min(0).max(1440).required(),
              isClosed: Joi.boolean().default(false),
            }),
          )
          .min(1)
          .required(),

        documents: Joi.object({
          mayorsPermitFileName: Joi.string().required(),
          mayorsPermitKey: Joi.string().required(),
          dtiCertificateFileName: Joi.string().required(),
          dtiCertificateKey: Joi.string().required(),
          birCertificateFileName: Joi.string().required(),
          birCertificateKey: Joi.string().required(),
          secCertificateFileName: Joi.string().required(),
          secCertificateKey: Joi.string().required(),
        }).optional(),
      });

      const { error, value } = schema.validate(req.body);
      if (error) return responseError(res, 400, error.message);

      const user = req.user as Users & { seller?: { id: string } };
      const sellerId = user.seller?.id;

      if (!sellerId) {
        return responseError(res, 403, 'User is not registered as a seller.');
      }

      const newStore = await StoreService.createStoreWithDocuments(
        sellerId,
        value.storeData,
        value.locationData,
        value.hoursData,
        value.documents,
        { completeOnboarding: true },
      );

      return responseSuccess(res, 201, newStore, 'Store created successfully.');
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /v1/stores/:id — partial update of a seller's own store profile.
   *
   * Two field names differ between the wire contract and the schema, so they
   * are translated in the service rather than leaking Prisma's names to the
   * client: `categoryId` → `Stores.primaryCategoryId`, and `postalCode` →
   * `StoreLocations.zipCode`.
   *
   * Every field is optional — this is a PATCH, and the web sends only what the
   * form holds. `min(1)` on the whole object rejects an empty body rather than
   * issuing a no-op UPDATE.
   */
  static async updateStore(req: Request, res: Response, next: NextFunction) {
    const { id } = req.params;
    if (!id) return responseError(res, 400, 'Store id is required.');

    const schema = Joi.object({
      storeName: Joi.string().trim().min(1).optional(),
      description: Joi.string().allow('', null).optional(),
      // Blank is how the form clears an optional contact field, so '' is
      // allowed here and stored as null.
      phone: Joi.alternatives(Joi.string().allow(''), Joi.number()).optional(),
      email: Joi.alternatives(Joi.string().email(), Joi.string().valid('')).optional(),
      categoryId: Joi.string().optional(),
      isActive: Joi.boolean().optional(),

      currentAddress: Joi.string().allow('').optional(),
      city: Joi.string().allow('').optional(),
      province: Joi.string().allow('').optional(),
      postalCode: Joi.alternatives(Joi.string().allow(''), Joi.number()).optional(),
      country: Joi.string().allow('').optional(),
    })
      .min(1)
      .messages({ 'object.min': 'No fields to update.' });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const user = req.user as Users & { seller?: { id: string } };
      const sellerId = user.seller?.id;

      if (!sellerId) {
        return responseError(res, 403, 'User is not registered as a seller.');
      }

      const updated = await StoreService.updateStore(id, sellerId, value);
      return responseSuccess(res, 200, updated, 'Store updated successfully.');
    } catch (error) {
      const err = error as { status?: Parameters<typeof responseError>[1]; message?: string };
      if (err.status) {
        return responseError(res, err.status, err.message || 'An error occurred');
      }
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
      search: Joi.string().trim().allow('').optional(),
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

  static async getStoreProducts(req: Request, res: Response, next: NextFunction) {
    const { id } = req.params;
    const schema = Joi.object({
      limit: Joi.number().integer().min(1).max(100).default(20),
      offset: Joi.number().integer().min(0).default(0),
    });
    const { error, value } = schema.validate(req.query);
    if (error) return responseError(res, 400, error.message);

    try {
      const data = await StoreService.getStoreProducts(id, value.limit, value.offset);
      return responseSuccess(res, 200, data);
    } catch (error) {
      const err = error as { status?: Parameters<typeof responseError>[1]; message?: string };
      if (err.status) return responseError(res, err.status, err.message || 'An error occurred');
      next(error);
    }
  }
}
