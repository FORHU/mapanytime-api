import { INVITESTATUS } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import logger from '../../utils/logger';

export interface PruneMaintenanceResult {
  sessionsPurged: number;
  resetTokensPurged: number;
  invitesExpired: number;
}

export class SystemMaintenanceService {
  /**
   * Cleans up expired sessions, consumed/expired password reset tokens,
   * and marks expired pending admin invites (F103, F110).
   */
  static async pruneExpiredRecords(cutoff: Date = new Date()): Promise<PruneMaintenanceResult> {
    const [sessionsResult, resetTokensResult, invitesResult] = await Promise.all([
      // 1. Purge expired AuthSession rows
      prisma.authSession.deleteMany({
        where: { expiresAt: { lt: cutoff } },
      }),
      // 2. Purge expired or consumed PasswordResetTokens
      prisma.passwordResetTokens.deleteMany({
        where: {
          OR: [{ expiresAt: { lt: cutoff } }, { consumedAt: { not: null } }],
        },
      }),
      // 3. Mark expired pending AdminInvites
      prisma.adminInvites.updateMany({
        where: {
          status: INVITESTATUS.PENDING,
          expiresAt: { lt: cutoff },
        },
        data: {
          status: INVITESTATUS.EXPIRED,
        },
      }),
    ]);

    const result: PruneMaintenanceResult = {
      sessionsPurged: sessionsResult.count,
      resetTokensPurged: resetTokensResult.count,
      invitesExpired: invitesResult.count,
    };

    logger.debug(
      `[SystemMaintenance] Prune complete: sessions=${result.sessionsPurged}, resetTokens=${result.resetTokensPurged}, invites=${result.invitesExpired}`,
    );

    return result;
  }
}

export default SystemMaintenanceService;
