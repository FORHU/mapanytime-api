import type { Response } from 'express';
import { responseError } from '../../../helpers/response.helper';
import type { PropertyMetadataInput } from '../property.service';
import {
  terrainMap,
  furnishingMap,
  titleTypeMap,
  negotiabilityMap,
  taxResponsibilitiesMap,
  HOUSE_ONLY_FIELDS,
} from '../constant/property.constant';

export function mapMetadata(value: Record<string, unknown>): PropertyMetadataInput {
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
    titleType: value.titleType
      ? titleTypeMap[value.titleType as keyof typeof titleTypeMap]
      : undefined,
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
 * `strict=true` (used by PATCH) additionally requires the Authority to Sell /
 * SPA for broker/proxy sellers, matching the frontend form rule.
 */
export function assertMetadataRules(
  res: Response,
  propertyType: 'HOUSE_LOT' | 'RAW_LAND',
  sellerCapacity: 'OWNER' | 'BROKER' | 'PROXY',
  value: Record<string, unknown>,
  strict: boolean,
): Response | null {
  if (propertyType === 'RAW_LAND') {
    const present = HOUSE_ONLY_FIELDS.filter((field) => value[field] !== undefined);
    if (present.length > 0) {
      return responseError(
        res,
        400,
        `Field(s) ${present.join(', ')} only apply to House & Lot properties.`,
      );
    }
  }

  if (sellerCapacity === 'OWNER') {
    if (value.authorityToSellFile !== undefined) {
      return responseError(res, 400, 'Authority to Sell / SPA is not allowed for property owners.');
    }
  } else if (strict && value.authorityToSellFile === undefined) {
    return responseError(
      res,
      400,
      'Authority to Sell / SPA is required for broker or proxy sellers.',
    );
  }

  return null;
}
