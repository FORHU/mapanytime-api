import { Request, Response, NextFunction } from 'express';
import PropertyController from '../../src/modules/properties/property.controller';
import PropertyService from '../../src/modules/properties/property.service';
import { resolveAccessibleStoreIds } from '../../src/modules/organization/storeAccess';

jest.mock('../../src/modules/properties/property.service');
jest.mock('../../src/modules/organization/storeAccess');

const resolveAccessibleStoreIdsMock = resolveAccessibleStoreIds as jest.Mock;

describe('PropertyController store scoping (seller_user access)', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReq = {
      params: { id: 'prop-1' },
      user: { id: 'user-1' } as unknown as Request['user'],
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  describe('getMine', () => {
    it('returns properties for a seller_user scoped to their assigned store', async () => {
      resolveAccessibleStoreIdsMock.mockResolvedValue({
        storeIds: ['store-assigned'],
        hasOrg: true,
        hasSellerRow: false,
      });
      (PropertyService.getMyProperties as jest.Mock).mockResolvedValue([
        { id: 'prop-1', storeId: 'store-assigned' },
      ]);

      await PropertyController.getMine(mockReq as Request, mockRes as Response, next);

      expect(PropertyService.getMyProperties).toHaveBeenCalledWith(['store-assigned']);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [{ id: 'prop-1', storeId: 'store-assigned' }],
        }),
      );
    });

    it('covers every org store for a seller_admin', async () => {
      resolveAccessibleStoreIdsMock.mockResolvedValue({
        storeIds: ['store-a', 'store-b'],
        hasOrg: true,
        hasSellerRow: false,
      });
      (PropertyService.getMyProperties as jest.Mock).mockResolvedValue([]);

      await PropertyController.getMine(mockReq as Request, mockRes as Response, next);

      expect(PropertyService.getMyProperties).toHaveBeenCalledWith(['store-a', 'store-b']);
    });

    it('returns 403 without touching the service when the caller has no org and no seller row', async () => {
      resolveAccessibleStoreIdsMock.mockResolvedValue({
        storeIds: [],
        hasOrg: false,
        hasSellerRow: false,
      });

      await PropertyController.getMine(mockReq as Request, mockRes as Response, next);

      expect(PropertyService.getMyProperties).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'User is not registered as a seller.' }),
      );
    });

    it('returns 200 with an empty list for a member with no store assigned yet', async () => {
      resolveAccessibleStoreIdsMock.mockResolvedValue({
        storeIds: [],
        hasOrg: true,
        hasSellerRow: false,
      });
      (PropertyService.getMyProperties as jest.Mock).mockResolvedValue([]);

      await PropertyController.getMine(mockReq as Request, mockRes as Response, next);

      expect(PropertyService.getMyProperties).toHaveBeenCalledWith([]);
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });
  });

  describe('getById', () => {
    it('passes the caller-scoped store ids through to the service', async () => {
      resolveAccessibleStoreIdsMock.mockResolvedValue({
        storeIds: ['store-assigned'],
        hasOrg: true,
        hasSellerRow: false,
      });
      (PropertyService.getPropertyById as jest.Mock).mockResolvedValue({ id: 'prop-1' });

      await PropertyController.getById(mockReq as Request, mockRes as Response, next);

      expect(PropertyService.getPropertyById).toHaveBeenCalledWith(['store-assigned'], 'prop-1');
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('surfaces the service 404 for a property outside the caller scope', async () => {
      resolveAccessibleStoreIdsMock.mockResolvedValue({
        storeIds: ['store-assigned'],
        hasOrg: true,
        hasSellerRow: false,
      });
      (PropertyService.getPropertyById as jest.Mock).mockRejectedValue({
        status: 404,
        message: 'Property not found.',
      });

      await PropertyController.getById(mockReq as Request, mockRes as Response, next);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Property not found.' }),
      );
    });

    it('returns 403 before calling the service when the caller has no org and no seller row', async () => {
      resolveAccessibleStoreIdsMock.mockResolvedValue({
        storeIds: [],
        hasOrg: false,
        hasSellerRow: false,
      });

      await PropertyController.getById(mockReq as Request, mockRes as Response, next);

      expect(PropertyService.getPropertyById).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
    });
  });

  describe('getDashboard', () => {
    it('passes the caller-scoped store ids through to the service', async () => {
      resolveAccessibleStoreIdsMock.mockResolvedValue({
        storeIds: ['store-assigned'],
        hasOrg: true,
        hasSellerRow: false,
      });
      (PropertyService.getVerifiedPropertyDashboard as jest.Mock).mockResolvedValue({
        id: 'prop-1',
      });

      await PropertyController.getDashboard(mockReq as Request, mockRes as Response, next);

      expect(PropertyService.getVerifiedPropertyDashboard).toHaveBeenCalledWith(
        ['store-assigned'],
        'prop-1',
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('surfaces the service 403 for an unverified or out-of-scope property', async () => {
      resolveAccessibleStoreIdsMock.mockResolvedValue({
        storeIds: ['store-assigned'],
        hasOrg: true,
        hasSellerRow: false,
      });
      (PropertyService.getVerifiedPropertyDashboard as jest.Mock).mockRejectedValue({
        status: 403,
        message: 'This property is not verified or you do not have access.',
      });

      await PropertyController.getDashboard(mockReq as Request, mockRes as Response, next);

      expect(mockRes.status).toHaveBeenCalledWith(403);
    });
  });
});
