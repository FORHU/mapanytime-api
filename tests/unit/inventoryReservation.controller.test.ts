import { Request, Response, NextFunction } from 'express';
import InventoryReservationController from '../../src/modules/inventory/inventoryReservation.controller';
import InventoryReservationService from '../../src/modules/inventory/inventoryReservation.service';

jest.mock('../../src/modules/inventory/inventoryReservation.service');

describe('InventoryReservationController', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReq = {};
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  describe('POST /reserve', () => {
    it('returns 400 when inventoryId or quantity is missing', async () => {
      mockReq.body = { quantity: 2 };

      await InventoryReservationController.reserve(mockReq as Request, mockRes as Response, next);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          statusCode: 400,
        }),
      );
    });

    it('returns 401 when req.user is undefined', async () => {
      mockReq.body = { inventoryId: 'inv-123', quantity: 2 };
      mockReq.user = undefined;

      await InventoryReservationController.reserve(mockReq as Request, mockRes as Response, next);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          statusCode: 401,
          message: 'Unauthorized access.',
        }),
      );
    });

    it('returns 201 with reservation data on success', async () => {
      mockReq.body = { inventoryId: 'inv-123', quantity: 2 };
      mockReq.user = { id: 'buyer-999' };

      const mockData = {
        id: 'res-1',
        inventoryId: 'inv-123',
        buyerId: 'buyer-999',
        quantity: 2,
        status: 'RESERVED',
      };

      (InventoryReservationService.reserveStock as jest.Mock).mockResolvedValue(mockData);

      await InventoryReservationController.reserve(mockReq as Request, mockRes as Response, next);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'success',
          statusCode: 201,
          data: mockData,
        }),
      );
    });
  });

  describe('GET /reservations/active', () => {
    it('returns 200 with list of active reservations', async () => {
      mockReq.user = { id: 'buyer-999' };

      const mockReservations = [
        { id: 'res-1', inventoryId: 'inv-1', quantity: 2, status: 'RESERVED' },
      ];

      (InventoryReservationService.getActiveReservations as jest.Mock).mockResolvedValue(
        mockReservations,
      );

      await InventoryReservationController.getActiveReservations(
        mockReq as Request,
        mockRes as Response,
        next,
      );

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'success',
          statusCode: 200,
          data: mockReservations,
        }),
      );
    });
  });

  describe('POST /reservations/:id/confirm', () => {
    it('returns 200 on successful confirmation', async () => {
      mockReq.params = { id: 'res-1' };
      mockReq.body = { orderId: 'order-100' };

      const mockConfirmed = { id: 'res-1', status: 'CONSUMED', orderId: 'order-100' };
      (InventoryReservationService.confirmReservation as jest.Mock).mockResolvedValue(
        mockConfirmed,
      );

      await InventoryReservationController.confirm(mockReq as Request, mockRes as Response, next);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'success',
          statusCode: 200,
          data: mockConfirmed,
        }),
      );
    });
  });

  describe('POST /reservations/:id/release', () => {
    it('returns 200 on successful release', async () => {
      mockReq.params = { id: 'res-1' };

      const mockReleased = { id: 'res-1', status: 'RELEASED' };
      (InventoryReservationService.releaseReservation as jest.Mock).mockResolvedValue(mockReleased);

      await InventoryReservationController.release(mockReq as Request, mockRes as Response, next);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'success',
          statusCode: 200,
          data: mockReleased,
        }),
      );
    });
  });
});
