import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import StoreService from '../services/store.service';
import { responseSuccess, responseError } from '../helpers/response.helper';
import S3Util from '../utils/s3.util';
import { Users } from '@prisma/client';

export default class StoreController {
  static async createStore(req: Request, res: Response, next: NextFunction) {
    // Extract files from Multer
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    if (!files || !files.mayorsPermit || !files.tinId || !files.dtiCertificate || !files.govId) {
      return responseError(res, 400, 'Missing required compliance documents.');
    }

    try {
      // Parse the stringified JSON fields from the request body
      // If the frontend forgets to send them, we default to empty structures to let Joi catch the error safely.
      const storeData = req.body.storeData ? JSON.parse(req.body.storeData) : {};
      const locationData = req.body.locationData ? JSON.parse(req.body.locationData) : {};
      const hoursData = req.body.hoursData ? JSON.parse(req.body.hoursData) : [];

      // Define the Joi Schema for the parsed data
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
              openTime: Joi.string().required(), // Ideally add regex for "HH:mm"
              closeTime: Joi.string().required(),
              isClosed: Joi.boolean().default(false),
            }),
          )
          .min(1)
          .required(),
      });

      // Validate the parsed objects
      const { error, value } = schema.validate({ storeData, locationData, hoursData });
      if (error) return responseError(res, 400, error.message);

      // Identify the Seller
      const user = req.user as Users & { seller?: { id: string } };
      const sellerId = user.seller?.id;

      if (!sellerId) {
        return responseError(res, 403, 'User is not registered as a seller.');
      }

      const uploadPromises = [];

      if (files.mayorsPermit) {
        uploadPromises.push(
          S3Util.uploadBuffer(files.mayorsPermit[0], 'compliance').then((url) => ({
            fileName: files.mayorsPermit[0].originalname,
            fileUrl: url,
            documentType: 'MAYORS_PERMIT' as const,
          })),
        );
      }

      if (files.tinId) {
        uploadPromises.push(
          S3Util.uploadBuffer(files.tinId[0], 'compliance').then((url) => ({
            fileName: files.tinId[0].originalname,
            fileUrl: url,
            documentType: 'TIN_ID' as const,
          })),
        );
      }

      if (files.dtiCertificate) {
        uploadPromises.push(
          S3Util.uploadBuffer(files.dtiCertificate[0], 'compliance').then((url) => ({
            fileName: files.dtiCertificate[0].originalname,
            fileUrl: url,
            documentType: 'DTI_CERTIFICATE' as const,
          })),
        );
      }

      if (files.govId) {
        uploadPromises.push(
          S3Util.uploadBuffer(files.govId[0], 'compliance').then((url) => ({
            fileName: files.govId[0].originalname,
            fileUrl: url,
            documentType: 'GOV_ID' as const,
          })),
        );
      }

      const uploadedFiles = await Promise.all(uploadPromises);

      const newStore = await StoreService.createStoreWithDocuments(
        sellerId,
        value.storeData,
        value.locationData,
        value.hoursData,
        uploadedFiles,
      );

      return responseSuccess(
        res,
        200,
        newStore,
        'Controller parsed data successfully. Ready for cloud upload logic.',
      );
    } catch (error) {
      if (error instanceof SyntaxError) {
        return responseError(res, 400, 'Invalid JSON format in request body.');
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
}
