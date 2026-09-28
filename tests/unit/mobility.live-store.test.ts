import RedisUtil from '../../src/utils/redis.util';
import * as live from '../../src/modules/mobility/mobility.live-store';
import type { VehicleEventPayload } from '../../src/infrastructure/socket';

jest.mock('../../src/utils/redis.util', () => ({ __esModule: true, default: { client: null } }));

/**
 * Just enough Redis for the live store. GEOSEARCH is approximated with a
 * degree box — the store re-filters on exact bounds anyway. Real GEO and TTL
 * behaviour is proven by the demo against redis:7, not here.
 */
function fakeRedis() {
  const strings = new Map<string, string>();
  const ttls = new Map<string, number>();
  const geo = new Map<string, { lat: number; lng: number }>();
  const seen = new Map<string, number>();

  const cmd = {
    isOpen: true,
    get: async (k: string) => strings.get(k) ?? null,
    set: async (k: string, v: string, o?: { expiration?: { value: number } }) => {
      strings.set(k, v);
      if (o?.expiration) ttls.set(k, o.expiration.value);
      return 'OK';
    },
    del: async (keys: string | string[]) => {
      for (const k of [keys].flat()) strings.delete(k);
    },
    mGet: async (keys: string[]) => keys.map((k) => strings.get(k) ?? null),
    geoAdd: async (_k: string, m: { longitude: number; latitude: number; member: string }) =>
      void geo.set(m.member, { lat: m.latitude, lng: m.longitude }),
    geoPos: async (_k: string, members: string | string[]) =>
      [members].flat().map((m) => {
        const p = geo.get(m);
        return p ? { latitude: String(p.lat), longitude: String(p.lng) } : null;
      }),
    geoSearch: async (
      _k: string,
      c: { longitude: number; latitude: number },
      by: { width: number; height: number },
    ) => {
      const dLat = by.height / 111.32 / 2;
      const dLng = by.width / 111.32 / 2 / Math.cos((c.latitude * Math.PI) / 180);
      return [...geo]
        .filter(
          ([, p]) => Math.abs(p.lat - c.latitude) <= dLat && Math.abs(p.lng - c.longitude) <= dLng,
        )
        .map(([id]) => id);
    },
    zAdd: async (k: string, m: { score: number; value: string }) =>
      void (k === 'mobility:seen' && seen.set(m.value, m.score)),
    zRem: async (k: string, m: string) =>
      Number(k === 'mobility:seen' ? seen.delete(m) : geo.delete(m)),
    zRangeByScore: async (_k: string, _min: string, max: number) =>
      [...seen].filter(([, s]) => s <= max).map(([id]) => id),
    // The store's only script: claim-if-still-expired.
    eval: async (_s: string, o: { arguments: string[] }) => {
      const [id, cutoff] = o.arguments;
      const s = seen.get(id);
      if (s === undefined || s > Number(cutoff)) return 0;
      seen.delete(id);
      geo.delete(id);
      return 1;
    },
  };
  const multi = () => {
    const ops: (() => Promise<unknown>)[] = [];
    const chain = new Proxy({} as Record<string, unknown>, {
      get: (_t, name: string) =>
        name === 'exec'
          ? async () => Promise.all(ops.map((op) => op()))
          : (...args: unknown[]) => {
              ops.push(() => (cmd as unknown as Record<string, Function>)[name](...args));
              return chain;
            },
    });
    return chain;
  };
  return { client: { ...cmd, multi }, strings, ttls, geo, seen };
}

let redis: ReturnType<typeof fakeRedis>;
beforeEach(() => {
  redis = fakeRedis();
  (RedisUtil as unknown as { client: unknown }).client = redis.client;
});

const point = (id: string, lat: number, lng: number): VehicleEventPayload => ({
  id,
  plateNumber: id.toUpperCase(),
  typeCode: 'JEEPNEY',
  lat,
  lng,
  heading: null,
  speed: null,
  accuracy: 8,
  status: 'moving',
  stoppedSince: null,
  ts: Date.now(),
});

describe('mobility live store', () => {
  it('putLive writes the point with a 60s TTL, the GEO member and the seen time', async () => {
    await live.putLive(point('v1', 16.4, 120.6), 1_000);

    expect(redis.ttls.get('mobility:vehicle:v1')).toBe(60);
    expect(redis.geo.get('v1')).toEqual({ lat: 16.4, lng: 120.6 });
    expect(redis.seen.get('v1')).toBe(1_000);
    expect(await live.getLive('v1')).toMatchObject({ id: 'v1', lat: 16.4 });
  });

  it('searchBox returns points in bounds and skips ones whose TTL ran out', async () => {
    await live.putLive(point('in', 16.41, 120.59));
    await live.putLive(point('out', 14.6, 120.98));
    await live.putLive(point('expired', 16.42, 120.6));
    redis.strings.delete('mobility:vehicle:expired'); // TTL elapsed, sweeper not yet run

    const found = await live.searchBox({ north: 16.5, south: 16.3, east: 120.7, west: 120.5 });
    expect(found.map((p) => p.id)).toEqual(['in']);
  });

  it('removeLive clears every key and reports where the vehicle was', async () => {
    await live.putLive(point('v1', 16.4, 120.6));

    expect(await live.removeLive('v1')).toEqual({ lat: 16.4, lng: 120.6 });
    expect(redis.geo.has('v1')).toBe(false);
    expect(redis.seen.has('v1')).toBe(false);
    expect(await live.getLive('v1')).toBeNull();
  });

  it('removeLive falls back to the GEO position once the point has expired', async () => {
    await live.putLive(point('v1', 16.4, 120.6));
    redis.strings.delete('mobility:vehicle:v1');

    expect(await live.removeLive('v1')).toEqual({ lat: 16.4, lng: 120.6 });
  });

  it('claimExpired takes only vehicles silent for 60s, with their last position', async () => {
    const now = 1_000_000;
    await live.putLive(point('old', 16.4, 120.6), now - 61_000);
    await live.putLive(point('fresh', 16.5, 120.6), now - 5_000);

    expect(await live.claimExpired(now)).toEqual([{ id: 'old', lat: 16.4, lng: 120.6 }]);
    expect(redis.geo.has('old')).toBe(false);
    expect(redis.geo.has('fresh')).toBe(true);
  });

  it('two replicas sweeping at once claim each vehicle exactly once', async () => {
    const now = 1_000_000;
    await live.putLive(point('old', 16.4, 120.6), now - 61_000);

    const [a, b] = await Promise.all([live.claimExpired(now), live.claimExpired(now)]);
    expect(a.length + b.length).toBe(1);
  });

  it('does not claim a vehicle that pinged between the read and the claim', async () => {
    const now = 1_000_000;
    await live.putLive(point('v1', 16.4, 120.6), now - 61_000);
    const read = redis.client.zRangeByScore;
    redis.client.zRangeByScore = async (...args) => {
      const ids = await read(...args);
      redis.seen.set('v1', now); // the driver's ping lands here
      return ids;
    };

    expect(await live.claimExpired(now)).toEqual([]);
    expect(redis.geo.has('v1')).toBe(true);
  });

  it('caches the driver lookup, including "drives nothing"', async () => {
    expect(await live.getCachedVehicle('u1')).toBeUndefined();

    await live.cacheVehicle('u1', null);
    expect(await live.getCachedVehicle('u1')).toBeNull();

    await live.cacheVehicle('u2', { id: 'v2', plateNumber: 'P', typeCode: 'TAXI' });
    expect(await live.getCachedVehicle('u2')).toEqual({
      id: 'v2',
      plateNumber: 'P',
      typeCode: 'TAXI',
    });

    await live.invalidateDrivers('u1', null, 'u2');
    expect(await live.getCachedVehicle('u1')).toBeUndefined();
    expect(await live.getCachedVehicle('u2')).toBeUndefined();
  });

  it('answers 503 when Redis is down instead of crashing', async () => {
    redis.client.isOpen = false;
    await expect(live.getLive('v1')).rejects.toMatchObject({ status: 503 });
  });
});
