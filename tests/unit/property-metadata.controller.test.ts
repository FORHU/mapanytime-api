import { Request, Response, NextFunction } from 'express';
import PropertyController from '../../src/modules/properties/property.controller';
import PropertyService from '../../src/modules/properties/property.service';

jest.mock('../../src/modules/properties/property.service');

describe('PropertyController.updateMetadata', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReq = {
      params: { id: 'prop-1' },
      user: { seller: { id: 'seller-1' } } as unknown as Request['user'],
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  it('returns 400 when the payload has no metadata fields', async () => {
    mockReq.body = {};

    await PropertyController.updateMetadata(
      mockReq as Request,
      mockRes as Response,
      next,
    );

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', statusCode: 400 }),
    );
  });

  it('rejects House-only fields for a Raw Land property', async () => {
    mockReq.body = { floorArea: 120, bedrooms: 3 };
    (PropertyService.getSellerProperty as jest.Mock).mockResolvedValue({
      id: 'prop-1',
      propertyType: 'RAW_LAND',
      sellerCapacity: 'OWNER',
    });

    await PropertyController.updateMetadata(
      mockReq as Request,
      mockRes as Response,
      next,
    );

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('House & Lot') }),
    );
  });

  it('rejects Authority to Sell / SPA for an Owner', async () => {
    mockReq.body = { sellingPrice: 1000000, authorityToSellFile: 'spa.pdf' };
    (PropertyService.getSellerProperty as jest.Mock).mockResolvedValue({
      id: 'prop-1',
      propertyType: 'HOUSE_LOT',
      sellerCapacity: 'OWNER',
    });

    await PropertyController.updateMetadata(
      mockReq as Request,
      mockRes as Response,
      next,
    );

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('not allowed for property owners') }),
    );
  });

  it('requires Authority to Sell / SPA for a Broker', async () => {
    mockReq.body = { sellingPrice: 1000000 };
    (PropertyService.getSellerProperty as jest.Mock).mockResolvedValue({
      id: 'prop-1',
      propertyType: 'HOUSE_LOT',
      sellerCapacity: 'BROKER',
    });

    await PropertyController.updateMetadata(
      mockReq as Request,
      mockRes as Response,
      next,
    );

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('required for broker or proxy') }),
    );
  });

  it('returns 200 and persists mapped metadata on success', async () => {
    mockReq.body = {
      lotArea: 180,
      terrain: 'sloping',
      sellingPrice: 5400000,
      authorityToSellFile: 'spa.pdf',
    };
    (PropertyService.getSellerProperty as jest.Mock).mockResolvedValue({
      id: 'prop-1',
      propertyType: 'HOUSE_LOT',
      sellerCapacity: 'BROKER',
    });
    (PropertyService.updatePropertyMetadata as jest.Mock).mockResolvedValue({
      id: 'prop-1',
      pricePerSqm: 30000,
    });

    await PropertyController.updateMetadata(
      mockReq as Request,
      mockRes as Response,
      next,
    );

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(PropertyService.updatePropertyMetadata).toHaveBeenCalledWith(
      'seller-1',
      'prop-1',
      expect.objectContaining({
        terrain: 'SLOPING',
        sellingPrice: 5400000,
      }),
    );
  });
});
