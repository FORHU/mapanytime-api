import { INVITESTATUS } from '@prisma/client';
import { prisma } from '../../src/utils/prisma';
import SystemMaintenanceService from '../../src/infrastructure/scheduler/maintenance.service';

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    authSession: {
      deleteMany: jest.fn(),
    },
    passwordResetTokens: {
      deleteMany: jest.fn(),
    },
    adminInvites: {
      updateMany: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as unknown as {
  authSession: { deleteMany: jest.Mock };
  passwordResetTokens: { deleteMany: jest.Mock };
  adminInvites: { updateMany: jest.Mock };
};

describe('SystemMaintenanceService (P1-7, PLT-7, F103, F110)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('pruneExpiredRecords', () => {
    it('purges expired sessions, consumed/expired reset tokens, and marks expired admin invites', async () => {
      mockPrisma.authSession.deleteMany.mockResolvedValueOnce({ count: 5 });
      mockPrisma.passwordResetTokens.deleteMany.mockResolvedValueOnce({ count: 3 });
      mockPrisma.adminInvites.updateMany.mockResolvedValueOnce({ count: 2 });

      const cutoff = new Date('2026-10-27T12:00:00Z');
      const result = await SystemMaintenanceService.pruneExpiredRecords(cutoff);

      expect(result).toEqual({
        sessionsPurged: 5,
        resetTokensPurged: 3,
        invitesExpired: 2,
      });

      expect(mockPrisma.authSession.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: cutoff } },
      });

      expect(mockPrisma.passwordResetTokens.deleteMany).toHaveBeenCalledWith({
        where: {
          OR: [{ expiresAt: { lt: cutoff } }, { consumedAt: { not: null } }],
        },
      });

      expect(mockPrisma.adminInvites.updateMany).toHaveBeenCalledWith({
        where: {
          status: INVITESTATUS.PENDING,
          expiresAt: { lt: cutoff },
        },
        data: {
          status: INVITESTATUS.EXPIRED,
        },
      });
    });

    it('defaults cutoff to current time when omitted', async () => {
      mockPrisma.authSession.deleteMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.passwordResetTokens.deleteMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.adminInvites.updateMany.mockResolvedValueOnce({ count: 0 });

      const before = Date.now();
      const result = await SystemMaintenanceService.pruneExpiredRecords();
      const after = Date.now();

      expect(result).toEqual({
        sessionsPurged: 0,
        resetTokensPurged: 0,
        invitesExpired: 0,
      });

      const calledCutoff = mockPrisma.authSession.deleteMany.mock.calls[0][0].where.expiresAt.lt;
      expect(calledCutoff.getTime()).toBeGreaterThanOrEqual(before - 100);
      expect(calledCutoff.getTime()).toBeLessThanOrEqual(after + 100);
    });
  });
});
