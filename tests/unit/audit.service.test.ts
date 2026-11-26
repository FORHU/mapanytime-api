jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    auditLogs: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    users: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { prisma } from '../../src/utils/prisma';
import AuditService from '../../src/modules/audit/audit.service';
import AuditController from '../../src/modules/audit/audit.controller';
import { Request, Response } from 'express';

const mockPrisma = prisma as unknown as {
  auditLogs: {
    create: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
  };
  users: {
    findMany: jest.Mock;
  };
};

describe('AuditService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('logAction', () => {
    it('creates an audit log entry in Prisma', async () => {
      mockPrisma.auditLogs.create.mockResolvedValueOnce({
        id: 'audit_1',
        action: 'STORE_VERIFIED',
        entityType: 'STORE',
        entityId: 'store_123',
      });

      const result = await AuditService.logAction({
        performedById: 'admin_1',
        action: 'STORE_VERIFIED',
        entityType: 'STORE',
        entityId: 'store_123',
        metadata: { note: 'Looks good' },
      });

      expect(mockPrisma.auditLogs.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          performedById: 'admin_1',
          action: 'STORE_VERIFIED',
          entityType: 'STORE',
          entityId: 'store_123',
          metadata: { note: 'Looks good' },
        }),
      });
      expect(result).toHaveProperty('id', 'audit_1');
    });
  });

  describe('record', () => {
    it('swallows errors and does not throw if audit write fails', async () => {
      mockPrisma.auditLogs.create.mockRejectedValueOnce(new Error('DB connection lost'));

      await expect(
        AuditService.record({
          performedById: 'admin_1',
          action: 'ROLE_CREATED',
          entityType: 'ROLE',
          entityId: 'role_1',
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('getLogs (legacy query)', () => {
    it('returns logs ordered by createdAt desc with default limit', async () => {
      mockPrisma.auditLogs.findMany.mockResolvedValueOnce([{ id: 'log_1' }]);

      const logs = await AuditService.getLogs({ entityType: 'STORE' });
      expect(mockPrisma.auditLogs.findMany).toHaveBeenCalledWith({
        where: { entityType: 'STORE' },
        take: 50,
        orderBy: { createdAt: 'desc' },
      });
      expect(logs).toHaveLength(1);
    });
  });

  describe('list', () => {
    it('queries with filters, pagination, and enriches performedBy user details', async () => {
      const mockRows = [
        {
          id: 'log_1',
          action: 'ADMIN_INVITE_CREATED',
          entityType: 'ADMIN_INVITE',
          entityId: 'inv_1',
          metadata: { email: 'test@example.com' },
          performedById: 'user_admin',
          createdAt: new Date('2026-11-12T10:00:00Z'),
        },
        {
          id: 'log_2',
          action: 'SYSTEM_CRON',
          entityType: 'CRON',
          entityId: 'job_1',
          metadata: null,
          performedById: null,
          createdAt: new Date('2026-11-12T09:00:00Z'),
        },
      ];

      mockPrisma.auditLogs.findMany.mockResolvedValueOnce(mockRows);
      mockPrisma.auditLogs.count.mockResolvedValueOnce(25);
      mockPrisma.users.findMany.mockResolvedValueOnce([
        { id: 'user_admin', name: 'Admin One', email: 'admin@mapanytime.com' },
      ]);

      const result = await AuditService.list({
        action: 'ADMIN_INVITE_CREATED',
        from: new Date('2026-11-01'),
        to: new Date('2026-11-15'),
        page: 2,
        limit: 10,
      });

      expect(mockPrisma.auditLogs.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          action: 'ADMIN_INVITE_CREATED',
          createdAt: {
            gte: new Date('2026-11-01'),
            lte: new Date('2026-11-15'),
          },
        }),
        orderBy: { createdAt: 'desc' },
        skip: 10,
        take: 10,
      });

      expect(result.total).toBe(25);
      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.totalPages).toBe(3);
      expect(result.items[0].performedBy).toEqual({
        id: 'user_admin',
        name: 'Admin One',
        email: 'admin@mapanytime.com',
      });
      expect(result.items[1].performedBy).toBeNull();
    });
  });
});

describe('AuditController.list', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: jest.Mock;

  beforeEach(() => {
    req = { query: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
    jest.clearAllMocks();
  });

  it('rejects invalid from date', async () => {
    req.query = { from: 'not-a-date' };
    await AuditController.list(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid "from" date parameter.' }),
    );
  });

  it('rejects invalid to date', async () => {
    req.query = { to: 'invalid' };
    await AuditController.list(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid "to" date parameter.' }),
    );
  });

  it('rejects invalid page', async () => {
    req.query = { page: '-1' };
    await AuditController.list(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Page must be a positive integer.' }),
    );
  });

  it('calls AuditService.list with valid query and returns 200', async () => {
    req.query = {
      action: 'PAYOUT_STATUS_UPDATED',
      page: '1',
      limit: '15',
    };

    mockPrisma.auditLogs.findMany.mockResolvedValueOnce([]);
    mockPrisma.auditLogs.count.mockResolvedValueOnce(0);

    await AuditController.list(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        statusCode: 200,
        data: expect.objectContaining({
          items: [],
          total: 0,
        }),
      }),
    );
  });
});
