import {
  FURNISHING,
  NEGOTIABILITY,
  PROPERTYTYPE,
  PROPERTYSTATUS,
  SELLERCAPACITY,
  TAXRESPONSIBILITY,
  TERRAIN,
  TITLETYPE,
  type Properties,
} from '@prisma/client';
import { prisma } from '../../utils/prisma';

/**
 * Step 3-5 metadata for a property listing.
 * All fields optional: House & Lot-only fields (floor area, bedrooms, ...)
 * stay null for Raw Land, and pricing/specs can be filled after creation.
 */
export type PropertyMetadataInput = {
  lotArea?: number;
  terrain?: TERRAIN;
  floorArea?: number;
  bedrooms?: number;
  bathrooms?: number;
  parkingSpaces?: number;
  yearBuilt?: number;
  furnishing?: FURNISHING;
  titleType?: TITLETYPE;
  titleNumber?: string;
  scannedTitleFile?: string;
  latestTaxReceiptFile?: string;
  lotPlanFile?: string;
  authorityToSellFile?: string;
  sellingPrice?: number;
  negotiability?: NEGOTIABILITY;
  taxResponsibilities?: TAXRESPONSIBILITY;
  hoaDues?: number;
};

export type CreatePropertyInput = PropertyMetadataInput & {
  sellerCapacity: SELLERCAPACITY;
  legalName: string;
  phone: string;
  email: string;
  governmentIdName?: string;
  propertyType: PROPERTYTYPE;
  address: string;
  latitude: number;
  longitude: number;
  subdivision?: string;
};

/**
 * Derived value, never stored: sellingPrice / lotArea.
 * Falls back to 0 (₱0.00) when the price or lot area is missing/invalid,
 * mirroring the guard used by the frontend form.
 */
export function computePricePerSqm(sellingPrice?: number, lotArea?: number): number {
  if (sellingPrice == null || lotArea == null) return 0;
  if (!isFinite(sellingPrice) || !isFinite(lotArea) || lotArea <= 0) return 0;
  return Math.round((sellingPrice / lotArea) * 100) / 100;
}

/** Attaches the derived pricePerSqm to a Prisma Properties record. */
function withPricePerSqm(property: Properties) {
  return {
    ...property,
    pricePerSqm: computePricePerSqm(
      property.sellingPrice ? Number(property.sellingPrice) : 0,
      property.lotArea ?? 0,
    ),
  };
}

export default class PropertyService {
  static async createProperty(sellerId: string, input: CreatePropertyInput) {
    return prisma.properties.create({
      data: {
        sellerId,
        sellerCapacity: input.sellerCapacity,
        legalName: input.legalName,
        phone: input.phone,
        email: input.email,
        governmentIdName: input.governmentIdName,
        propertyType: input.propertyType,
        address: input.address,
        latitude: input.latitude,
        longitude: input.longitude,
        subdivision: input.subdivision,
        status: PROPERTYSTATUS.PENDING_REVIEW,
        // Step 3-5 metadata
        lotArea: input.lotArea,
        terrain: input.terrain,
        floorArea: input.floorArea,
        bedrooms: input.bedrooms,
        bathrooms: input.bathrooms,
        parkingSpaces: input.parkingSpaces,
        yearBuilt: input.yearBuilt,
        furnishing: input.furnishing,
        titleType: input.titleType,
        titleNumber: input.titleNumber,
        scannedTitleFile: input.scannedTitleFile,
        latestTaxReceiptFile: input.latestTaxReceiptFile,
        lotPlanFile: input.lotPlanFile,
        authorityToSellFile: input.authorityToSellFile,
        sellingPrice: input.sellingPrice,
        negotiability: input.negotiability,
        taxResponsibilities: input.taxResponsibilities,
        hoaDues: input.hoaDues,
      },
    });
  }

  static async getMyProperties(sellerId: string) {
    const properties = await prisma.properties.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
    });

    return properties.map(withPricePerSqm);
  }

  static async getPropertyById(sellerId: string, propertyId: string) {
    const property = await prisma.properties.findFirst({
      where: { id: propertyId, sellerId },
    });

    if (!property) {
      throw { status: 404, message: 'Property not found.' };
    }

    return withPricePerSqm(property);
  }

  static async getVerifiedPropertyDashboard(sellerId: string, propertyId: string) {
    const property = await prisma.properties.findFirst({
      where: {
        id: propertyId,
        sellerId,
        propertyType: { in: ['HOUSE_LOT', 'RAW_LAND'] },
        status: 'ACTIVE',
      },
    });

    if (!property) {
      throw {
        status: 403,
        message: 'This property is not verified or you do not have access.',
      };
    }

    return withPricePerSqm(property);
  }

  /** Fetches the seller's own property without mapping. Used before metadata updates. */
  static async getSellerProperty(sellerId: string, propertyId: string) {
    const property = await prisma.properties.findFirst({
      where: { id: propertyId, sellerId },
    });

    if (!property) {
      throw { status: 404, message: 'Property not found.' };
    }

    return property;
  }

  /**
   * Updates Step 3-5 metadata. Only provided fields are changed (undefined is
   * ignored by Prisma); absent fields are left untouched.
   */
  static async updatePropertyMetadata(
    sellerId: string,
    propertyId: string,
    input: PropertyMetadataInput,
  ) {
    await this.getSellerProperty(sellerId, propertyId);

    const updated = await prisma.properties.update({
      where: { id: propertyId },
      data: {
        lotArea: input.lotArea,
        terrain: input.terrain,
        floorArea: input.floorArea,
        bedrooms: input.bedrooms,
        bathrooms: input.bathrooms,
        parkingSpaces: input.parkingSpaces,
        yearBuilt: input.yearBuilt,
        furnishing: input.furnishing,
        titleType: input.titleType,
        titleNumber: input.titleNumber,
        scannedTitleFile: input.scannedTitleFile,
        latestTaxReceiptFile: input.latestTaxReceiptFile,
        lotPlanFile: input.lotPlanFile,
        authorityToSellFile: input.authorityToSellFile,
        sellingPrice: input.sellingPrice,
        negotiability: input.negotiability,
        taxResponsibilities: input.taxResponsibilities,
        hoaDues: input.hoaDues,
      },
    });

    return withPricePerSqm(updated);
  }
}
