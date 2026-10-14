import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { bearer } from 'better-auth/plugins';
import { MAPANYTIME_API_PUBLIC_URL } from '../../config';
import { prisma } from '../../utils/prisma';
import logger from '../../utils/logger';
import CacheUtil from '../../utils/cache.util';
import { AUTH_SECRET } from './auth-secret';
import { hashPassword, isLegacyHash, verifyPassword } from './password-hash';

const DAY_SECONDS = 60 * 60 * 24;

/** The one message for a blocked account — the web client keys its handling off it. */
export const ACCOUNT_BLOCKED_MESSAGE = 'User not found or deactivated';

/**
 * Better Auth (#122), replacing the hand-rolled JWT access/refresh tokens.
 *
 * Used server-side only, through `auth.api` and the internal adapter: the
 * `/api/v1/auth/*` endpoints keep their contract (validation, valid-ID upload,
 * seller/buyer provisioning) and call into it. Better Auth's own HTTP routes
 * are deliberately NOT mounted — they would offer a sign-up that skips all of
 * that.
 *
 * Tables: `user` is the existing `Users` model; session, account and
 * verification are `AuthSession` / `AuthAccount` / `AuthVerification` (see
 * schema.prisma). Ids come from Prisma's `@default(cuid())`.
 */
export const auth = betterAuth({
  secret: AUTH_SECRET,
  baseURL: MAPANYTIME_API_PUBLIC_URL || 'http://localhost:4002',
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  advanced: { database: { generateId: false } },

  user: {
    modelName: 'users',
    fields: { emailVerified: 'isEmailVerified' },
  },
  // 30 days, sliding: each day of use pushes expiry out again. Matches the old
  // 30-day refresh token, without a refresh round-trip.
  session: {
    modelName: 'authSession',
    expiresIn: 30 * DAY_SECONDS,
    updateAge: DAY_SECONDS,
  },
  account: { modelName: 'authAccount' },
  verification: { modelName: 'authVerification' },

  emailAndPassword: {
    enabled: true,
    // Legacy PBKDF2 hashes keep working; new ones are prefixed scrypt (F114).
    password: { hash: hashPassword, verify: verifyPassword },
  },

  // Clients send `Authorization: Bearer <token>.<signature>` (session-token.ts).
  // Unsigned tokens are refused, so a token can always be checked offline.
  plugins: [bearer({ requireSignature: true })],

  databaseHooks: {
    session: {
      create: {
        /**
         * No session for an account that may not sign in. This runs for every
         * way a session is made — password, Google, Facebook — so no path can
         * forget the check.
         */
        before: async (session) => {
          const user = await prisma.users.findUnique({
            where: { id: session.userId },
            select: { accountStatus: true },
          });
          if (user?.accountStatus !== 'ACTIVE') {
            logger.warn(`[Auth] Session refused for blocked account (user ${session.userId})`);
            throw new APIError('UNAUTHORIZED', { message: ACCOUNT_BLOCKED_MESSAGE });
          }
          return { data: session };
        },
        /**
         * Single active device: signing in ends every other session the user
         * has. Same rule the JWT flow enforced through `activeSessionId`.
         */
        after: async (session) => {
          const { count } = await prisma.authSession.deleteMany({
            where: { userId: session.userId, id: { not: session.id } },
          });
          await CacheUtil.del(`user:${session.userId}`);
          if (count > 0) {
            logger.info(`[Auth] Signed out ${count} other session(s) for user ${session.userId}`);
          }
        },
      },
    },
  },

  hooks: {
    /**
     * Re-hash a legacy PBKDF2 password the moment its owner proves they know it.
     * The plaintext only exists during sign-in, so this is the one chance to
     * upgrade without a forced reset. Best effort: a failure leaves the legacy
     * hash in place, which still works, and is retried on the next sign-in.
     */
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-in/email') return;
      const userId = ctx.context.newSession?.user.id;
      const password = (ctx.body as { password?: unknown } | undefined)?.password;
      if (!userId || typeof password !== 'string') return;

      try {
        const account = await prisma.authAccount.findFirst({
          where: { userId, providerId: 'credential' },
          select: { id: true, password: true },
        });
        if (!account?.password || !isLegacyHash(account.password)) return;
        await prisma.authAccount.update({
          where: { id: account.id },
          data: { password: await hashPassword(password) },
        });
        logger.info(`[Auth] Upgraded legacy password hash to scrypt (user ${userId})`);
      } catch (err) {
        logger.error(`[Auth] Password re-hash failed (user ${userId})`, {
          error: (err as Error).message,
        });
      }
    }),
  },
});
