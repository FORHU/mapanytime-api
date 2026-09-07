import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';

const userInclude = {
  avatarFile: true,
  roles: true,
  seller: {
    include: { stores: true },
  },
} satisfies Prisma.UsersInclude;

export default class AuthRepo {
  static async createUser(data: Prisma.UsersCreateInput) {
    return prisma.users.create({
      data: {
        ...data,
        isEmailVerified: true,
        accountStatus: 'ACTIVE',
      },
      include: userInclude,
    });
  }

  static async createSeller(userId: string) {
    return prisma.sellers.create({
      data: { userId },
    });
  }

  static async createBuyer(userId: string, displayName: string) {
    return prisma.buyers.create({
      data: {
        userId: userId,
        displayName: displayName,
      },
    });
  }

  /**
   * Email addresses are not case-sensitive in practice, so neither is this lookup.
   * A case-sensitive match meant someone who registered as `Bob@x.com` could not sign
   * in as `bob@x.com`, and let registration mint a second account differing only by
   * case — which the `@unique` constraint does not prevent.
   *
   * Callers should still normalise on the way in (the login schema lowercases); this
   * is the safety net for rows written before that.
   */
  static async findUserByEmail(email: string) {
    return prisma.users.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        accountStatus: 'ACTIVE',
      },
      include: userInclude,
    });
  }

  static async updateUserLoginStatus(userId: string) {
    return prisma.users.update({
      where: { id: userId },
      data: { lastLoginAt: new Date(), updatedAt: new Date() },
      include: userInclude,
    });
  }

  static async findUserById(userId: string) {
    return prisma.users.findFirst({
      where: { id: userId, accountStatus: 'ACTIVE' },
      include: userInclude,
    });
  }

  // Sessions are created only via rotateSession() below, which also updates activeSessionId in
  // the same transaction. A bare create would leave the two out of step.

  /**
   * Claims a refresh token for single use, atomically.
   *
   * The conditional UPDATE is the whole point. Two requests presenting the same token
   * both used to pass a plain "is this session valid" read and both go on to rotate it,
   * leaving the loser holding tokens `activeSessionId` no longer points at (F102). Here
   * the second UPDATE blocks on the first one's row lock, re-evaluates `usedAt IS NULL`
   * against the committed row, and matches nothing — so exactly one caller can claim.
   *
   * Every rejection is reported distinctly rather than collapsed into "invalid", because
   * the caller has to treat replay differently from expiry: one is a dead token, the
   * other is evidence the chain is compromised.
   */
  static async claimRefreshSession(params: { jti: string; tokenHash: string; graceMs: number }) {
    return prisma.$transaction(async (tx) => {
      const session = await tx.session.findUnique({ where: { jti: params.jti } });
      if (!session) return { outcome: 'unknown' as const, session: null };

      // A jti that exists but hashes to something else is a forged or tampered token,
      // not a stale one. Treated as hostile.
      if (session.refreshTokenHash !== params.tokenHash) {
        return { outcome: 'mismatch' as const, session };
      }
      if (session.revokedAt) return { outcome: 'revoked' as const, session };
      if (session.expiresAt && session.expiresAt <= new Date()) {
        return { outcome: 'expired' as const, session };
      }

      const claimed = await tx.session.updateMany({
        where: { jti: params.jti, usedAt: null, revokedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 1) return { outcome: 'claimed' as const, session };

      // Lost the race, or a genuine replay. Re-read to see which: `usedAt` is now set by
      // whoever won, and how long ago decides the verdict.
      const settled = await tx.session.findUnique({ where: { jti: params.jti } });
      const usedAt = settled?.usedAt;
      const withinGrace =
        params.graceMs > 0 && !!usedAt && Date.now() - usedAt.getTime() <= params.graceMs;

      return {
        outcome: withinGrace ? ('raced' as const) : ('replayed' as const),
        session: settled ?? session,
      };
    });
  }

  /**
   * Tears down an entire refresh-token chain and the access token riding on it.
   *
   * Called on replay: once one token in a family comes back after being consumed, no
   * token in that family can be trusted, because there is no way to tell which side of
   * the chain the attacker holds. Clearing `activeSessionId` in the same transaction is
   * what makes it immediate — revoking the rows alone would leave the current access
   * token working until it expired.
   */
  static async revokeFamily(familyId: string, userId: string) {
    return prisma.$transaction(async (tx) => {
      const revoked = await tx.session.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.users.update({ where: { id: userId }, data: { activeSessionId: null } });
      return revoked.count;
    });
  }

  static async findSessionByJti(jti: string) {
    return prisma.session.findUnique({ where: { jti } });
  }

  /**
   * Atomically swaps a user onto a new session and points activeSessionId at it.
   *
   * These writes must land together. Done piecemeal, a failure partway through leaves the
   * user with their old sessions revoked and no new one to show for it — logged out
   * everywhere by a request that was supposed to log them in.
   *
   * `revokeOtherSessions` is the single-active-device rule and belongs to real logins only.
   * A token refresh passes `replacesJti` instead so it retires just the link it came from,
   * otherwise routine refreshes on one device would silently sign the user out on the others.
   *
   * Nothing is deleted any more. Superseded rows are marked, not dropped, because a consumed
   * row is exactly what tells a replayed token apart from an unknown one (F103) — deleting it
   * threw that evidence away. The cost is that this table now only grows; pruning expired rows
   * is the sweeper's job, tracked with F44/F52/F91.
   */
  static async rotateSession(params: {
    userId: string;
    jti: string;
    refreshTokenHash: string;
    familyId: string;
    expiresAt: Date;
    provider?: string;
    providerUserId?: string;
    providerAvatarUrl?: string;
    revokeOtherSessions?: boolean;
    replacesJti?: string;
  }) {
    return prisma.$transaction(async (tx) => {
      if (params.revokeOtherSessions) {
        await tx.session.updateMany({
          where: { userId: params.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      const session = await tx.session.create({
        data: {
          userId: params.userId,
          jti: params.jti,
          refreshTokenHash: params.refreshTokenHash,
          familyId: params.familyId,
          expiresAt: params.expiresAt,
          provider: params.provider || 'local',
          providerUserId: params.providerUserId,
          avatarUrl: params.providerAvatarUrl,
        },
      });

      // Link the chain after the fact. The predecessor is already latched `usedAt` by
      // claimRefreshSession; this only records what it turned into.
      if (params.replacesJti) {
        await tx.session.updateMany({
          where: { jti: params.replacesJti },
          data: { replacedByJti: params.jti },
        });
      }

      await tx.users.update({
        where: { id: params.userId },
        data: { activeSessionId: session.id },
      });

      return session;
    });
  }

  static async updateActiveSession(userId: string, sessionId: string | null) {
    return prisma.users.update({
      where: { id: userId },
      data: { activeSessionId: sessionId },
    });
  }

  static async updateUser(userId: string, data: Prisma.UsersUncheckedUpdateInput) {
    return prisma.users.update({
      where: { id: userId },
      data: data,
    });
  }
}
