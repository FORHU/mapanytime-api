import http from 'http';
import { Consumer } from './infrastructure/event-bus';
import { workerMetrics } from './utils/worker-metrics';

/**
 * Creates the lightweight health HTTP server for the worker.
 *
 * GET /live   → 200 { status: 'ok', uptime } (liveness probe: process is alive)
 * GET /health → 503 while starting or if any consumer is unhealthy,
 *               200 with per-consumer status and worker metrics when healthy.
 * GET /ready  → alias for /health (readiness probe)
 */
export const createHealthServer = (
  getReady: () => boolean,
  getConsumers: () => Consumer[],
  getMetrics: () => ReturnType<typeof workerMetrics.getSnapshot> = () =>
    workerMetrics.getSnapshot(),
): http.Server => {
  return http.createServer((req, res) => {
    if (req.url === '/live') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: Math.floor(process.uptime()) }));
      return;
    }

    if (req.url === '/health' || req.url === '/ready') {
      if (!getReady()) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'starting' }));
        return;
      }

      const consumerStatuses = getConsumers().map((c) => c.getStatus());
      const allHealthy = consumerStatuses.every((s) => s.healthy);
      const snapshot = getMetrics();
      const statusCode = allHealthy ? 200 : 503;

      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ...snapshot,
          status: allHealthy ? snapshot.status : 'degraded',
          consumers: consumerStatuses,
        }),
      );
      return;
    }

    res.writeHead(404);
    res.end();
  });
};
