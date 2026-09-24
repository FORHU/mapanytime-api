import { Request, Response } from 'express';
import { prisma } from '../../src/utils/prisma';
import { emitVehicleMoved } from '../../src/infrastructure/socket';
import MobilityService from '../../src/modules/mobility/mobility.service';
import MobilityController from '../../src/modules/mobility/mobility.controller';

jest.mock('../../src/utils/prisma', () => ({
  prisma: { vehicles: { findFirst: jest.fn() } },
}));
jest.mock('../../src/infrastructure/socket', () => ({
  emitVehicleMoved: jest.fn(),
  emitVehicleRemoved: jest.fn(),
}));

const findVehicle = prisma.vehicles.findFirst as jest.Mock;
const emitted = emitVehicleMoved as jest.Mock;

let vehicleSeq = 0;
const assignVehicle = () => {
  // A fresh id per test: live state is module-level and must not leak between cases.
  const vehicle = {
    id: `v${++vehicleSeq}`,
    plateNumber: 'JEEP-001',
    vehicleType: { code: 'JEEPNEY' },
  };
  findVehicle.mockResolvedValue(vehicle);
  return vehicle;
};

const BAGUIO = { lat: 16.4023, lng: 120.596 };

beforeEach(() => jest.clearAllMocks());

describe('MobilityService.recordLocation', () => {
  it('rejects a caller with no tracking-enabled vehicle and emits nothing', async () => {
    findVehicle.mockResolvedValue(null);

    await expect(
      MobilityService.recordLocation('u1', { ...BAGUIO, timestamp: Date.now() }),
    ).rejects.toMatchObject({ status: 403 });
    expect(emitted).not.toHaveBeenCalled();
  });

  it('looks the vehicle up by the caller, never by a body-supplied id', async () => {
    assignVehicle();
    await MobilityService.recordLocation('driver-7', { ...BAGUIO, timestamp: Date.now() });

    expect(findVehicle.mock.calls[0][0].where).toMatchObject({
      driverUserId: 'driver-7',
      trackingEnabled: true,
    });
  });

  it('emits a valid fix as vehicle:moved with the type code', async () => {
    const vehicle = assignVehicle();
    const ts = Date.now();
    await MobilityService.recordLocation('u1', {
      ...BAGUIO,
      heading: 182,
      speed: 23,
      timestamp: ts,
    });

    expect(emitted).toHaveBeenCalledWith({
      id: vehicle.id,
      plateNumber: 'JEEP-001',
      typeCode: 'JEEPNEY',
      ...BAGUIO,
      heading: 182,
      speed: 23,
      ts,
    });
  });

  it('rejects an implausible jump (Baguio → Manila in 5s) and keeps the old point', async () => {
    assignVehicle();
    const ts = Date.now() - 10_000;
    await MobilityService.recordLocation('u1', { ...BAGUIO, timestamp: ts });
    emitted.mockClear();

    await expect(
      MobilityService.recordLocation('u1', { lat: 14.5995, lng: 120.9842, timestamp: ts + 5_000 }),
    ).rejects.toMatchObject({ status: 422 });
    expect(emitted).not.toHaveBeenCalled();
  });

  it('accepts normal jeepney movement between fixes', async () => {
    assignVehicle();
    const ts = Date.now() - 10_000;
    await MobilityService.recordLocation('u1', { ...BAGUIO, timestamp: ts });
    // ~30 m in 5 s ≈ 22 km/h
    await MobilityService.recordLocation('u1', {
      lat: 16.4026,
      lng: 120.596,
      timestamp: ts + 5_000,
    });

    expect(emitted).toHaveBeenCalledTimes(2);
  });

  it('serves live points in bounds to a newly opened map', async () => {
    const vehicle = assignVehicle();
    await MobilityService.recordLocation('u1', { ...BAGUIO, timestamp: Date.now() });

    const inView = MobilityService.liveInBounds({ north: 17, south: 16, east: 121, west: 120 });
    const elsewhere = MobilityService.liveInBounds({ north: 15, south: 14, east: 121, west: 120 });

    expect(inView.map((p) => p.id)).toContain(vehicle.id);
    expect(elsewhere.map((p) => p.id)).not.toContain(vehicle.id);
  });
});

describe('MobilityController.recordLocation validation', () => {
  const post = async (body: unknown) => {
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })) } as unknown as Response;
    await MobilityController.recordLocation(
      { body, user: { id: 'u1' } } as unknown as Request,
      res,
      jest.fn(),
    );
    return (res.status as jest.Mock).mock.calls[0][0] as number;
  };

  it.each([
    ['a stale fix', { ...BAGUIO, timestamp: Date.now() - 5 * 60_000 }],
    ['a fix from the future', { ...BAGUIO, timestamp: Date.now() + 60_000 }],
    ['an out-of-range latitude', { lat: 91, lng: 120, timestamp: Date.now() }],
    ['a speed over 160 km/h', { ...BAGUIO, speed: 400, timestamp: Date.now() }],
  ])('rejects %s with 422 before touching the service', async (_label, body) => {
    expect(await post(body)).toBe(422);
    expect(findVehicle).not.toHaveBeenCalled();
  });
});
