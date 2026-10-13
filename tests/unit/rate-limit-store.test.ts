import express from 'express';
import request from 'supertest';
import logger from '../../src/utils/logger';
import RedisUtil from '../../src/utils/redis.util';
import { FailoverStore } from '../../src/middleware/rate-limit-store';
import { applyRateLimits, createRateLimiters } from '../../src/middleware/rate-limit.middleware';

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

/** Stands in for rate-limit-redis: counts in a map shared by every instance, like Redis would. */
const redisCounts = new Map<string, number>();
let redisFails = false;
jest.mock('rate-limit-redis', () => ({
  RedisStore: class {
    prefix: string;
    constructor(opts: { prefix: string }) {
      this.prefix = opts.prefix;
    }
    async init() {}
    async increment(key: string) {
      if (redisFails) throw new Error('ECONNRESET');
      const hits = (redisCounts.get(this.prefix + key) ?? 0) + 1;
      redisCounts.set(this.prefix + key, hits);
      return { totalHits: hits, resetTime: new Date(Date.now() + 60_000) };
    }
    async decrement(key: string) {
      redisCounts.set(this.prefix + key, (redisCounts.get(this.prefix + key) ?? 1) - 1);
    }
    async resetKey(key: string) {
      redisCounts.delete(this.prefix + key);
    }
  },
}));

const setRedisReady = (isReady: boolean) => {
  (RedisUtil as unknown as { client: unknown }).client = { isReady, sendCommand: jest.fn() };
};

const OPTIONS = { windowMs: 60_000 } as Parameters<FailoverStore['init']>[0];

beforeEach(() => {
  redisCounts.clear();
  redisFails = false;
  jest.clearAllMocks();
});

describe('FailoverStore', () => {
  it('starts using Redis once it connects, though built before it did', async () => {
    setRedisReady(false);
    const store = new FailoverStore('test');
    store.init(OPTIONS);

    await store.increment('k');
    expect(redisCounts.size).toBe(0);

    setRedisReady(true);
    await store.increment('k');
    expect(redisCounts.get('rl:test:k')).toBe(1);
    store.shutdown();
  });

  it('shares the count across instances through Redis', async () => {
    setRedisReady(true);
    const a = new FailoverStore('shared');
    const b = new FailoverStore('shared');
    a.init(OPTIONS);
    b.init(OPTIONS);

    await a.increment('k');
    expect((await b.increment('k')).totalHits).toBe(2);
    a.shutdown();
    b.shutdown();
  });

  it('falls back to memory when a Redis command fails, logging once', async () => {
    setRedisReady(true);
    redisFails = true;
    const store = new FailoverStore('flaky');
    store.init(OPTIONS);

    expect((await store.increment('k')).totalHits).toBe(1);
    expect((await store.increment('k')).totalHits).toBe(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
    store.shutdown();
  });
});

describe('auth limits outside tests', () => {
  const LIMITS = {
    global: 100,
    credential: 6,
    credentialFailures: 6,
    resetEmail: 3,
    resetEmailWindowMinutes: 60,
  };
  const env = process.env.NODE_ENV;
  beforeAll(() => (process.env.NODE_ENV = 'production'));
  afterAll(() => (process.env.NODE_ENV = env));

  const login = (app: express.Express) =>
    request(app).post('/api/v1/auth/login').set('CF-Connecting-IP', '203.0.113.9').send({});

  function buildApp() {
    const app = express();
    app.use(express.json());
    applyRateLimits(app, createRateLimiters(LIMITS));
    app.post('/api/v1/auth/login', (_req, res) => res.status(200).json({ ok: true }));
    return app;
  }

  it('applies the configured limit once Redis is ready, even if it was not at build time', async () => {
    setRedisReady(false);
    const app = buildApp();
    setRedisReady(true);

    for (let i = 0; i < LIMITS.credential; i++) expect((await login(app)).status).toBe(200);
    expect((await login(app)).status).toBe(429);
  });

  it('drops to the emergency cap while Redis is down', async () => {
    setRedisReady(false);
    const app = buildApp();

    for (let i = 0; i < 5; i++) expect((await login(app)).status).toBe(200);
    expect((await login(app)).status).toBe(429);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('EMERGENCY'));
  });
});
