import PropertyService, { computePricePerSqm } from '../../src/modules/properties/property.service';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    properties: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  },
}));

const mockedPrisma = prisma.properties as jest.Mocked<typeof prisma.properties>;

const baseCreateInput = {
  sellerCapacity: 'OWNER' as const,
  legalName: 'Juan Dela Cruz',
  phone: '+639171234567',
  email: 'juan@example.com',
  propertyType: 'HOUSE_LOT' as const,
  address: '48 Pine Ridge Rd, Baguio City, Benguet',
  latitude: 16.4164,
  longitude: 120.5931,
};

const basePropertyRecord: Record<string, unknown> = {
  id: 'prop-1',
  sellerId: 'seller-1',
  sellerCapacity: 'OWNER',
  governmentIdName: null,
  subdivision: null,
  rejectionReason: null,
  reviewedAt: null,
  reviewedById: null,
  lotArea: null,
  terrain: null,
  floorArea: null,
  bedrooms: null,
  bathrooms: null,
  parkingSpaces: null,
  yearBuilt: null,
  furnishing: null,
  titleType: null,
  titleNumber: null,
  scannedTitleFile: null,
  latestTaxReceiptFile: null,
  lotPlanFile: null,
  authorityToSellFile: null,
  sellingPrice: null,
  negotiability: null,
  taxResponsibilities: null,
  hoaDues: null,
  legalName: 'Juan Dela Cruz',
  phone: '+639171234567',
  email: 'juan@example.com',
  propertyType: 'HOUSE_LOT',
  address: '48 Pine Ridge Rd, Baguio City, Benguet',
  latitude: 16.4164,
  longitude: 120.5931,
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('PropertyService metadata', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createProperty', () => {
    it('persists Step 3-5 metadata fields', async () => {
      mockedPrisma.create.mockResolvedValue({ ...basePropertyRecord, id: 'prop-1' } as never);

      await PropertyService.createProperty('seller-1', {
        ...baseCreateInput,
        lotArea: 180,
        terrain: 'SLOPING',
        floorArea: 120,
        bedrooms: 3,
        bathrooms: 2,
        parkingSpaces: 2,
        yearBuilt: 2019,
        furnishing: 'FULLY_FURNISHED',
        titleType: 'TCT',
        titleNumber: 'T-08234',
        scannedTitleFile: 'TCT-08234.pdf',
        latestTaxReceiptFile: 'RPT-2026-receipt.pdf',
        authorityToSellFile: 'spa-2026.pdf',
        sellingPrice: 5400000,
        negotiability: 'NEGOTIABLE',
        taxResponsibilities: 'STANDARD_SHARING',
        hoaDues: 750,
      });

      expect(mockedPrisma.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sellerId: 'seller-1',
          lotArea: 180,
          terrain: 'SLOPING',
          bedrooms: 3,
          sellingPrice: 5400000,
          hoaDues: 750,
          authorityToSellFile: 'spa-2026.pdf',
        }),
      });
    });
  });

  describe('updatePropertyMetadata', () => {
    it('throws 404 when the property does not exist for the seller', async () => {
      mockedPrisma.findFirst.mockResolvedValue(null);

      await expect(
        PropertyService.updatePropertyMetadata('seller-1', 'missing', { sellingPrice: 100 }),
      ).rejects.toEqual({ status: 404, message: 'Property not found.' });
    });

    it('updates only provided fields and attaches derived pricePerSqm', async () => {
      mockedPrisma.findFirst.mockResolvedValue({
        ...basePropertyRecord,
        sellerId: 'seller-1',
      } as never);
      mockedPrisma.update.mockResolvedValue({
        ...basePropertyRecord,
        lotArea: 180,
        sellingPrice: 5400000,
      } as never);

      const result = await PropertyService.updatePropertyMetadata('seller-1', 'prop-1', {
        lotArea: 180,
        sellingPrice: 5400000,
      });

      expect(mockedPrisma.update).toHaveBeenCalledWith({
        where: { id: 'prop-1' },
        data: expect.objectContaining({
          lotArea: 180,
          sellingPrice: 5400000,
        }),
      });
      expect(result.pricePerSqm).toBe(30000);
    });
  });

  describe('getSellerProperty', () => {
    it('throws 404 when not owned by the seller', async () => {
      mockedPrisma.findFirst.mockResolvedValue(null);

      await expect(PropertyService.getSellerProperty('seller-1', 'prop-x')).rejects.toEqual({
        status: 404,
        message: 'Property not found.',
      });
    });
  });

  describe('computePricePerSqm', () => {
    it('computes price / lot area', () => {
      expect(computePricePerSqm(5400000, 180)).toBe(30000);
    });

    it('rounds to 2 decimal places', () => {
      expect(computePricePerSqm(3100000, 72)).toBe(43055.56);
    });

    it('falls back to 0 when lot area is missing or zero', () => {
      expect(computePricePerSqm(5400000, undefined)).toBe(0);
      expect(computePricePerSqm(5400000, 0)).toBe(0);
      expect(computePricePerSqm(undefined, 180)).toBe(0);
    });

    it('falls back to 0 for non-finite values', () => {
      expect(computePricePerSqm(NaN, 180)).toBe(0);
      expect(computePricePerSqm(5400000, NaN)).toBe(0);
      expect(computePricePerSqm(Infinity, 180)).toBe(0);
    });
  });
});
