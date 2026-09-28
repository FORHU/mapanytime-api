/**
 * Drives a fake jeepney so God's Eye can be tested with one phone. Dev-only:
 * uses the seeded admin and dual@example.com accounts.
 *
 *   npx ts-node scripts/simulate-vehicle.ts <lat> <lng> [apiBase] [--cross]
 *   npx ts-node scripts/simulate-vehicle.ts 16.4023 120.596
 *   npx ts-node scripts/simulate-vehicle.ts 16.4023 120.596 --cross
 *
 * Default: a ~300 m circle. --cross: back and forth across the nearest 0.1° cell
 * edge, parking 30s at each end, so one run shows stopped → moving and the
 * vehicle:removed / vehicle:moved pair a cell change emits (see watch-vehicles.ts).
 *
 * First run creates operator "Simulator Transport Co" and vehicle SIM-001 with
 * dual@example.com as its driver. Ctrl+C stops sharing (vehicle leaves the map).
 */
const args = process.argv.slice(2);
const cross = args.includes('--cross');
const [latArg, lngArg, baseArg] = args.filter((a) => !a.startsWith('--'));
const center = { lat: Number(latArg), lng: Number(lngArg) };
if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) {
  console.error('Usage: npx ts-node scripts/simulate-vehicle.ts <lat> <lng> [apiBase] [--cross]');
  process.exit(1);
}
const API = `${baseArg ?? 'http://localhost:4002'}/api/v1`;

const PLATE = 'SIM-001';
const RADIUS_M = 300;
const SPEED_KMH = 25;
// Matches the driver app while moving.
const PING_MS = 10_000;
// Must match CELL_SIZE in src/infrastructure/socket.
const CELL_DEG = 0.1;
const PARK_PINGS = 3;

const mPerDegLat = 111_320;
const mPerDegLng = mPerDegLat * Math.cos((center.lat * Math.PI) / 180);

interface Fix {
  lat: number;
  lng: number;
  speed: number;
  heading: number;
}

function* circleRoute(): Generator<Fix> {
  const stepRad = ((SPEED_KMH / 3.6) * (PING_MS / 1000)) / RADIUS_M;
  for (let angle = 0; ; angle += stepRad) {
    yield {
      lat: center.lat + (RADIUS_M * Math.sin(angle)) / mPerDegLat,
      lng: center.lng + (RADIUS_M * Math.cos(angle)) / mPerDegLng,
      speed: SPEED_KMH,
      // Counter-clockwise travel: heading is the tangent, as a compass bearing.
      heading: ((((-angle * 180) / Math.PI) % 360) + 360) % 360,
    };
  }
}

function* crossRoute(): Generator<Fix> {
  const edge = Math.round(center.lat / CELL_DEG) * CELL_DEG;
  const reach = 0.004; // ~450 m either side of the edge
  const step = ((SPEED_KMH / 3.6) * (PING_MS / 1000)) / mPerDegLat;
  let lat = edge + reach;
  let dir = -1;
  for (;;) {
    const heading = dir < 0 ? 180 : 0;
    for (let i = 0; i < PARK_PINGS; i++) yield { lat, lng: center.lng, speed: 0, heading };
    while (dir < 0 ? lat > edge - reach : lat < edge + reach) {
      lat += dir * step;
      yield { lat, lng: center.lng, speed: SPEED_KMH, heading };
    }
    dir = -dir;
  }
}

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as { data?: any; message?: string } | null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json?.message ?? ''}`);
  return json?.data;
}

async function login(email: string, password: string, roleName: string): Promise<string> {
  return (await call('POST', '/auth/login', undefined, { email, password, roleName })).accessToken;
}

async function provision(admin: string, driverId: string) {
  const vehicles: any[] = await call('GET', '/mobility/vehicles', admin);
  if (vehicles.some((v) => v.plateNumber === PLATE)) return;

  const types: any[] = await call('GET', '/mobility/vehicle-types');
  const jeepney = types.find((t) => t.code === 'JEEPNEY');
  if (!jeepney) throw new Error('No JEEPNEY vehicle type — run the seeder first.');

  const operator = await call('POST', '/mobility/operators', admin, {
    name: 'Simulator Transport Co',
  });
  await call('POST', `/mobility/operators/${operator.id}/members`, admin, {
    userId: driverId,
    role: 'DRIVER',
  });
  await call('POST', '/mobility/vehicles', admin, {
    operatorId: operator.id,
    vehicleTypeId: jeepney.id,
    plateNumber: PLATE,
    driverUserId: driverId,
  });
  console.log(`Created ${PLATE} (driver dual@example.com).`);
}

async function main() {
  const admin = await login('admin@example.com', 'Password123', 'ADMIN');
  const driver = await login('dual@example.com', 'Dual123', 'BUYER');
  const driverId = JSON.parse(Buffer.from(driver.split('.')[1], 'base64url').toString()).userId;
  await provision(admin, driverId);

  const stop = async () => {
    await call('POST', '/mobility/tracking/stop', driver).catch(() => undefined);
    console.log(`\n${PLATE} stopped sharing — it should vanish from the map now.`);
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());

  const where = cross ? 'across the cell edge near' : 'around';
  console.log(
    `Driving ${PLATE} ${where} ${center.lat}, ${center.lng} every ${PING_MS / 1000}s. Ctrl+C to stop.`,
  );
  for (const fix of cross ? crossRoute() : circleRoute()) {
    try {
      const point = await call('POST', '/mobility/tracking/location', driver, {
        ...fix,
        accuracy: Math.round(5 + Math.random() * 15),
        timestamp: Date.now(),
      });
      const cell = `${Math.floor(fix.lat / CELL_DEG)}:${Math.floor(fix.lng / CELL_DEG)}`;
      console.log(
        `ping ${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}  cell ${cell}  ${point?.status}`,
      );
    } catch (e) {
      console.error((e as Error).message);
    }
    await new Promise((r) => setTimeout(r, PING_MS));
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
