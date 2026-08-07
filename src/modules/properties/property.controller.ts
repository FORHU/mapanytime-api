import { NextFunction, Request, Response } from 'express';
import Joi from 'joi';
import { responseError, responseSuccess } from '../../helpers/response.helper';
import PropertyService, { type PropertyMetadataInput } from './property.service';

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
  // Step 3-5 metadata (optional on create; enforced strictly via PATCH).
  lotArea: Joi.number().min(0).optional(),
  terrain: Joi.string().valid('flat', 'sloping', 'rolling', 'mountainous').optional(),
  floorArea: Joi.number().min(0).optional(),
  bedrooms: Joi.number().integer().min(0).optional(),
  bathrooms: Joi.number().integer().min(0).optional(),
  parkingSpaces: Joi.number().integer().min(0).optional(),
  yearBuilt: Joi.number().integer().min(1800).max(new Date().getFullYear()).optional(),
  furnishing: Joi.string().valid('bare', 'semi-furnished', 'fully-furnished').optional(),
  titleType: Joi.string().valid('tct', 'oct', 'tax-declaration').optional(),
  titleNumber: Joi.string().trim().min(1).optional(),
  scannedTitleFile: Joi.string().trim().optional(),
  latestTaxReceiptFile: Joi.string().trim().optional(),
  lotPlanFile: Joi.string().trim().optional(),
  authorityToSellFile: Joi.string().trim().optional(),
  sellingPrice: Joi.number().min(0).optional(),
  negotiability: Joi.string().valid('fixed', 'negotiable').optional(),
  taxResponsibilities: Joi.string().valid('seller', 'buyer', 'standard-sharing').optional(),
  hoaDues: Joi.number().min(0).optional(),
}).custom((value, helpers) => {
  if (value.propertyType === 'raw-land') {
    const houseOnly = ['floorArea', 'bedrooms', 'bathrooms', 'parkingSpaces', 'yearBuilt', 'furnishing'];
    const present = houseOnly.filter((field) => value[field] !== undefined);
    if (present.length > 0) {
      return helpers.error('any.custom', {
        message: `Field(s) ${present.join(', ')} only apply to House & Lot properties.`,
      });
    }
  }
  return value;
});

const updateMetadataSchema = Joi.object({
  lotArea: Joi.number().min(0).optional(),
  terrain: Joi.string().valid('flat', 'sloping', 'rolling', 'mountainous').optional(),
  floorArea: Joi.number().min(0).optional(),
  bedrooms: Joi.number().integer().min(0).optional(),
  bathrooms: Joi.number().integer().min(0).optional(),
  parkingSpaces: Joi.number().integer().min(0).optional(),
  yearBuilt: Joi.number().integer().min(1800).max(new Date().getFullYear()).optional(),
  furnishing: Joi.string().valid('bare', 'semi-furnished', 'fully-furnished').optional(),
  titleType: Joi.string().valid('tct', 'oct', 'tax-declaration').optional(),
  titleNumber: Joi.string().trim().min(1).optional(),
  scannedTitleFile: Joi.string().trim().optional(),
  latestTaxReceiptFile: Joi.string().trim().optional(),
  lotPlanFile: Joi.string().trim().optional(),
  authorityToSellFile: Joi.string().trim().optional(),
  sellingPrice: Joi.number().min(0).optional(),
  negotiability: Joi.string().valid('fixed', 'negotiable').optional(),
  taxResponsibilities: Joi.string().valid('seller', 'buyer', 'standard-sharing').optional(),
  hoaDues: Joi.number().min(0).optional(),
}).min(1);

const sellerCapacityMap = {
  owner: 'OWNER',
  broker: 'BROKER',
  proxy: 'PROXY',
} as const;

const propertyTypeMap = {
  'house-lot': 'HOUSE_LOT',
  'raw-land': 'RAW_LAND',
} as const;

const terrainMap = {
  flat: 'FLAT',
  sloping: 'SLOPING',
  rolling: 'ROLLING',
  mountainous: 'MOUNTAINOUS',
} as const;

const furnishingMap = {
  bare: 'BARE',
  'semi-furnished': 'SEMI_FURNISHED',
  'fully-furnished': 'FULLY_FURNISHED',
} as const;

const titleTypeMap = {
  tct: 'TCT',
  oct: 'OCT',
  'tax-declaration': 'TAX_DECLARATION',
} as const;

const negotiabilityMap = {
  fixed: 'FIXED',
  negotiable: 'NEGOTIABLE',
} as const;

const taxResponsibilitiesMap = {
  seller: 'SELLER',
  buyer: 'BUYER',
  'standard-sharing': 'STANDARD_SHARING',
} as const;

const HOUSE_ONLY_FIELDS = ['floorArea', 'bedrooms', 'bathrooms', 'parkingSpaces', 'yearBuilt', 'furnishing'];

/** Maps the API's lowercase slug values to their DB enum values. */
function mapMetadata(value: Record<string, unknown>): PropertyMetadataInput {
  return {
    lotArea: value.lotArea as number | undefined,
    terrain: value.terrain ? terrainMap[value.terrain as keyof typeof terrainMap] : undefined,
    floorArea: value.floorArea as number | undefined,
    bedrooms: value.bedrooms as number | undefined,
    bathrooms: value.bathrooms as number | undefined,
    parkingSpaces: value.parkingSpaces as number | undefined,
    yearBuilt: value.yearBuilt as number | undefined,
    furnishing: value.furnishing
      ? furnishingMap[value.furnishing as keyof typeof furnishingMap]
      : undefined,
    titleType: value.titleType ? titleTypeMap[value.titleType as keyof typeof titleTypeMap] : undefined,
    titleNumber: value.titleNumber as string | undefined,
    scannedTitleFile: value.scannedTitleFile as string | undefined,
    latestTaxReceiptFile: value.latestTaxReceiptFile as string | undefined,
    lotPlanFile: value.lotPlanFile as string | undefined,
    authorityToSellFile: value.authorityToSellFile as string | undefined,
    sellingPrice: value.sellingPrice as number | undefined,
    negotiability: value.negotiability
      ? negotiabilityMap[value.negotiability as keyof typeof negotiabilityMap]
      : undefined,
    taxResponsibilities: value.taxResponsibilities
      ? taxResponsibilitiesMap[value.taxResponsibilities as keyof typeof taxResponsibilitiesMap]
      : undefined,
    hoaDues: value.hoaDues as number | undefined,
  };
}

/**
 * Branching rules for the metadata payload.
 * strict=true (used by PATCH) additionally requires the Authority to Sell /
 * SPA for broker/proxy sellers, matching the frontend form rule.
 */
function assertMetadataRules(
  res: Response,
  propertyType: 'HOUSE_LOT' | 'RAW_LAND',
  sellerCapacity: 'OWNER' | 'BROKER' | 'PROXY',
  value: Record<string, unknown>,
  strict: boolean,
): Response | null {
  if (propertyType === 'RAW_LAND') {
    const present = HOUSE_ONLY_FIELDS.filter((field) => value[field] !== undefined);
    if (present.length > 0) {
      return responseError(res, 400, `Field(s) ${present.join(', ')} only apply to House & Lot properties.`);
    }
  }

  if (sellerCapacity === 'OWNER') {
    if (value.authorityToSellFile !== undefined) {
      return responseError(res, 400, 'Authority to Sell / SPA is not allowed for property owners.');
    }
  } else if (strict && value.authorityToSellFile === undefined) {
    return responseError(res, 400, 'Authority to Sell / SPA is required for broker or proxy sellers.');
  }

  return null;
}

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

  static async getDashboard(req: Request, res: Response, next: NextFunction) {
    try {
      const sellerId = req.user?.seller?.id;
      if (!sellerId) {
        return responseError(res, 403, 'User is not registered as a seller.');
      }

      const property = await PropertyService.getVerifiedPropertyDashboard(
        sellerId,
        req.params.id,
      );

      return responseSuccess(res, 200, property);
    } catch (error) {
      const err = error as { status?: 403; message?: string };
      if (err.status) {
        return responseError(res, err.status, err.message || 'Property access denied.');
      }
      next(error);
    }
  }

  /** Updates Step 3-5 metadata for an existing property. */
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
