import express from 'express';
import request from 'supertest';
import { applyRateLimits, createRateLimiters } from '../../src/middleware/rate-limit.middleware';

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

// credential > resetEmail + 2, so the per-address test's requests stay under the per-IP cap.
const LIMITS = {
  global: 5,
  credential: 6,
  credentialFailures: 2,
  resetEmail: 3,
  resetEmailWindowMinutes: 60,
};

/** A bare app with the real limiters and stub handlers, fresh counters per call. */
function buildApp() {
  const app = express();
  app.use(express.json());
  applyRateLimits(app, createRateLimiters(LIMITS));
  app.post('/api/v1/auth/login', (req, res) => {
    res.status(req.body.fail ? 401 : 200).json({ ok: !req.body.fail });
  });
  app.post('/api/v1/auth/forgot-password', (_req, res) => {
    res
      .status(200)
      .json({ message: 'If an account exists for that address, a reset code has been sent.' });
  });
  app.get('/api/v1/stores', (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

async function send(times: number, call: () => request.Test) {
  const statuses: number[] = [];
  for (let i = 0; i < times; i++) statuses.push((await call()).status);
  return statuses;
}

describe('rate limits', () => {
  it('counts successful credential requests, not only failures', async () => {
    const app = buildApp();
    const statuses = await send(LIMITS.credential + 1, () =>
      request(app).post('/api/v1/auth/login').send({}),
    );
    expect(statuses.slice(0, -1).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it('still blocks failed attempts at the tighter failure limit', async () => {
    const app = buildApp();
    const statuses = await send(LIMITS.credentialFailures + 1, () =>
      request(app).post('/api/v1/auth/login').send({ fail: true }),
    );
    expect(statuses).toEqual([401, 401, 429]);
  });

  it('caps forgot-password per address, across spellings of that address', async () => {
    const app = buildApp();
    const spellings = ['victim@example.com', 'VICTIM@example.com', '  victim@Example.com  '];
    for (const email of spellings) {
      expect((await request(app).post('/api/v1/auth/forgot-password').send({ email })).status).toBe(
        200,
      );
    }
    const blocked = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'victim@example.com' });
    expect(blocked.status).toBe(429);

    // Another address still has its own budget.
    const other = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'someone.else@example.com' });
    expect(other.status).toBe(200);
  });

  it('answers a blocked address identically whatever the address', async () => {
    const bodies = [];
    for (const email of ['has-account@example.com', 'no-account@example.com']) {
      const app = buildApp();
      await send(LIMITS.resetEmail, () =>
        request(app).post('/api/v1/auth/forgot-password').send({ email }),
      );
      const res = await request(app).post('/api/v1/auth/forgot-password').send({ email });
      expect(res.status).toBe(429);
      bodies.push(res.body);
    }
    expect(bodies[0]).toEqual(bodies[1]);
  });

  it('keeps the global limit on ordinary routes', async () => {
    const app = buildApp();
    const statuses = await send(LIMITS.global + 1, () => request(app).get('/api/v1/stores'));
    expect(statuses.at(-1)).toBe(429);
  });

  it('does not let ordinary traffic lock out login', async () => {
    const app = buildApp();
    await send(LIMITS.global + 1, () => request(app).get('/api/v1/stores'));
    expect((await request(app).post('/api/v1/auth/login').send({})).status).toBe(200);
  });
});
