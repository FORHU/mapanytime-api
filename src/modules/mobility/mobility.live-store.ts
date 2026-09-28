import RedisUtil from '../../utils/redis.util';
import type { VehicleEventPayload } from '../../infrastructure/socket';

/**
 * God's Eye live state. Redis only — live GPS is never written to Postgres.
 *
 *   mobility:vehicle:{id}   JSON point, EX 60     the latest fix; the TTL is the truth
 *   mobility:geo:vehicles   GEO set               viewport queries (GEOSEARCH BYBOX)
 *   mobility:seen           zset id → ms          when each GEO member was last refreshed
 *   mobility:driver:{uid}   JSON vehicle | none   driver → vehicle lookup cache, EX 60
 *
 * A GEO member cannot carry a TTL, so `mobility:seen` exists for the sweeper to
 * find members whose point has expired. Its scores are server time, so a device
 * clock can't keep a vehicle alive. Every instance shares these keys, which is
 * what lets the API run more than one replica.
 */

export const LIVE_TTL_SECONDS = 60;

const GEO_KEY = 'mobility:geo:vehicles';
const SEEN_KEY = 'mobility:seen';
const vehicleKey = (id: string) => `mobility:vehicle:${id}`;
const driverKey = (userId: string) => `mobility:driver:${userId}`;

const KM_PER_DEG = 111.32;

/** Removes an expired member only if no ping refreshed it since it was read. */
const CLAIM_EXPIRED = `
local seen = redis.call('ZSCORE', KEYS[1], ARGV[1])
if seen and tonumber(seen) <= tonumber(ARGV[2]) then
  redis.call('ZREM', KEYS[1], ARGV[1])
  redis.call('ZREM', KEYS[2], ARGV[1])
  return 1
end
return 0`;

export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface CachedVehicle {
  id: string;
  plateNumber: string;
  typeCode: string;
}

function client() {
  const c = RedisUtil.client;
  if (!c?.isOpen) throw { status: 503, message: 'Live tracking unavailable' };
  return c;
}

const parse = (raw: unknown): VehicleEventPayload | null =>
  typeof raw === 'string' ? (JSON.parse(raw) as VehicleEventPayload) : null;

export async function getLive(vehicleId: string): Promise<VehicleEventPayload | null> {
  return parse(await client().get(vehicleKey(vehicleId)));
}

export async function putLive(point: VehicleEventPayload, now = Date.now()): Promise<void> {
  await client()
    .multi()
    .set(vehicleKey(point.id), JSON.stringify(point), {
      expiration: { type: 'EX', value: LIVE_TTL_SECONDS },
    })
    .geoAdd(GEO_KEY, { longitude: point.lng, latitude: point.lat, member: point.id })
    .zAdd(SEEN_KEY, { score: now, value: point.id })
    .exec();
}

/** Takes a vehicle off the live map; returns where it was, for `vehicle:removed`. */
export async function removeLive(vehicleId: string): Promise<{ lat: number; lng: number } | null> {
  const c = client();
  const point = await getLive(vehicleId);
  const [geo] = point ? [null] : await c.geoPos(GEO_KEY, vehicleId);
  await c
    .multi()
    .del(vehicleKey(vehicleId))
    .zRem(GEO_KEY, vehicleId)
    .zRem(SEEN_KEY, vehicleId)
    .exec();
  if (point) return { lat: point.lat, lng: point.lng };
  return geo ? { lat: Number(geo.latitude), lng: Number(geo.longitude) } : null;
}

/** Live points inside the box, at most `limit` of them. */
export async function searchBox(b: Bounds, limit = 500): Promise<VehicleEventPayload[]> {
  if (b.north < b.south || b.east < b.west) return [];
  const c = client();

  // A box is widest on its edge nearest the equator.
  const widestLat =
    b.south <= 0 && b.north >= 0 ? 0 : Math.min(Math.abs(b.south), Math.abs(b.north));
  const ids = await c.geoSearch(
    GEO_KEY,
    { longitude: (b.east + b.west) / 2, latitude: (b.north + b.south) / 2 },
    {
      width: Math.max((b.east - b.west) * KM_PER_DEG * Math.cos((widestLat * Math.PI) / 180), 0.01),
      height: Math.max((b.north - b.south) * KM_PER_DEG, 0.01),
      unit: 'km',
    },
    { COUNT: limit },
  );
  if (ids.length === 0) return [];

  const points = (await c.mGet(ids.map(vehicleKey))).map(parse);
  // A null is a point whose TTL ran out before the sweeper got to its GEO member.
  return points.filter(
    (p): p is VehicleEventPayload =>
      p !== null && p.lat <= b.north && p.lat >= b.south && p.lng <= b.east && p.lng >= b.west,
  );
}

/**
 * Claims vehicles not heard from in LIVE_TTL_SECONDS and removes them from the
 * index. Each member is claimed atomically, so when every replica sweeps, exactly
 * one of them gets each vehicle — and emits its `vehicle:removed` exactly once.
 */
export async function claimExpired(
  now = Date.now(),
): Promise<{ id: string; lat: number; lng: number }[]> {
  const c = client();
  const cutoff = now - LIVE_TTL_SECONDS * 1000;
  const ids = await c.zRangeByScore(SEEN_KEY, '-inf', cutoff);
  if (ids.length === 0) return [];

  const positions = await c.geoPos(GEO_KEY, ids);
  const claimed: { id: string; lat: number; lng: number }[] = [];
  for (const [i, id] of ids.entries()) {
    const won = await c.eval(CLAIM_EXPIRED, {
      keys: [SEEN_KEY, GEO_KEY],
      arguments: [id, String(cutoff)],
    });
    const pos = positions[i];
    if (won === 1 && pos) {
      claimed.push({ id, lat: Number(pos.latitude), lng: Number(pos.longitude) });
    }
  }
  return claimed;
}

/** `undefined` is a cache miss; `null` is a cached "this user drives nothing". */
export async function getCachedVehicle(userId: string): Promise<CachedVehicle | null | undefined> {
  const raw = await client().get(driverKey(userId));
  if (raw === null) return undefined;
  return raw === 'none' ? null : (JSON.parse(raw) as CachedVehicle);
}

export async function cacheVehicle(userId: string, vehicle: CachedVehicle | null): Promise<void> {
  await client().set(driverKey(userId), vehicle ? JSON.stringify(vehicle) : 'none', {
    expiration: { type: 'EX', value: LIVE_TTL_SECONDS },
  });
}

export async function invalidateDrivers(...userIds: (string | null | undefined)[]): Promise<void> {
  const keys = userIds.filter((u): u is string => !!u).map(driverKey);
  if (keys.length) await client().del(keys);
}
