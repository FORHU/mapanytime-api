import Joi from 'joi';
import { HOUSE_ONLY_FIELDS } from '../constant/property.constant';
import { money } from '../../../helpers/money.helper';

export const propertySchema = Joi.object({
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
  sellingPrice: money().optional(),
  negotiability: Joi.string().valid('fixed', 'negotiable').optional(),
  taxResponsibilities: Joi.string().valid('seller', 'buyer', 'standard-sharing').optional(),
  hoaDues: money().optional(),
}).custom((value, helpers) => {
  if (value.propertyType === 'raw-land') {
    const present = HOUSE_ONLY_FIELDS.filter((field) => value[field] !== undefined);
    if (present.length > 0) {
      return helpers.error('any.custom', {
        message: `Field(s) ${present.join(', ')} only apply to House & Lot properties.`,
      });
    }
  }
  return value;
});

export const updateMetadataSchema = Joi.object({
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
  sellingPrice: money().optional(),
  negotiability: Joi.string().valid('fixed', 'negotiable').optional(),
  taxResponsibilities: Joi.string().valid('seller', 'buyer', 'standard-sharing').optional(),
  hoaDues: money().optional(),
}).min(1);
