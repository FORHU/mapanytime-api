import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { haversineKm } from '../../utils/geo.util';
import logger from '../../utils/logger';
import {
  emitVehicleMoved,
  emitVehicleRemoved,
  VehicleEventPayload,
} from '../../infrastructure/socket';
import * as live from './mobility.live-store';
import type { Bounds, CachedVehicle } from './mobility.live-store';

export type { Bounds } from './mobility.live-store';

/** Faster than this between two pings is a GPS glitch or a spoof, not a jeepney. */
const MAX_IMPLIED_KMH = 200;

/** A fix vaguer than this can't place a vehicle on a street. The app drops >50 m itself. */
const MAX_ACCURACY_M = 100;

/** At or above this reported speed a vehicle is moving, whatever its displacement says. */
const MOVING_KMH = 5;

/** Displacement below this (or below the two fixes' combined accuracy) is GPS jitter. */
const MOVING_MIN_M = 25;

const SWEEP_MS = 5_000;

export interface LocationInput {
  lat: number;
  lng: number;
  speed?: number | null;
  heading?: number | null;
  /** Metres, 68% radius. Optional: older app builds don't send it. */
  accuracy?: number | null;
  /** Device time of the fix, epoch ms. */
  timestamp: number;
}

async function dropLive(vehicleId: string) {
  const at = await live.removeLive(vehicleId);
  if (at) emitVehicleRemoved(vehicleId, at.lat, at.lng);
}

/** Admin writes must not fail because Redis is down; the 60s TTLs catch up. */
async function bestEffort(what: string, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (err) {
    logger.warn(`[Mobility] ${what} skipped: ${(err as { message?: string }).message}`);
  }
}

/** The caller's tracking-enabled vehicle, through a 60s Redis cache (misses included). */
async function resolveVehicle(userId: string): Promise<CachedVehicle | null> {
  const cached = await live.getCachedVehicle(userId);
  if (cached !== undefined) return cached;

  const vehicle = await prisma.vehicles.findFirst({
    where: { driverUserId: userId, trackingEnabled: true, operator: { isActive: true } },
    include: { vehicleType: { select: { code: true } } },
  });
  const entry = vehicle
    ? { id: vehicle.id, plateNumber: vehicle.plateNumber, typeCode: vehicle.vehicleType.code }
    : null;
  await live.cacheVehicle(userId, entry);
  return entry;
}

/**
 * Stopped at A → moving to B, decided once on the server so every viewer agrees.
 * The displacement threshold grows with the fixes' accuracy, so a parked vehicle's
 * GPS wandering doesn't flip it to "moving".
 */
export function deriveStatus(
  prev: VehicleEventPayload | null,
  input: LocationInput,
): Pick<VehicleEventPayload, 'status' | 'stoppedSince'> {
  let moving = (input.speed ?? 0) >= MOVING_KMH;
  if (!moving && prev) {
    const metres = haversineKm(prev.lat, prev.lng, input.lat, input.lng) * 1000;
    moving = metres > Math.max(MOVING_MIN_M, (prev.accuracy ?? 0) + (input.accuracy ?? 0));
  }
  if (moving) return { status: 'moving', stoppedSince: null };
  const since = prev?.status === 'stopped' ? prev.stoppedSince : null;
  return { status: 'stopped', stoppedSince: since ?? input.timestamp };
}

let sweeper: NodeJS.Timeout | null = null;

async function assertDriverBelongs(operatorId: string, driverUserId: string | null | undefined) {
  if (!driverUserId) return;
  const member = await prisma.transportOperatorMembers.findUnique({
    where: { operatorId_userId: { operatorId, userId: driverUserId } },
  });
  if (member?.role !== 'DRIVER') {
    throw { status: 400, message: 'Driver must be a DRIVER member of the vehicle operator' };
  }
}

export default class MobilityService {
  static listVehicleTypes() {
    return prisma.vehicleTypes.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  static createVehicleType(data: Prisma.VehicleTypesCreateInput) {
    return prisma.vehicleTypes.create({ data });
  }

  static updateVehicleType(id: string, data: Prisma.VehicleTypesUpdateInput) {
    return prisma.vehicleTypes.update({ where: { id }, data });
  }

  static listOperators() {
    return prisma.transportOperators.findMany({
      include: { members: true, _count: { select: { vehicles: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  static createOperator(data: Prisma.TransportOperatorsCreateInput) {
    return prisma.transportOperators.create({ data });
  }

  static async updateOperator(id: string, data: Prisma.TransportOperatorsUpdateInput) {
    const operator = await prisma.transportOperators.update({ where: { id }, data });
    const vehicles = await prisma.vehicles.findMany({
      where: { operatorId: id },
      select: { id: true, driverUserId: true },
    });
    await bestEffort('live update', async () => {
      await live.invalidateDrivers(...vehicles.map((v) => v.driverUserId));
      // A deactivated operator's whole fleet leaves the map now.
      if (!operator.isActive) await Promise.all(vehicles.map((v) => dropLive(v.id)));
    });
    return operator;
  }

  static addOperatorMember(operatorId: string, userId: string, role: string) {
    return prisma.transportOperatorMembers.upsert({
      where: { operatorId_userId: { operatorId, userId } },
      update: { role },
      create: { operatorId, userId, role },
    });
  }

  static listVehicles() {
    return prisma.vehicles.findMany({
      include: { vehicleType: true, operator: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async createVehicle(data: Prisma.VehiclesUncheckedCreateInput) {
    await assertDriverBelongs(data.operatorId, data.driverUserId);
    const vehicle = await prisma.vehicles.create({ data });
    // The driver may have a cached "drives nothing" from an earlier ping.
    await bestEffort('driver cache invalidation', () =>
      live.invalidateDrivers(vehicle.driverUserId),
    );
    return vehicle;
  }

  static async updateVehicle(id: string, data: Prisma.VehiclesUncheckedUpdateInput) {
    const existing = await prisma.vehicles.findUnique({ where: { id } });
    if (!existing) throw { status: 404, message: 'Vehicle not found' };

    const operatorId = (data.operatorId as string | undefined) ?? existing.operatorId;
    const driverUserId =
      data.driverUserId === undefined
        ? existing.driverUserId
        : (data.driverUserId as string | null);
    await assertDriverBelongs(operatorId, driverUserId);

    const vehicle = await prisma.vehicles.update({ where: { id }, data });
    await bestEffort('live update', async () => {
      await live.invalidateDrivers(existing.driverUserId, vehicle.driverUserId);
      // Suspending or reassigning must take it off the map now, not in 60s.
      if (!vehicle.trackingEnabled || vehicle.driverUserId !== existing.driverUserId) {
        await dropLive(id);
      }
    });
    return vehicle;
  }

  /** The caller's assigned vehicle, or null — the app shows driver mode only when set. */
  static getDriverVehicle(userId: string) {
    return prisma.vehicles.findUnique({
      where: { driverUserId: userId },
      include: { vehicleType: true },
    });
  }

  /**
   * Ingests one GPS fix. The vehicle comes from the authenticated driver — never
   * from the request — so a caller can only ever move the vehicle assigned to them.
   */
  static async recordLocation(userId: string, input: LocationInput) {
    const vehicle = await resolveVehicle(userId);
    if (!vehicle) throw { status: 403, message: 'No tracking-enabled vehicle is assigned to you' };

    if (input.accuracy != null && input.accuracy > MAX_ACCURACY_M) {
      throw { status: 422, message: 'Location accuracy too low' };
    }

    // Present only while the last fix is under 60s old — the key's TTL.
    const prev = await live.getLive(vehicle.id);
    if (prev) {
      const hours = (input.timestamp - prev.ts) / 3_600_000;
      if (hours <= 0)
        throw { status: 422, message: 'Location is older than the last one received' };

      // Two fuzzy fixes can sit further apart than the vehicle really went.
      const slackKm = ((prev.accuracy ?? 0) + (input.accuracy ?? 0)) / 1000;
      const km = Math.max(0, haversineKm(prev.lat, prev.lng, input.lat, input.lng) - slackKm);
      if (km / hours > MAX_IMPLIED_KMH) throw { status: 422, message: 'Implausible location jump' };
    }

    const point: VehicleEventPayload = {
      id: vehicle.id,
      plateNumber: vehicle.plateNumber,
      typeCode: vehicle.typeCode,
      lat: input.lat,
      lng: input.lng,
      heading: input.heading ?? null,
      speed: input.speed ?? null,
      accuracy: input.accuracy ?? null,
      ...deriveStatus(prev, input),
      ts: input.timestamp,
    };
    await live.putLive(point);
    emitVehicleMoved(point, prev);
    return point;
  }

  static async stopTracking(userId: string) {
    const vehicle = await prisma.vehicles.findUnique({ where: { driverUserId: userId } });
    if (vehicle) await dropLive(vehicle.id);
  }

  /** Snapshot for a map that just opened, so it needn't wait for the next ping. */
  static liveInBounds(bounds: Bounds) {
    return live.searchBox(bounds);
  }

  /** Takes vehicles silent for 60s off the map and tells their cell. Safe on every replica. */
  static async sweepExpired(now = Date.now()) {
    const expired = await live.claimExpired(now);
    for (const v of expired) emitVehicleRemoved(v.id, v.lat, v.lng);
    return expired.length;
  }

  static startSweeper() {
    if (sweeper) return;
    sweeper = setInterval(() => {
      MobilityService.sweepExpired().catch((err) =>
        logger.warn(`[Mobility] Sweep failed: ${(err as { message?: string }).message}`),
      );
    }, SWEEP_MS);
    sweeper.unref();
  }

  static stopSweeper() {
    if (sweeper) clearInterval(sweeper);
    sweeper = null;
  }
}
