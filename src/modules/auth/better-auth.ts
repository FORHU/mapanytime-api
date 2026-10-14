import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { createAuthMiddleware } from 'better-auth/api';
import { bearer } from 'better-auth/plugins';
import { BETTER_AUTH_SECRET, MAPANYTIME_API_PUBLIC_URL, NODE_ENV } from '../../config';
import { prisma } from '../../utils/prisma';
import logger from '../../utils/logger';
import { hashPassword, isLegacyHash, verifyPassword } from './password-hash';

if (NODE_ENV === 'production' && !BETTER_AUTH_SECRET) {
  throw new Error('[config] BETTER_AUTH_SECRET is required in production (#122)');
}

/**
 * Better Auth (#122) — replacing the hand-rolled JWT access/refresh tokens.
 * Not mounted yet: routes and middleware still run on the old auth while the
 * migration lands in steps.
 *
 * Tables: `user` is the existing `Users` model; session, account and
 * verification are the new `AuthSession` / `AuthAccount` / `AuthVerification`
 * (see schema.prisma). Ids come from Prisma's `@default(cuid())`, like every
 * other table.
 */
export const auth = betterAuth({
  secret: BETTER_AUTH_SECRET || 'dev-only-better-auth-secret-not-for-production',
  baseURL: MAPANYTIME_API_PUBLIC_URL || undefined,
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  advanced: { database: { generateId: false } },

  user: {
    modelName: 'users',
    fields: { emailVerified: 'isEmailVerified' },
  },
  session: { modelName: 'authSession' },
  account: { modelName: 'authAccount' },
  verification: { modelName: 'authVerification' },

  emailAndPassword: {
    enabled: true,
    // Legacy PBKDF2 hashes keep working; new ones are prefixed scrypt (F114).
    password: { hash: hashPassword, verify: verifyPassword },
  },

  plugins: [bearer()],

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
