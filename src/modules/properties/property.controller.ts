import type { NextFunction, Request, Response } from 'express';
import { propertySchema, updateMetadataSchema } from './schema/property.schema';
import { sellerCapacityMap, propertyTypeMap } from './constant/property.constant';
import { mapMetadata, assertMetadataRules } from './helpers/property.helper';
import { responseError, responseSuccess } from '../../helpers/response.helper';
import PropertyService from './property.service';
import { resolveAccessibleStoreIds } from '../organization/storeAccess';
import type { AuthUser } from '../auth/auth.repository';

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
        ...mapMetadata(value),
      });

      return responseSuccess(res, 201, property, 'House or lot saved successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async getMine(req: Request, res: Response, next: NextFunction) {
    try {
      const { storeIds, hasOrg, hasSellerRow } = await resolveAccessibleStoreIds(
        req.user as AuthUser,
      );
      if (!hasOrg && !hasSellerRow) {
        return responseError(res, 403, 'User is not registered as a seller.');
      }

      const properties = await PropertyService.getMyProperties(storeIds);
      return responseSuccess(res, 200, properties);
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { storeIds, hasOrg, hasSellerRow } = await resolveAccessibleStoreIds(
        req.user as AuthUser,
      );
      if (!hasOrg && !hasSellerRow) {
        return responseError(res, 403, 'User is not registered as a seller.');
      }

      const property = await PropertyService.getPropertyById(storeIds, req.params.id);
      return responseSuccess(res, 200, property);
    } catch (error) {
      const err = error as { status?: 404; message?: string };
      if (err.status) {
        return responseError(res, err.status, err.message || 'Property not found.');
      }
      next(error);
    }
  }

  static async getDashboard(req: Request, res: Response, next: NextFunction) {
    try {
      const { storeIds, hasOrg, hasSellerRow } = await resolveAccessibleStoreIds(
        req.user as AuthUser,
      );
      if (!hasOrg && !hasSellerRow) {
        return responseError(res, 403, 'User is not registered as a seller.');
      }

      const property = await PropertyService.getVerifiedPropertyDashboard(storeIds, req.params.id);

      return responseSuccess(res, 200, property);
    } catch (error) {
      const err = error as { status?: 403; message?: string };
      if (err.status) {
        return responseError(res, err.status, err.message || 'Property access denied.');
      }
      next(error);
    }
  }

  static async updateMetadata(req: Request, res: Response, next: NextFunction) {
    try {
      const sellerId = req.user?.seller?.id;
      if (!sellerId) {
        return responseError(res, 403, 'User is not registered as a seller.');
      }

      const { error, value } = updateMetadataSchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
      });

      if (error) {
        return responseError(res, 400, 'Invalid property metadata.', {
          details: error.details.map((detail) => detail.message),
        });
      }

      const property = await PropertyService.getSellerProperty(sellerId, req.params.id);

      const ruleError = assertMetadataRules(
        res,
        property.propertyType,
        property.sellerCapacity,
        value,
        true,
      );
      if (ruleError) return ruleError;

      const updated = await PropertyService.updatePropertyMetadata(
        sellerId,
        property.id,
        mapMetadata(value),
      );

      return responseSuccess(res, 200, updated, 'Property metadata updated successfully.');
    } catch (error) {
      const err = error as { status?: 404; message?: string };
      if (err.status) {
        return responseError(res, err.status, err.message || 'Property not found.');
      }
      next(error);
    }
  }
}
