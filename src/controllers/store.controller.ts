import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import StoreService from '../services/store.service';
import { responseSuccess, responseError } from '../helpers/response.helper';
import { Users } from '@prisma/client';

export default class StoreController {
  static async createStore(req: Request, res: Response, next: NextFunction) {
    try {
      // Define the much cleaner Joi Schema for a standard application/json payload
      const schema = Joi.object({
        storeData: Joi.object({
          storeName: Joi.string().required(),
          description: Joi.string().allow('', null).optional(),
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

        // The frontend now simply passes the S3 keys it successfully uploaded
        documents: Joi.object({
          mayorsPermitFileName: Joi.string().required(),
          mayorsPermitKey: Joi.string().required(),
          tinIdFileName: Joi.string().required(),
          tinIdKey: Joi.string().required(),
          dtiCertificateFileName: Joi.string().required(),
          dtiCertificateKey: Joi.string().required(),
          govIdFileName: Joi.string().required(),
          govIdKey: Joi.string().required(),
        }).required(),
      });

      const { error, value } = schema.validate(req.body);
      if (error) return responseError(res, 400, error.message);

      const user = req.user as Users & { seller?: { id: string } };
      const sellerId = user.seller?.id;

      if (!sellerId) {
        return responseError(res, 403, 'User is not registered as a seller.');
      }

      // Map the provided keys directly to the FileUploadData interface your service expects
      const uploadedFiles = [
        {
          fileName: value.documents.mayorsPermitFileName,
          fileUrl: value.documents.mayorsPermitKey, // We store the S3 Key in the DB as the URL/Path
          documentType: 'MAYORS_PERMIT' as const,
        },
        {
          fileName: value.documents.tinIdFileName,
          fileUrl: value.documents.tinIdKey,
          documentType: 'TIN_ID' as const,
        },
        {
          fileName: value.documents.dtiCertificateFileName,
          fileUrl: value.documents.dtiCertificateKey,
          documentType: 'DTI_CERTIFICATE' as const,
        },
        {
          fileName: value.documents.govIdFileName,
          fileUrl: value.documents.govIdKey,
          documentType: 'GOV_ID' as const,
        },
      ];

      // Pass directly to the service. The backend does NO file processing here.
      const newStore = await StoreService.createStoreWithDocuments(
        sellerId,
        value.storeData,
        value.locationData,
        value.hoursData,
        uploadedFiles,
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
        value.lat,
        value.lng,
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
}
