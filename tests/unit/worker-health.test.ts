import request from 'supertest';
import { createHealthServer } from '../../src/worker-health';
import { Consumer, ConsumerStatus } from '../../src/infrastructure/event-bus';

describe('worker health server', () => {
  const makeConsumer = (status: Partial<ConsumerStatus>): Consumer => ({
    stop: jest.fn().mockResolvedValue(undefined),
    getStatus: () => ({
      queueUrl: 'http://localhost:4566/000000000000/test-queue',
      healthy: true,
      lastSuccessfulReceiveAt: new Date(),
      lastError: null,
      lastErrorAt: null,
      consecutiveErrors: 0,
      ...status,
    }),
  });

  const dummyMetrics = () => ({
    status: 'running',
    uptime: 123,
    jobs: { processed: 10, failed: 0, timedOut: 0, avgDurationMs: 5 },
    system: {
      cpus: 4,
      loadAvg1m: 0.5,
      memoryRss: '100MB',
      memoryHeap: '50/100MB',
      freeMem: '500MB',
    },
  });

  it('responds 200 on /live when process is alive', async () => {
    const server = createHealthServer(
      () => false,
      () => [],
      dummyMetrics,
    );
    const res = await request(server).get('/live');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
    expect(typeof res.body.uptime).toBe('number');
  });

  it('responds 503 on /health while worker is starting (not ready)', async () => {
    const server = createHealthServer(
      () => false,
      () => [],
      dummyMetrics,
    );
    const res = await request(server).get('/health');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'starting' });
  });

  it('responds 200 on /health when ready and all consumers are healthy', async () => {
    const c1 = makeConsumer({ queueUrl: 'http://localhost:4566/queue-1', healthy: true });
    const c2 = makeConsumer({ queueUrl: 'http://localhost:4566/queue-2', healthy: true });
    const server = createHealthServer(
      () => true,
      () => [c1, c2],
      dummyMetrics,
    );

    const res = await request(server).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('running');
    expect(res.body.consumers).toHaveLength(2);
    expect(res.body.consumers[0]).toMatchObject({
      queueUrl: 'http://localhost:4566/queue-1',
      healthy: true,
      consecutiveErrors: 0,
    });
    expect(res.body.consumers[1]).toMatchObject({
      queueUrl: 'http://localhost:4566/queue-2',
      healthy: true,
      consecutiveErrors: 0,
    });
    expect(res.body.jobs).toBeDefined();
    expect(res.body.system).toBeDefined();
  });

  it('responds 503 on /health and /ready when any consumer is unhealthy', async () => {
    const c1 = makeConsumer({ queueUrl: 'http://localhost:4566/queue-1', healthy: true });
    const c2 = makeConsumer({
      queueUrl: 'http://localhost:4566/queue-2',
      healthy: false,
      lastError: 'AccessDenied to queue',
      lastErrorAt: new Date(),
      consecutiveErrors: 3,
    });
    const server = createHealthServer(
      () => true,
      () => [c1, c2],
      dummyMetrics,
    );

    const resHealth = await request(server).get('/health');
    expect(resHealth.status).toBe(503);
    expect(resHealth.body.status).toBe('degraded');
    expect(resHealth.body.consumers[1]).toMatchObject({
      queueUrl: 'http://localhost:4566/queue-2',
      healthy: false,
      lastError: 'AccessDenied to queue',
      consecutiveErrors: 3,
    });

    const resReady = await request(server).get('/ready');
    expect(resReady.status).toBe(503);
    expect(resReady.body.status).toBe('degraded');
  });

  it('responds 404 on unknown paths', async () => {
    const server = createHealthServer(
      () => true,
      () => [],
      dummyMetrics,
    );
    const res = await request(server).get('/unknown');

    expect(res.status).toBe(404);
  });
});
