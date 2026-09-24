/**
 * Drives a fake jeepney in a ~300 m circle so God's Eye can be tested with one
 * phone. Dev-only: uses the seeded admin and dual@example.com accounts.
 *
 *   npx ts-node scripts/simulate-vehicle.ts <lat> <lng> [apiBase]
 *   npx ts-node scripts/simulate-vehicle.ts 16.4023 120.596
 *
 * First run creates operator "Simulator Transport Co" and vehicle SIM-001 with
 * dual@example.com as its driver. Ctrl+C stops sharing (vehicle leaves the map).
 */
const [latArg, lngArg, baseArg] = process.argv.slice(2);
const center = { lat: Number(latArg), lng: Number(lngArg) };
if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) {
  console.error('Usage: npx ts-node scripts/simulate-vehicle.ts <lat> <lng> [apiBase]');
  process.exit(1);
}
const API = `${baseArg ?? 'http://localhost:4002'}/api/v1`;

const PLATE = 'SIM-001';
const RADIUS_M = 300;
const SPEED_KMH = 25;
const PING_MS = 3_000;

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

  const stepRad = ((SPEED_KMH / 3.6) * (PING_MS / 1000)) / RADIUS_M;
  const mPerDegLat = 111_320;
  const mPerDegLng = mPerDegLat * Math.cos((center.lat * Math.PI) / 180);
  let angle = 0;

  const stop = async () => {
    await call('POST', '/mobility/tracking/stop', driver).catch(() => undefined);
    console.log(`\n${PLATE} stopped sharing — it should vanish from the map now.`);
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());

  console.log(
    `Driving ${PLATE} around ${center.lat}, ${center.lng} every ${PING_MS / 1000}s. Ctrl+C to stop.`,
  );
  for (;;) {
    const lat = center.lat + (RADIUS_M * Math.sin(angle)) / mPerDegLat;
    const lng = center.lng + (RADIUS_M * Math.cos(angle)) / mPerDegLng;
    // Counter-clockwise travel: heading is the tangent, as a compass bearing.
    const heading = ((((-angle * 180) / Math.PI) % 360) + 360) % 360;
    try {
      await call('POST', '/mobility/tracking/location', driver, {
        lat,
        lng,
        speed: SPEED_KMH,
        heading,
        timestamp: Date.now(),
      });
      process.stdout.write(`\rping ${lat.toFixed(5)}, ${lng.toFixed(5)}  `);
    } catch (e) {
      console.error(`\n${(e as Error).message}`);
    }
    angle += stepRad;
    await new Promise((r) => setTimeout(r, PING_MS));
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
