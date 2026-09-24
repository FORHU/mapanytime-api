import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { haversineKm } from '../../utils/geo.util';
import {
  emitVehicleMoved,
  emitVehicleRemoved,
  VehicleEventPayload,
} from '../../infrastructure/socket';

/** A vehicle not heard from in this long is off the map (no ghost vehicles). */
export const LIVE_TTL_MS = 60_000;

/** Faster than this between two pings is a GPS glitch or a spoof, not a jeepney. */
const MAX_IMPLIED_KMH = 200;

// ponytail: in-process live state + 1 DB lookup per ping. Move to Redis GEO and
// cache the driver→vehicle lookup when the API runs >1 instance (that also needs
// the socket.io redis adapter) or pings pass ~200/s.
const live = new Map<string, VehicleEventPayload>();

export interface LocationInput {
  lat: number;
  lng: number;
  speed?: number | null;
  heading?: number | null;
  /** Device time of the fix, epoch ms. */
  timestamp: number;
}

export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

function dropLive(vehicleId: string) {
  const point = live.get(vehicleId);
  if (!point) return;
  live.delete(vehicleId);
  emitVehicleRemoved(vehicleId, point.lat, point.lng);
}

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

  static updateOperator(id: string, data: Prisma.TransportOperatorsUpdateInput) {
    return prisma.transportOperators.update({ where: { id }, data });
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
    return prisma.vehicles.create({ data });
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
    // Suspending or reassigning must take it off the map now, not in 60s.
    if (!vehicle.trackingEnabled || vehicle.driverUserId !== existing.driverUserId) dropLive(id);
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
    const vehicle = await prisma.vehicles.findFirst({
      where: { driverUserId: userId, trackingEnabled: true, operator: { isActive: true } },
      include: { vehicleType: { select: { code: true } } },
    });
    if (!vehicle) throw { status: 403, message: 'No tracking-enabled vehicle is assigned to you' };

    const last = live.get(vehicle.id);
    if (last && Date.now() - last.ts < LIVE_TTL_MS) {
      const hours = (input.timestamp - last.ts) / 3_600_000;
      if (hours <= 0)
        throw { status: 422, message: 'Location is older than the last one received' };

      const km = haversineKm(last.lat, last.lng, input.lat, input.lng);
      if (km / hours > MAX_IMPLIED_KMH) throw { status: 422, message: 'Implausible location jump' };
    }

    const point: VehicleEventPayload = {
      id: vehicle.id,
      plateNumber: vehicle.plateNumber,
      typeCode: vehicle.vehicleType.code,
      lat: input.lat,
      lng: input.lng,
      heading: input.heading ?? null,
      speed: input.speed ?? null,
      ts: input.timestamp,
    };
    live.set(vehicle.id, point);
    emitVehicleMoved(point);
    return point;
  }

  static async stopTracking(userId: string) {
    const vehicle = await prisma.vehicles.findUnique({ where: { driverUserId: userId } });
    if (vehicle) dropLive(vehicle.id);
  }

  /** Snapshot for a map that just opened, so it needn't wait for the next ping. */
  static liveInBounds({ north, south, east, west }: Bounds) {
    const cutoff = Date.now() - LIVE_TTL_MS;
    const result: VehicleEventPayload[] = [];
    for (const [id, p] of live) {
      if (p.ts < cutoff) {
        live.delete(id);
        continue;
      }
      if (p.lat <= north && p.lat >= south && p.lng <= east && p.lng >= west) result.push(p);
    }
    return result;
  }
}
