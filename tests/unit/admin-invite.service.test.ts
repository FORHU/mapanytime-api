import { INVITESTATUS } from '@prisma/client';
import { SYSTEM_ROLES } from '../../src/constants/roles.constant';

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

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    users: {
      findFirst: jest.fn(),
    },
    adminInvites: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('../../src/utils/mailer', () => ({
  sendEmail: jest.fn().mockResolvedValue('msg-id-123'),
  isMailerConfigured: jest.fn().mockReturnValue(true),
}));

jest.mock('../../src/modules/auth/password-hash', () => ({
  hashPassword: jest.fn().mockResolvedValue('$scrypt$mockhashedpassword'),
}));

import { prisma } from '../../src/utils/prisma';
import { sendEmail } from '../../src/utils/mailer';
import { AdminInviteService } from '../../src/modules/adminInvites/admin-invite.service';

const mockPrisma = prisma as unknown as {
  users: { findFirst: jest.Mock };
  adminInvites: {
    upsert: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
  };
};

describe('AdminInviteService (ID-5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createInvite', () => {
    it('rejects an invalid or missing email address', async () => {
      await expect(
        AdminInviteService.createInvite({
          email: 'invalid-email',
          inviterId: 'admin-1',
        }),
      ).rejects.toMatchObject({ status: 400, message: 'A valid email address is required.' });
    });

    it('rejects an unauthorized non-administrative role', async () => {
      await expect(
        AdminInviteService.createInvite({
          email: 'newadmin@mapanytime.test',
          role: 'BUYER',
          inviterId: 'admin-1',
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('rejects when the user already exists and holds the specified admin role', async () => {
      mockPrisma.users.findFirst.mockResolvedValueOnce({
        id: 'usr-existing-admin',
        email: 'existing.admin@mapanytime.test',
        roles: [{ roleName: SYSTEM_ROLES.ADMIN }],
      });

      await expect(
        AdminInviteService.createInvite({
          email: 'existing.admin@mapanytime.test',
          role: SYSTEM_ROLES.ADMIN,
          inviterId: 'admin-1',
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('creates an invite, generates a secure token, and dispatches email', async () => {
      mockPrisma.users.findFirst.mockResolvedValueOnce(null);
      mockPrisma.adminInvites.upsert.mockResolvedValueOnce({
        id: 'inv-1',
        email: 'newadmin@mapanytime.test',
        token: 'mock-random-token',
        role: SYSTEM_ROLES.ADMIN,
        status: INVITESTATUS.PENDING,
        inviterId: 'admin-1',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      const invite = await AdminInviteService.createInvite({
        email: 'NewAdmin@mapanytime.test ',
        role: SYSTEM_ROLES.ADMIN,
        inviterId: 'admin-1',
      });

      expect(invite.email).toBe('newadmin@mapanytime.test');
      expect(mockPrisma.adminInvites.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: 'newadmin@mapanytime.test' },
          create: expect.objectContaining({
            email: 'newadmin@mapanytime.test',
            role: SYSTEM_ROLES.ADMIN,
            status: INVITESTATUS.PENDING,
          }),
        }),
      );
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'newadmin@mapanytime.test',
          subject: "You've been invited to MapAnytime Admin",
        }),
      );
    });
  });

  describe('listInvites', () => {
    it('returns paginated invitations and total count', async () => {
      mockPrisma.adminInvites.findMany.mockResolvedValueOnce([
        { id: 'inv-1', email: 'admin1@test.com', status: INVITESTATUS.PENDING },
      ]);
      mockPrisma.adminInvites.count.mockResolvedValueOnce(1);

      const result = await AdminInviteService.listInvites({ page: 1, limit: 10 });
      expect(result.invites).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
    });
  });

  describe('revokeInvite', () => {
    it('throws 404 if invite is not found', async () => {
      mockPrisma.adminInvites.findUnique.mockResolvedValueOnce(null);

      await expect(AdminInviteService.revokeInvite('inv-unknown')).rejects.toMatchObject({
        status: 404,
      });
    });

    it('throws 400 if invite was already accepted', async () => {
      mockPrisma.adminInvites.findUnique.mockResolvedValueOnce({
        id: 'inv-accepted',
        status: INVITESTATUS.ACCEPTED,
      });

      await expect(AdminInviteService.revokeInvite('inv-accepted')).rejects.toMatchObject({
        status: 400,
      });
    });

    it('updates status to REVOKED for pending invite', async () => {
      mockPrisma.adminInvites.findUnique.mockResolvedValueOnce({
        id: 'inv-pending',
        status: INVITESTATUS.PENDING,
      });
      mockPrisma.adminInvites.update.mockResolvedValueOnce({
        id: 'inv-pending',
        status: INVITESTATUS.REVOKED,
      });

      const res = await AdminInviteService.revokeInvite('inv-pending');
      expect(res.status).toBe(INVITESTATUS.REVOKED);
    });
  });

  describe('validateInvite', () => {
    it('throws 404 for unknown token', async () => {
      mockPrisma.adminInvites.findUnique.mockResolvedValueOnce(null);

      await expect(AdminInviteService.validateInvite('invalid-token')).rejects.toMatchObject({
        status: 404,
      });
    });

    it('throws 400 if status is not PENDING', async () => {
      mockPrisma.adminInvites.findUnique.mockResolvedValueOnce({
        id: 'inv-revoked',
        token: 'token-revoked',
        status: INVITESTATUS.REVOKED,
      });

      await expect(AdminInviteService.validateInvite('token-revoked')).rejects.toMatchObject({
        status: 400,
      });
    });

    it('marks EXPIRED and throws 400 when expiresAt is in the past', async () => {
      mockPrisma.adminInvites.findUnique.mockResolvedValueOnce({
        id: 'inv-expired',
        token: 'token-expired',
        status: INVITESTATUS.PENDING,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(AdminInviteService.validateInvite('token-expired')).rejects.toMatchObject({
        status: 400,
        message: 'Invitation has expired.',
      });
      expect(mockPrisma.adminInvites.update).toHaveBeenCalledWith({
        where: { id: 'inv-expired' },
        data: { status: INVITESTATUS.EXPIRED },
      });
    });

    it('returns validation data for active pending token', async () => {
      const future = new Date(Date.now() + 50000);
      mockPrisma.adminInvites.findUnique.mockResolvedValueOnce({
        id: 'inv-valid',
        token: 'token-valid',
        email: 'staff@mapanytime.test',
        role: SYSTEM_ROLES.SUPPORT_AGENT,
        status: INVITESTATUS.PENDING,
        expiresAt: future,
      });

      const res = await AdminInviteService.validateInvite('token-valid');
      expect(res.valid).toBe(true);
      expect(res.email).toBe('staff@mapanytime.test');
      expect(res.role).toBe(SYSTEM_ROLES.SUPPORT_AGENT);
    });
  });

  describe('acceptInvite', () => {
    it('throws 400 when password is under 8 characters', async () => {
      await expect(
        AdminInviteService.acceptInvite({
          token: 'token-123',
          password: 'short',
        }),
      ).rejects.toMatchObject({
        status: 400,
        message: 'Password must be at least 8 characters long.',
      });
    });

    it('activates a new administrator account and records acceptance', async () => {
      const future = new Date(Date.now() + 100000);
      mockPrisma.adminInvites.findUnique.mockResolvedValueOnce({
        id: 'inv-123',
        token: 'valid-token',
        email: 'newadmin@mapanytime.test',
        role: SYSTEM_ROLES.ADMIN,
        status: INVITESTATUS.PENDING,
        expiresAt: future,
      });

      tx.users.findFirst.mockResolvedValueOnce(null);
      tx.users.create.mockResolvedValueOnce({
        id: 'usr-new-admin',
        email: 'newadmin@mapanytime.test',
      });
      tx.authAccount.create.mockResolvedValueOnce({ id: 'acc-1' });
      tx.adminInvites.update.mockResolvedValueOnce({
        id: 'inv-123',
        status: INVITESTATUS.ACCEPTED,
        acceptedAt: new Date(),
      });

      const result = await AdminInviteService.acceptInvite({
        token: 'valid-token',
        password: 'Password123!',
        firstName: 'Alex',
        lastName: 'Admin',
      });

      expect(result.userId).toBe('usr-new-admin');
      expect(result.email).toBe('newadmin@mapanytime.test');
      expect(result.role).toBe(SYSTEM_ROLES.ADMIN);
      expect(result.status).toBe(INVITESTATUS.ACCEPTED);
      expect(result.acceptedAt).toBeDefined();

      expect(tx.users.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'newadmin@mapanytime.test',
            firstName: 'Alex',
            lastName: 'Admin',
            isEmailVerified: true,
            accountStatus: 'ACTIVE',
          }),
        }),
      );
      expect(tx.authAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'usr-new-admin',
            providerId: 'credential',
            password: '$scrypt$mockhashedpassword',
          }),
        }),
      );
    });

    it('promotes an existing user by attaching the role and credentials', async () => {
      const future = new Date(Date.now() + 100000);
      mockPrisma.adminInvites.findUnique.mockResolvedValueOnce({
        id: 'inv-upgrade',
        token: 'token-upgrade',
        email: 'promoted@mapanytime.test',
        role: SYSTEM_ROLES.DEVELOPER,
        status: INVITESTATUS.PENDING,
        expiresAt: future,
      });

      tx.users.findFirst.mockResolvedValueOnce({
        id: 'usr-promoted',
        email: 'promoted@mapanytime.test',
        firstName: 'Existing',
        lastName: 'User',
      });
      tx.users.update.mockResolvedValueOnce({
        id: 'usr-promoted',
        email: 'promoted@mapanytime.test',
      });
      tx.authAccount.findFirst.mockResolvedValueOnce({ id: 'acc-existing' });
      tx.authAccount.update.mockResolvedValueOnce({ id: 'acc-existing' });
      tx.adminInvites.update.mockResolvedValueOnce({
        id: 'inv-upgrade',
        status: INVITESTATUS.ACCEPTED,
        acceptedAt: new Date(),
      });

      const result = await AdminInviteService.acceptInvite({
        token: 'token-upgrade',
        password: 'Password123!',
      });

      expect(result.userId).toBe('usr-promoted');
      expect(result.role).toBe(SYSTEM_ROLES.DEVELOPER);
      expect(tx.users.update).toHaveBeenCalled();
      expect(tx.authAccount.update).toHaveBeenCalled();
    });
  });
});
