import request from 'supertest';
import app from '../../src/app';
import { prisma } from '../../src/utils/prisma';

jest.setTimeout(20000);

let currentTestUser: { id: string; email: string; accountStatus: string } | null = {
  id: 'user-1',
  email: 'user1@example.com',
  accountStatus: 'ACTIVE',
};

jest.mock('../../src/middleware/auth.middleware', () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (!req.headers.authorization) {
      return res.status(401).json({ status: false, statusCode: 401, message: 'No token provided' });
    }
    if (!currentTestUser) {
      return res
        .status(401)
        .json({ status: false, statusCode: 401, message: 'Unauthorized access.' });
    }
    req.user = currentTestUser;
    next();
  },
  optionalAuthenticate: (req: any, _res: any, next: any) => {
    if (req.headers.authorization && currentTestUser) {
      req.user = currentTestUser;
    }
    next();
  },
  resolveActiveUser: jest.fn().mockImplementation(() => Promise.resolve(currentTestUser)),
}));

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    users: { findUnique: jest.fn().mockResolvedValue(null) },
    notifications: {
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
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

jest.mock('../../src/infrastructure/event-bus', () => ({
  eventBus: {
    ping: jest.fn().mockResolvedValue(true),
    publish: jest.fn().mockResolvedValue(true),
    publishMany: jest.fn().mockResolvedValue([]),
    consume: jest.fn(),
    consumeBatch: jest.fn(),
  },
}));

const mockPrisma = prisma as unknown as {
  notifications: {
    findMany: jest.Mock;
    count: jest.Mock;
    updateMany: jest.Mock;
    create: jest.Mock;
  };
};

describe('Notification Feed Routes (/api/v1/notifications)', () => {
  const token = 'Bearer test-valid-session-token';

  beforeEach(() => {
    jest.clearAllMocks();
    currentTestUser = {
      id: 'user-1',
      email: 'user1@example.com',
      accountStatus: 'ACTIVE',
    };
  });

  describe('Authentication Enforcement', () => {
    it('rejects GET /api/v1/notifications without authorization header with 401', async () => {
      const res = await request(app).get('/api/v1/notifications');
      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/no token provided/i);
    });

    it('rejects GET /api/v1/notifications/unread-count without authorization header with 401', async () => {
      const res = await request(app).get('/api/v1/notifications/unread-count');
      expect(res.status).toBe(401);
    });

    it('rejects PATCH /api/v1/notifications/read-all without authorization header with 401', async () => {
      const res = await request(app).patch('/api/v1/notifications/read-all');
      expect(res.status).toBe(401);
    });

    it('rejects PATCH /api/v1/notifications/:id/read without authorization header with 401', async () => {
      const res = await request(app).patch('/api/v1/notifications/notif-1/read');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/notifications', () => {
    it('returns 200 and notifications array for authenticated user', async () => {
      const mockNotifications = [
        {
          id: 'notif-1',
          userId: 'user-1',
          title: 'Order Completed',
          body: 'Your order #1001 has arrived.',
          metadata: { orderId: 'ord-1001' },
          readAt: null,
          createdAt: new Date('2026-10-27T10:00:00Z'),
        },
      ];
      mockPrisma.notifications.findMany.mockResolvedValue(mockNotifications);

      const res = await request(app).get('/api/v1/notifications').set('Authorization', token);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe('notif-1');

      expect(mockPrisma.notifications.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    });

    it('filters unread notifications when unreadOnly=true is passed', async () => {
      mockPrisma.notifications.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/v1/notifications?unreadOnly=true')
        .set('Authorization', token);

      expect(res.status).toBe(200);
      expect(mockPrisma.notifications.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', readAt: null },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    });

    it('supports pagination query params page and limit', async () => {
      mockPrisma.notifications.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/v1/notifications?page=2&limit=15')
        .set('Authorization', token);

      expect(res.status).toBe(200);
      expect(mockPrisma.notifications.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        skip: 15,
        take: 15,
      });
    });
  });

  describe('GET /api/v1/notifications/unread-count', () => {
    it('returns badge count for unread notifications', async () => {
      mockPrisma.notifications.count.mockResolvedValue(7);

      const res = await request(app)
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', token);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data).toEqual({ count: 7 });
      expect(mockPrisma.notifications.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', readAt: null },
      });
    });
  });

  describe('PATCH & POST /api/v1/notifications/:id/read', () => {
    it('marks a single notification read using PATCH', async () => {
      mockPrisma.notifications.updateMany.mockResolvedValue({ count: 1 });

      const res = await request(app)
        .patch('/api/v1/notifications/notif-1/read')
        .set('Authorization', token);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(mockPrisma.notifications.updateMany).toHaveBeenCalledWith({
        where: { id: 'notif-1', userId: 'user-1' },
        data: { readAt: expect.any(Date) },
      });
    });

    it('marks a single notification read using POST alias', async () => {
      mockPrisma.notifications.updateMany.mockResolvedValue({ count: 1 });

      const res = await request(app)
        .post('/api/v1/notifications/notif-1/read')
        .set('Authorization', token);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('returns 404 when notification does not exist or belongs to another user', async () => {
      mockPrisma.notifications.updateMany.mockResolvedValue({ count: 0 });

      const res = await request(app)
        .patch('/api/v1/notifications/notif-other-user/read')
        .set('Authorization', token);

      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/notification not found/i);
    });
  });

  describe('PATCH & POST /api/v1/notifications/read-all', () => {
    it('marks all unread notifications read for the caller using PATCH', async () => {
      mockPrisma.notifications.updateMany.mockResolvedValue({ count: 4 });

      const res = await request(app)
        .patch('/api/v1/notifications/read-all')
        .set('Authorization', token);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(mockPrisma.notifications.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', readAt: null },
        data: { readAt: expect.any(Date) },
      });
    });

    it('marks all unread notifications read for the caller using POST alias', async () => {
      mockPrisma.notifications.updateMany.mockResolvedValue({ count: 4 });

      const res = await request(app)
        .post('/api/v1/notifications/read-all')
        .set('Authorization', token);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
    });
  });
});
