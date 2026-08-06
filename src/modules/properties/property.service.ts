import { PROPERTYTYPE, PROPERTYSTATUS, SELLERCAPACITY } from '@prisma/client';
import { prisma } from '../../utils/prisma';

export type CreatePropertyInput = {
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
        status: PROPERTYSTATUS.DRAFT,
      },
    });
  }

  static async getMyProperties(sellerId: string) {
    return prisma.properties.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async getPropertyById(sellerId: string, propertyId: string) {
    const property = await prisma.properties.findFirst({
      where: { id: propertyId, sellerId },
    });

    if (!property) {
      throw { status: 404, message: 'Property not found.' };
    }

    return property;
  }
}
