import {
  FURNISHING,
  NEGOTIABILITY,
  PROPERTYTYPE,
  PROPERTYSTATUS,
  SELLERCAPACITY,
  TAXRESPONSIBILITY,
  TERRAIN,
  TITLETYPE,
  type PropertiesProducts,
} from '@prisma/client';
import { prisma } from '../../utils/prisma';

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
  governmentIdName?: string;
  propertyType: PROPERTYTYPE;
  address: string;
  latitude: number;
  longitude: number;
  subdivision?: string;
};

export function computePricePerSqm(sellingPrice?: number, lotArea?: number): number {
  if (sellingPrice == null || lotArea == null) return 0;
  if (!isFinite(sellingPrice) || !isFinite(lotArea) || lotArea <= 0) return 0;
  return Math.round((sellingPrice / lotArea) * 100) / 100;
}

function withPricePerSqm(property: PropertiesProducts) {
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
    const store = await prisma.stores.findFirst({
      where: { sellerId },
    });

    if (!store) {
      throw { status: 404, message: 'Store not found for this seller.' };
    }

    return prisma.propertiesProducts.create({
      data: {
        storeId: store.id,
        sellerCapacity: input.sellerCapacity,
        legalName: input.legalName,
        governmentIdName: input.governmentIdName,
        propertyType: input.propertyType,
        address: input.address,
        latitude: input.latitude,
        longitude: input.longitude,
        subdivision: input.subdivision,
        status: PROPERTYSTATUS.PENDING_REVIEW,
        lotArea: input.lotArea,
        terrain: input.terrain,
        floorArea: input.floorArea,
        bedrooms: input.bedrooms,
        bathrooms: input.bathrooms,
        parkingSpaces: input.parkingSpaces,
        yearBuilt: input.yearBuilt,
        furnishing: input.furnishing,
        sellingPrice: input.sellingPrice,
        negotiability: input.negotiability,
        taxResponsibilities: input.taxResponsibilities,
        hoaDues: input.hoaDues,
      },
    });
  }

  static async getMyProperties(sellerId: string) {
    const properties = await prisma.propertiesProducts.findMany({
      where: { store: { sellerId } },
      orderBy: { createdAt: 'desc' },
    });

    return properties.map(withPricePerSqm);
  }

  static async getPropertyById(sellerId: string, propertyId: string) {
    const property = await prisma.propertiesProducts.findFirst({
      where: { id: propertyId, store: { sellerId } },
    });

    if (!property) {
      throw { status: 404, message: 'Property not found.' };
    }

    return withPricePerSqm(property);
  }

  static async getVerifiedPropertyDashboard(sellerId: string, propertyId: string) {
    const property = await prisma.propertiesProducts.findFirst({
      where: {
        id: propertyId,
        store: { sellerId },
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

  static async getSellerProperty(sellerId: string, propertyId: string) {
    const property = await prisma.propertiesProducts.findFirst({
      where: { id: propertyId, store: { sellerId } },
    });

    if (!property) {
      throw { status: 404, message: 'Property not found.' };
    }

    return property;
  }

  static async updatePropertyMetadata(
    sellerId: string,
    propertyId: string,
    input: PropertyMetadataInput,
  ) {
    await this.getSellerProperty(sellerId, propertyId);

    // FIX: Changed to propertiesProducts and removed non-existent file fields
    const updated = await prisma.propertiesProducts.update({
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
        sellingPrice: input.sellingPrice,
        negotiability: input.negotiability,
        taxResponsibilities: input.taxResponsibilities,
        hoaDues: input.hoaDues,
      },
    });

    return withPricePerSqm(updated);
  }
}
