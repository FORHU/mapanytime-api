import request from 'supertest';
import app from '../../src/app';
import { prisma } from '../../src/utils/prisma';
import { INVITESTATUS } from '@prisma/client';
import { SYSTEM_ROLES } from '../../src/constants/roles.constant';

jest.setTimeout(20000);

let currentTestUser: { id: string; email: string; accountStatus: string } | null = {
  id: 'admin-1',
  email: 'superadmin@mapanytime.test',
  accountStatus: 'ACTIVE',
};

jest.mock('../../src/middleware/auth.middleware', () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (!req.headers.authorization) {
      return res
        .status(401)
        .json({ status: 'error', statusCode: 401, message: 'No token provided' });
    }
    if (!currentTestUser) {
      return res
        .status(401)
        .json({ status: 'error', statusCode: 401, message: 'Unauthorized access.' });
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

jest.mock('../../src/utils/mailer', () => ({
  sendEmail: jest.fn().mockResolvedValue('msg-mock-123'),
  isMailerConfigured: jest.fn().mockReturnValue(true),
}));

jest.mock('../../src/modules/auth/password-hash', () => ({
  hashPassword: jest.fn().mockResolvedValue('$scrypt$hashedpass123'),
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
    close: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../src/utils/prisma', () => {
  const tx = {
    users: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    authAccount: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    adminInvites: {
      update: jest.fn(),
    },
  };

  return {
    prisma: {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      $disconnect: jest.fn().mockResolvedValue(undefined),
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
      users: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      adminInvites: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      _tx: tx,
    },
  };
});

const mockPrisma = prisma as unknown as {
  users: { findUnique: jest.Mock; findFirst: jest.Mock };
  adminInvites: {
    upsert: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
  };
  _tx: {
    users: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    authAccount: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    adminInvites: { update: jest.Mock };
  };
};

describe('Admin Invitation Routes (/api/v1/admin/invites) (P1-3, ID-5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    currentTestUser = {
      id: 'admin-1',
      email: 'superadmin@mapanytime.test',
      accountStatus: 'ACTIVE',
    };

    mockPrisma.users.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === 'admin-1') {
        return Promise.resolve({
          id: 'admin-1',
          email: 'superadmin@mapanytime.test',
          roles: [{ roleName: SYSTEM_ROLES.SUPER_ADMIN, permissions: [] }],
        });
      }
      if (where.id === 'buyer-1') {
        return Promise.resolve({
          id: 'buyer-1',
          email: 'buyer@mapanytime.test',
          roles: [{ roleName: SYSTEM_ROLES.BUYER, permissions: [] }],
        });
      }
      return Promise.resolve(null);
    });
  });

  describe('Authentication & RBAC Gates', () => {
    it('rejects POST /api/v1/admin/invites without authorization header with 401', async () => {
      const res = await request(app).post('/api/v1/admin/invites').send({ email: 'new@test.com' });
      expect(res.status).toBe(401);
    });

    it('rejects GET /api/v1/admin/invites without authorization header with 401', async () => {
      const res = await request(app).get('/api/v1/admin/invites');
      expect(res.status).toBe(401);
    });

    it('rejects POST /api/v1/admin/invites for non-admin user with 403', async () => {
      currentTestUser = { id: 'buyer-1', email: 'buyer@mapanytime.test', accountStatus: 'ACTIVE' };
      const res = await request(app)
        .post('/api/v1/admin/invites')
        .set('Authorization', 'Bearer token')
        .send({ email: 'new@test.com' });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/v1/admin/invites', () => {
    it('creates an admin invitation and dispatches email for valid administrator', async () => {
      mockPrisma.users.findFirst.mockResolvedValueOnce(null);
      mockPrisma.adminInvites.upsert.mockResolvedValueOnce({
        id: 'inv-created-1',
        email: 'invited.admin@mapanytime.test',
        role: SYSTEM_ROLES.ADMIN,
        token: 'token-abc-123',
        status: INVITESTATUS.PENDING,
        inviterId: 'admin-1',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      const res = await request(app)
        .post('/api/v1/admin/invites')
        .set('Authorization', 'Bearer admin-token')
        .send({
          email: 'invited.admin@mapanytime.test',
          role: SYSTEM_ROLES.ADMIN,
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.email).toBe('invited.admin@mapanytime.test');
      expect(res.body.data.role).toBe(SYSTEM_ROLES.ADMIN);
      expect(res.body.data.status).toBe(INVITESTATUS.PENDING);
    });
  });

  describe('GET /api/v1/admin/invites', () => {
    it('lists admin invitations with pagination', async () => {
      mockPrisma.adminInvites.findMany.mockResolvedValueOnce([
        { id: 'inv-1', email: 'invited@test.com', status: INVITESTATUS.PENDING },
      ]);
      mockPrisma.adminInvites.count.mockResolvedValueOnce(1);

      const res = await request(app)
        .get('/api/v1/admin/invites?page=1&limit=10')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.invites).toHaveLength(1);
      expect(res.body.data.total).toBe(1);
    });
  });

  describe('POST /api/v1/admin/invites/:id/revoke', () => {
    it('revokes a pending admin invitation', async () => {
      mockPrisma.adminInvites.findUnique.mockResolvedValueOnce({
        id: 'inv-to-revoke',
        status: INVITESTATUS.PENDING,
      });
      mockPrisma.adminInvites.update.mockResolvedValueOnce({
        id: 'inv-to-revoke',
        status: INVITESTATUS.REVOKED,
      });

      const res = await request(app)
        .post('/api/v1/admin/invites/inv-to-revoke/revoke')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.status).toBe(INVITESTATUS.REVOKED);
    });
  });

  describe('GET /api/v1/admin/invites/validate (Public)', () => {
    it('validates a valid pending invitation token without authentication', async () => {
      mockPrisma.adminInvites.findUnique.mockResolvedValueOnce({
        id: 'inv-val',
        token: 'public-token-123',
        email: 'onboarding@mapanytime.test',
        role: SYSTEM_ROLES.SUPPORT_AGENT,
        status: INVITESTATUS.PENDING,
        expiresAt: new Date(Date.now() + 60000),
      });

      const res = await request(app).get('/api/v1/admin/invites/validate?token=public-token-123');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.valid).toBe(true);
      expect(res.body.data.email).toBe('onboarding@mapanytime.test');
      expect(res.body.data.role).toBe(SYSTEM_ROLES.SUPPORT_AGENT);
    });

    it('returns 400 when token has expired', async () => {
      mockPrisma.adminInvites.findUnique.mockResolvedValueOnce({
        id: 'inv-expired',
        token: 'expired-token',
        status: INVITESTATUS.PENDING,
        expiresAt: new Date(Date.now() - 60000),
      });
      mockPrisma.adminInvites.update.mockResolvedValueOnce({
        id: 'inv-expired',
        status: INVITESTATUS.EXPIRED,
      });

      const res = await request(app).get('/api/v1/admin/invites/validate?token=expired-token');

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/admin/invites/accept (Public)', () => {
    it('accepts invite and activates account with credentials without prior authentication', async () => {
      mockPrisma.adminInvites.findUnique.mockResolvedValueOnce({
        id: 'inv-accept',
        token: 'token-to-accept',
        email: 'activated.admin@mapanytime.test',
        role: SYSTEM_ROLES.ADMIN,
        status: INVITESTATUS.PENDING,
        expiresAt: new Date(Date.now() + 100000),
      });

      mockPrisma._tx.users.findFirst.mockResolvedValueOnce(null);
      mockPrisma._tx.users.create.mockResolvedValueOnce({
        id: 'usr-activated-1',
        email: 'activated.admin@mapanytime.test',
      });
      mockPrisma._tx.authAccount.create.mockResolvedValueOnce({ id: 'acc-1' });
      mockPrisma._tx.adminInvites.update.mockResolvedValueOnce({
        id: 'inv-accept',
        status: INVITESTATUS.ACCEPTED,
        acceptedAt: new Date(),
      });

      const res = await request(app).post('/api/v1/admin/invites/accept').send({
        token: 'token-to-accept',
        password: 'Password123!',
        firstName: 'Jane',
        lastName: 'Admin',
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.userId).toBe('usr-activated-1');
      expect(res.body.data.email).toBe('activated.admin@mapanytime.test');
      expect(res.body.data.role).toBe(SYSTEM_ROLES.ADMIN);
      expect(res.body.data.status).toBe(INVITESTATUS.ACCEPTED);
      expect(res.body.data.acceptedAt).toBeDefined();
    });
  });
});
