import { BETTER_AUTH_SECRET, NODE_ENV } from '../../config';

if (NODE_ENV === 'production' && !BETTER_AUTH_SECRET) {
  throw new Error('[config] BETTER_AUTH_SECRET is required in production (#122)');
}

/**
 * The one secret Better Auth signs with, and that session-token.ts verifies
 * against. They must be the same value, so both read it from here.
 */
export const AUTH_SECRET = BETTER_AUTH_SECRET || 'dev-only-better-auth-secret-not-for-production';
