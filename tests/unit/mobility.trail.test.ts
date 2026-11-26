import MobilityService from '../../src/modules/mobility/mobility.service';
import MobilityController from '../../src/modules/mobility/mobility.controller';
import * as live from '../../src/modules/mobility/mobility.live-store';
import { prisma } from '../../src/utils/prisma';
import type { Request, Response } from 'express';

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    vehicles: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../../src/modules/mobility/mobility.live-store', () => ({
  getTrail: jest.fn(),
  clearTrail: jest.fn(),
}));

describe('Mobility Trail API', () => {
  const mockVehicle = {
    id: 'veh-1',
    plateNumber: 'ABC-1234',
    driverUserId: 'driver-1',
    operatorId: 'op-1',
    vehicleType: { code: 'JEEPNEY', name: 'Jeepney' },
    operator: {
      id: 'op-1',
      name: 'Baguio Jeepney Operators',
      members: [
        { userId: 'op-admin-1', role: 'OPERATOR_ADMIN' },
        { userId: 'driver-1', role: 'DRIVER' },
      ],
    },
    driver: {
      id: 'driver-1',
      firstName: 'Juan',
      lastName: 'Dela Cruz',
    },
  };

  const samplePoints: live.TrailPoint[] = [
    {
      lat: 16.41,
      lng: 120.59,
      speed: 25,
      heading: 180,
      accuracy: 5,
      status: 'moving',
      ts: 1700000001000,
    },
    {
      lat: 16.42,
      lng: 120.6,
      speed: 0,
      heading: 180,
      accuracy: 4,
      status: 'stopped',
      ts: 1700000015000,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.vehicles.findUnique as jest.Mock).mockResolvedValue(mockVehicle);
    (live.getTrail as jest.Mock).mockResolvedValue(samplePoints);
  });

  describe('MobilityService.getVehicleTrail', () => {
    it('allows platform ADMIN to query trail', async () => {
      const caller = { id: 'admin-user', roles: [{ roleName: 'ADMIN' }] };
      const res = await MobilityService.getVehicleTrail('veh-1', caller, { limit: 50 });

      expect(res.vehicleId).toBe('veh-1');
      expect(res.plateNumber).toBe('ABC-1234');
      expect(res.typeCode).toBe('JEEPNEY');
      expect(res.totalPoints).toBe(2);
      expect(res.points).toEqual(samplePoints);
      expect(live.getTrail).toHaveBeenCalledWith('veh-1', { limit: 50 });
    });

    it('allows assigned driver to query trail', async () => {
      const caller = { id: 'driver-1', roles: [{ roleName: 'BUYER' }] };
      const res = await MobilityService.getVehicleTrail('veh-1', caller, {});

      expect(res.vehicleId).toBe('veh-1');
      expect(res.points).toHaveLength(2);
    });

    it('allows vehicle operator member to query trail', async () => {
      const caller = { id: 'op-admin-1', roles: [] };
      const res = await MobilityService.getVehicleTrail('veh-1', caller, {});

      expect(res.vehicleId).toBe('veh-1');
      expect(res.points).toHaveLength(2);
    });

    it('rejects unauthorized caller with 403', async () => {
      const caller = { id: 'unrelated-user', roles: [{ roleName: 'BUYER' }] };
      await expect(MobilityService.getVehicleTrail('veh-1', caller, {})).rejects.toMatchObject({
        status: 403,
        message: expect.stringContaining('Insufficient permissions'),
      });
    });

    it('throws 404 when vehicle is not found', async () => {
      (prisma.vehicles.findUnique as jest.Mock).mockResolvedValue(null);
      const caller = { id: 'admin-user', roles: [{ roleName: 'ADMIN' }] };

      await expect(
        MobilityService.getVehicleTrail('non-existent', caller, {}),
      ).rejects.toMatchObject({
        status: 404,
        message: 'Vehicle not found',
      });
    });
  });

  describe('MobilityController.getVehicleTrail', () => {
    const makeRes = () => {
      const res: Partial<Response> = {};
      res.status = jest.fn().mockReturnValue(res);
      res.json = jest.fn().mockReturnValue(res);
      return res as Response & { status: jest.Mock; json: jest.Mock };
    };

    it('answers 200 with trail data on valid request', async () => {
      const req = {
        params: { id: 'veh-1' },
        query: { limit: '20', since: '1700000000000' },
        user: { id: 'admin-user', roles: [{ roleName: 'ADMIN' }] },
      } as unknown as Request;
      const res = makeRes();
      const next = jest.fn();

      await MobilityController.getVehicleTrail(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'success',
          data: expect.objectContaining({
            vehicleId: 'veh-1',
            totalPoints: 2,
          }),
        }),
      );
    });

    it('answers 422 when query parameters are invalid', async () => {
      const req = {
        params: { id: 'veh-1' },
        query: { limit: '-5' },
        user: { id: 'admin-user', roles: [{ roleName: 'ADMIN' }] },
      } as unknown as Request;
      const res = makeRes();
      const next = jest.fn();

      await MobilityController.getVehicleTrail(req, res, next);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
        }),
      );
    });

    it('answers 403 when user is not authorized', async () => {
      const req = {
        params: { id: 'veh-1' },
        query: {},
        user: { id: 'unauthorized-user', roles: [] },
      } as unknown as Request;
      const res = makeRes();
      const next = jest.fn();

      await MobilityController.getVehicleTrail(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });
});
