import request from 'supertest';
import app from '../../src/app';
import { rabbitmq } from '../../src/infrastructure/rabbitmq';

/**
 * Infrastructure is mocked below, so the cost here is compiling the app's import
 * graph, which lands on whichever test runs first. Under a loaded full suite that
 * has overrun the default while the suite passes in ~7s alone; `maxWorkers` in
 * jest.config.ts is the actual remedy. Assertions are unchanged — only the budget
 * is raised, so a real hang still fails.
 */
jest.setTimeout(20000);

/**
 * Ingestion has to work for signed-out visitors — most marketplace browsing
 * happens before anyone logs in, and rejecting it would bias every ranking
 * built on this data toward authenticated users.
 *
 * Infrastructure is mocked so this runs without a live database, Redis or
 * RabbitMQ, matching health.test.ts.
 */
jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    analyticsEvents: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
  },
}));

jest.mock('../../src/infrastructure/redis', () => ({
  redis: {
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue(true),
    getClient: jest.fn(),
  },
}));

jest.mock('../../src/infrastructure/rabbitmq', () => ({
  rabbitmq: {
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    isReady: jest.fn().mockReturnValue(true),
    publish: jest.fn().mockResolvedValue(true),
    consume: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockPublish = rabbitmq.publish as jest.MockedFunction<typeof rabbitmq.publish>;
const ENDPOINT = '/api/v1/analytics/events';

beforeEach(() => {
  mockPublish.mockClear();
  mockPublish.mockResolvedValue(true);
});

describe('POST /v1/analytics/events', () => {
  it('accepts an anonymous event with 202', async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .send({ eventType: 'PRODUCT_VIEW', sessionId: 'sess-1', productId: 'prod-1' });

    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ accepted: 1, transport: 'queued' });
    expect(mockPublish).toHaveBeenCalledTimes(1);
  });

  it('accepts a batch', async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .send({
        events: [
          { eventType: 'SEARCH', metadata: { query: 'running shoes', resultCount: 24 } },
          { eventType: 'PRODUCT_CLICK', productId: 'prod-1' },
        ],
      });

    expect(res.status).toBe(202);
    expect(res.body.data.accepted).toBe(2);
    expect(mockPublish).toHaveBeenCalledTimes(2);
  });

  it('does not require a token', async () => {
    const res = await request(app).post(ENDPOINT).send({ eventType: 'STORE_VIEW' });
    expect(res.status).toBe(202);
  });

  it('treats a malformed token as anonymous rather than rejecting', async () => {
    // optionalAuthenticate must not turn a bad token into a failed page view.
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ eventType: 'STORE_VIEW', sessionId: 'sess-2' });

    expect(res.status).toBe(202);
    expect((mockPublish.mock.calls[0][1] as { userId: unknown }).userId).toBeNull();
  });

  describe('validation', () => {
    it('rejects an unknown event type', async () => {
      const res = await request(app).post(ENDPOINT).send({ eventType: 'NOT_A_REAL_EVENT' });

      expect(res.status).toBe(400);
      expect(mockPublish).not.toHaveBeenCalled();
    });

    it('rejects a missing event type', async () => {
      const res = await request(app).post(ENDPOINT).send({ productId: 'prod-1' });
      expect(res.status).toBe(400);
    });

    it('rejects a batch over the per-request cap', async () => {
      const events = Array.from({ length: 51 }, () => ({ eventType: 'PRODUCT_VIEW' }));
      const res = await request(app).post(ENDPOINT).send({ events });

      expect(res.status).toBe(400);
      expect(mockPublish).not.toHaveBeenCalled();
    });

    it('rejects an empty batch', async () => {
      const res = await request(app).post(ENDPOINT).send({ events: [] });
      expect(res.status).toBe(400);
    });
  });

  it('reports the direct transport when the queue is unreachable', async () => {
    mockPublish.mockResolvedValue(false);

    const res = await request(app).post(ENDPOINT).send({ eventType: 'ADD_TO_CART' });

    // Still 202: the event was persisted, just not via the queue.
    expect(res.status).toBe(202);
    expect(res.body.data.transport).toBe('direct');
  });
});
