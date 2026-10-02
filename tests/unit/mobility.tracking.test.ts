import { Request, Response } from 'express';
import { prisma } from '../../src/utils/prisma';
import {
  emitVehicleMoved,
  emitVehicleRemoved,
  VehicleEventPayload,
} from '../../src/infrastructure/socket';
import * as live from '../../src/modules/mobility/mobility.live-store';
import MobilityService, { deriveStatus } from '../../src/modules/mobility/mobility.service';
import MobilityController from '../../src/modules/mobility/mobility.controller';

jest.mock('../../src/utils/prisma', () => ({
  prisma: { vehicles: { findFirst: jest.fn(), findUnique: jest.fn() } },
}));
jest.mock('../../src/infrastructure/socket', () => ({
  emitVehicleMoved: jest.fn(),
  emitVehicleRemoved: jest.fn(),
}));
// Redis itself is covered in mobility.live-store.test.ts; here it's a Map.
jest.mock('../../src/modules/mobility/mobility.live-store', () => {
  const points = new Map<string, unknown>();
  return {
    LIVE_TTL_SECONDS: 60,
    __points: points,
    getLive: jest.fn(async (id: string) => points.get(id) ?? null),
    putLive: jest.fn(async (p: { id: string }) => void points.set(p.id, p)),
    removeLive: jest.fn(async (id: string) => {
      const p = points.get(id) as { lat: number; lng: number } | undefined;
      points.delete(id);
      return p ? { lat: p.lat, lng: p.lng } : null;
    }),
    searchBox: jest.fn(async () => [...points.values()]),
    claimExpired: jest.fn(async () => []),
    getCachedVehicle: jest.fn(async () => undefined),
    cacheVehicle: jest.fn(async () => undefined),
    invalidateDrivers: jest.fn(async () => undefined),
  };
});

const findVehicle = prisma.vehicles.findFirst as jest.Mock;
const findByDriver = prisma.vehicles.findUnique as jest.Mock;
const moved = emitVehicleMoved as jest.Mock;
const removed = emitVehicleRemoved as jest.Mock;
const store = live as jest.Mocked<typeof live> & { __points: Map<string, unknown> };

const assignVehicle = () => {
  const vehicle = { id: 'v1', plateNumber: 'JEEP-001', vehicleType: { code: 'JEEPNEY' } };
  findVehicle.mockResolvedValue(vehicle);
  return vehicle;
};

const BAGUIO = { lat: 16.4023, lng: 120.596 };

beforeEach(() => {
  jest.clearAllMocks();
  store.__points.clear();
});

describe('MobilityService.recordLocation', () => {
  it('rejects a caller with no tracking-enabled vehicle and emits nothing', async () => {
    findVehicle.mockResolvedValue(null);

    await expect(
      MobilityService.recordLocation('u1', { ...BAGUIO, timestamp: Date.now() }),
    ).rejects.toMatchObject({ status: 403 });
    expect(moved).not.toHaveBeenCalled();
    // The miss is cached so a stranger spamming the endpoint doesn't hit Postgres.
    expect(store.cacheVehicle).toHaveBeenCalledWith('u1', null);
  });

  it('looks the vehicle up by the caller, never by a body-supplied id', async () => {
    assignVehicle();
    await MobilityService.recordLocation('driver-7', { ...BAGUIO, timestamp: Date.now() });

    expect(findVehicle.mock.calls[0][0].where).toMatchObject({
      driverUserId: 'driver-7',
      trackingEnabled: true,
    });
  });

  it('uses the cached driver → vehicle lookup instead of Postgres', async () => {
    store.getCachedVehicle.mockResolvedValueOnce({
      id: 'v9',
      plateNumber: 'TRI-9',
      typeCode: 'TRICYCLE',
    });
    const point = await MobilityService.recordLocation('u1', { ...BAGUIO, timestamp: Date.now() });

    expect(findVehicle).not.toHaveBeenCalled();
    expect(point).toMatchObject({ id: 'v9', typeCode: 'TRICYCLE' });
  });

  it('stores a valid fix in Redis and emits it as vehicle:moved', async () => {
    const vehicle = assignVehicle();
    const ts = Date.now();
    await MobilityService.recordLocation('u1', {
      ...BAGUIO,
      heading: 182,
      speed: 23,
      accuracy: 8,
      timestamp: ts,
    });

    const expected: VehicleEventPayload = {
      id: vehicle.id,
      plateNumber: 'JEEP-001',
      typeCode: 'JEEPNEY',
      ...BAGUIO,
      heading: 182,
      speed: 23,
      accuracy: 8,
      status: 'moving',
      stoppedSince: null,
      ts,
    };
    expect(store.putLive).toHaveBeenCalledWith(expected);
    expect(moved).toHaveBeenCalledWith(expected, null);
  });

  it('accepts a fix without accuracy (older app builds)', async () => {
    assignVehicle();
    const point = await MobilityService.recordLocation('u1', { ...BAGUIO, timestamp: Date.now() });
    expect(point.accuracy).toBeNull();
  });

  it('rejects a fix vaguer than 100 m before touching live state', async () => {
    assignVehicle();
    await expect(
      MobilityService.recordLocation('u1', { ...BAGUIO, accuracy: 250, timestamp: Date.now() }),
    ).rejects.toMatchObject({ status: 422 });
    expect(store.putLive).not.toHaveBeenCalled();
  });

  it('rejects an implausible jump (Baguio → Manila in 5s) and keeps the old point', async () => {
    assignVehicle();
    const ts = Date.now() - 10_000;
    await MobilityService.recordLocation('u1', { ...BAGUIO, timestamp: ts });
    moved.mockClear();

    await expect(
      MobilityService.recordLocation('u1', { lat: 14.5995, lng: 120.9842, timestamp: ts + 5_000 }),
    ).rejects.toMatchObject({ status: 422 });
    expect(moved).not.toHaveBeenCalled();
  });

  it('rejects a fix older than the last one', async () => {
    assignVehicle();
    const ts = Date.now() - 5_000;
    await MobilityService.recordLocation('u1', { ...BAGUIO, timestamp: ts });
    await expect(
      MobilityService.recordLocation('u1', { ...BAGUIO, timestamp: ts - 1_000 }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('forgives a jump the two fixes’ accuracy explains', async () => {
    assignVehicle();
    const ts = Date.now() - 10_000;
    await MobilityService.recordLocation('u1', { ...BAGUIO, accuracy: 60, timestamp: ts });
    // ~110 m in 1 s is ~400 km/h raw, but 60 m + 60 m of uncertainty covers it.
    await expect(
      MobilityService.recordLocation('u1', {
        lat: BAGUIO.lat + 0.001,
        lng: BAGUIO.lng,
        accuracy: 60,
        timestamp: ts + 1_000,
      }),
    ).resolves.toBeDefined();
  });

  it('passes the previous point so a cell change can clear the old cell', async () => {
    assignVehicle();
    const ts = Date.now() - 10_000;
    await MobilityService.recordLocation('u1', { lat: 16.4005, lng: 120.596, timestamp: ts });
    // Crosses lat 16.4, the edge of a 0.1° cell.
    await MobilityService.recordLocation('u1', {
      lat: 16.3995,
      lng: 120.596,
      speed: 20,
      timestamp: ts + 5_000,
    });

    expect(moved.mock.calls[1][1]).toMatchObject({ lat: 16.4005, lng: 120.596 });
  });

  it('serves live points in bounds to a newly opened map', async () => {
    const vehicle = assignVehicle();
    await MobilityService.recordLocation('u1', { ...BAGUIO, timestamp: Date.now() });

    const inView = await MobilityService.liveInBounds({
      north: 17,
      south: 16,
      east: 121,
      west: 120,
    });
    expect(inView.map((p) => p.id)).toContain(vehicle.id);
  });
});

describe('deriveStatus: stopped at A → moving to B', () => {
  const at = (lat: number, extra: Partial<VehicleEventPayload> = {}): VehicleEventPayload => ({
    id: 'v1',
    plateNumber: 'P',
    typeCode: 'JEEPNEY',
    lat,
    lng: BAGUIO.lng,
    heading: null,
    speed: null,
    accuracy: 10,
    status: 'stopped',
    stoppedSince: 1_000,
    ts: 1_000,
    ...extra,
  });

  it('a first fix with no speed is stopped, from its own timestamp', () => {
    expect(deriveStatus(null, { ...BAGUIO, timestamp: 5_000 })).toEqual({
      status: 'stopped',
      stoppedSince: 5_000,
    });
  });

  it('reported speed alone makes it moving', () => {
    expect(deriveStatus(null, { ...BAGUIO, speed: 12, timestamp: 5_000 }).status).toBe('moving');
  });

  it('GPS jitter while parked stays stopped and keeps the original stop time', () => {
    // ~11 m wander, under max(25 m, 10 m + 10 m).
    const next = deriveStatus(at(BAGUIO.lat), {
      lat: BAGUIO.lat + 0.0001,
      lng: BAGUIO.lng,
      accuracy: 10,
      timestamp: 20_000,
    });
    expect(next).toEqual({ status: 'stopped', stoppedSince: 1_000 });
  });

  it('real displacement with no speed reported is moving', () => {
    // ~110 m
    const next = deriveStatus(at(BAGUIO.lat), {
      lat: BAGUIO.lat + 0.001,
      lng: BAGUIO.lng,
      accuracy: 10,
      timestamp: 20_000,
    });
    expect(next).toEqual({ status: 'moving', stoppedSince: null });
  });

  it('coming to a stop starts a new stop time', () => {
    const next = deriveStatus(at(BAGUIO.lat, { status: 'moving', stoppedSince: null }), {
      ...BAGUIO,
      speed: 0,
      timestamp: 30_000,
    });
    expect(next).toEqual({ status: 'stopped', stoppedSince: 30_000 });
  });
});

describe('MobilityService stop and sweep', () => {
  it('stopTracking removes the vehicle and tells its cell', async () => {
    assignVehicle();
    await MobilityService.recordLocation('u1', { ...BAGUIO, timestamp: Date.now() });
    findByDriver.mockResolvedValue({ id: 'v1' });

    await MobilityService.stopTracking('u1');
    expect(removed).toHaveBeenCalledWith('v1', BAGUIO.lat, BAGUIO.lng);
  });

  it('sweepExpired emits vehicle:removed for every claimed vehicle', async () => {
    store.claimExpired.mockResolvedValueOnce([
      { id: 'a', lat: 1, lng: 2 },
      { id: 'b', lat: 3, lng: 4 },
    ]);
    expect(await MobilityService.sweepExpired()).toBe(2);
    expect(removed).toHaveBeenCalledWith('a', 1, 2);
    expect(removed).toHaveBeenCalledWith('b', 3, 4);
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
    ['a negative accuracy', { ...BAGUIO, accuracy: -1, timestamp: Date.now() }],
  ])('rejects %s with 422 before touching the service', async (_label, body) => {
    expect(await post(body)).toBe(422);
    expect(findVehicle).not.toHaveBeenCalled();
  });

  it('accepts accuracy and passes it through', async () => {
    assignVehicle();
    expect(await post({ ...BAGUIO, accuracy: 12.5, timestamp: Date.now() })).toBe(200);
    expect(store.putLive.mock.calls[0][0]).toMatchObject({ accuracy: 12.5 });
  });

  it('answers a service 4xx itself instead of passing it to next', async () => {
    findVehicle.mockResolvedValue(null);
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })) } as unknown as Response;
    const next = jest.fn();

    await MobilityController.recordLocation(
      { body: { ...BAGUIO, timestamp: Date.now() }, user: { id: 'u1' } } as unknown as Request,
      res,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', statusCode: 403 }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe('MobilityController.myVehicle', () => {
  const get = async () => {
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })) } as unknown as Response;
    await MobilityController.myVehicle(
      { user: { id: 'u1' } } as unknown as Request,
      res,
      jest.fn(),
    );
    return { status: (res.status as jest.Mock).mock.calls[0][0] as number, json };
  };

  it('answers 404 when no vehicle is assigned', async () => {
    findByDriver.mockResolvedValue(null);
    const { status, json } = await get();
    expect(status).toBe(404);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  });

  it('answers 200 with the assigned vehicle', async () => {
    findByDriver.mockResolvedValue({ id: 'v1' });
    const { status, json } = await get();
    expect(status).toBe(200);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ data: { id: 'v1' } }));
  });
});
