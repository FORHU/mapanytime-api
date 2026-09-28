/**
 * A terminal God's Eye viewer: subscribes to a viewport the way the app does and
 * logs every vehicle:moved / vehicle:removed it receives. Dev-only.
 *
 *   npx ts-node scripts/watch-vehicles.ts <lat> <lng> [socketUrl] [spanDeg]
 *   npx ts-node scripts/watch-vehicles.ts 16.4023 120.596 http://localhost:4003 0.02
 *
 * The viewport is <lat>,<lng> ± spanDeg/2 (default 0.05). Point it at a
 * different API replica than the simulator to see the Redis adapter carry
 * events across instances. A small span inside one 0.1° cell shows the
 * vehicle:removed that a cell change sends to the old cell; a viewport over
 * both cells gets no removal, only the next vehicle:moved.
 */
import { io } from 'socket.io-client';

const [latArg, lngArg, urlArg, spanArg] = process.argv.slice(2);
const lat = Number(latArg);
const lng = Number(lngArg);
if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
  console.error('Usage: npx ts-node scripts/watch-vehicles.ts <lat> <lng> [socketUrl] [spanDeg]');
  process.exit(1);
}
const url = urlArg ?? 'http://localhost:4002';
const half = Number(spanArg ?? 0.05) / 2;
const viewport = { north: lat + half, south: lat - half, east: lng + half, west: lng - half };

interface Vehicle {
  id: string;
  plateNumber: string;
  lat: number;
  lng: number;
  status?: string;
  accuracy?: number | null;
}

const plates = new Map<string, string>();
const time = () => new Date().toLocaleTimeString();
const cell = (v: Vehicle) => `${Math.floor(v.lat / 0.1)}:${Math.floor(v.lng / 0.1)}`;

const socket = io(url, { transports: ['websocket'] });

socket.on('connect', () => {
  // Rooms don't survive a reconnect (possibly onto another replica): join again.
  socket.emit('subscribe', viewport);
  console.log(`[${time()}] connected to ${url}, watching`, viewport);
});
socket.on('disconnect', (reason) => console.log(`[${time()}] disconnected: ${reason}`));
socket.on('connect_error', (err) => console.log(`[${time()}] connect error: ${err.message}`));

socket.on('vehicle:moved', (v: Vehicle) => {
  plates.set(v.id, v.plateNumber);
  console.log(
    `[${time()}] moved    ${v.plateNumber}  ${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}  ` +
      `cell ${cell(v)}  ${v.status ?? '?'}  ±${v.accuracy ?? '?'} m`,
  );
});
socket.on('vehicle:removed', ({ id }: { id: string }) => {
  console.log(`[${time()}] removed  ${plates.get(id) ?? id}`);
});
