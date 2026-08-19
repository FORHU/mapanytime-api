import request from 'supertest';
import app from '../../src/app';

/**
 * Infrastructure is mocked below, so the cost here is compiling the app's import
 * graph, which lands on whichever test runs first. Under a loaded full suite that
 * has overrun the default while the suite passes in ~7s alone; `maxWorkers` in
 * jest.config.ts is the actual remedy. Assertions are unchanged — only the budget
 * is raised, so a real hang still fails.
 */
jest.setTimeout(20000);

/**
 * Every /v1/rbac endpoint reads or rewrites the role/permission model, so none
 * of them may be reachable without an authenticated admin.
 *
 * This shipped unauthenticated: the router was mounted with no middleware at
 * all, leaving `POST /roles` and `PUT /roles/:roleId/permissions` writable by
 * anyone. These tests exist so that cannot regress silently.
 *
 * Infrastructure is mocked so the suite runs without a live database, Redis or
 * RabbitMQ — the same approach as health.test.ts.
 */
jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    users: { findUnique: jest.fn().mockResolvedValue(null) },
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

const endpoints: Array<{ method: 'get' | 'post' | 'put'; path: string; writes: boolean }> = [
  { method: 'get', path: '/api/v1/rbac/permissions', writes: false },
  { method: 'get', path: '/api/v1/rbac/roles', writes: false },
  { method: 'post', path: '/api/v1/rbac/roles', writes: true },
  { method: 'put', path: '/api/v1/rbac/roles/role-1/permissions', writes: true },
];

describe('RBAC endpoint authorization', () => {
  describe('without a token', () => {
    endpoints.forEach(({ method, path }) => {
      it(`${method.toUpperCase()} ${path} is rejected`, async () => {
        const res = await request(app)[method](path).send({});
        expect(res.status).toBe(401);
      });
    });
  });

  describe('with a malformed token', () => {
    endpoints.forEach(({ method, path }) => {
      it(`${method.toUpperCase()} ${path} is rejected`, async () => {
        const res = await request(app)[method](path)
          .set('Authorization', 'Bearer not-a-real-token')
          .send({});
        expect(res.status).toBe(401);
      });
    });
  });

  it('never reaches the controller for an unauthenticated write', async () => {
    const res = await request(app)
      .post('/api/v1/rbac/roles')
      .send({ roleName: 'ATTACKER', permissionCodes: ['users.manage'] });

    // A 400 here would mean the controller ran its own validation, i.e. the
    // request got past the auth layer.
    expect(res.status).toBe(401);
  });
});
