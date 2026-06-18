import request from 'supertest';
import app from '../../src/app';

/**
 * Integration tests for the health endpoints.
 *
 * NOTE: These tests mock infrastructure connections so they run without
 * a live database, Redis, or RabbitMQ instance in CI.
 */
jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    $disconnect: jest.fn().mockResolvedValue(undefined),
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

describe('Health Endpoints', () => {
  describe('GET /api/health/live', () => {
    it('should return 200 with status ok', async () => {
      const res = await request(app).get('/api/health/live');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body).toHaveProperty('uptime');
      expect(res.body).toHaveProperty('timestamp');
    });
  });

  describe('GET /api/health/ready', () => {
    it('should return 200 when all services are up', async () => {
      const res = await request(app).get('/api/health/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
      expect(res.body.services.database).toBe('up');
      expect(res.body.services.redis).toBe('up');
      expect(res.body.services.rabbitmq).toBe('up');
    });
  });

  describe('Correlation Headers', () => {
    it('should return x-request-id and x-correlation-id headers on every response', async () => {
      const res = await request(app).get('/api/health/live');
      expect(res.headers).toHaveProperty('x-request-id');
      expect(res.headers).toHaveProperty('x-correlation-id');
    });

    it('should echo client-provided x-correlation-id', async () => {
      const clientCorrelationId = 'test-corr-12345';
      const res = await request(app)
        .get('/api/health/live')
        .set('x-correlation-id', clientCorrelationId);
      expect(res.headers['x-correlation-id']).toBe(clientCorrelationId);
    });
  });
});
