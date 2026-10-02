/**
 * Every endpoint that accepts or issues a credential, not just the two obvious
 * ones. `/reset-password` is the sharp omission: it checks a one-time code, and
 * the global bucket gave a guesser a thousand tries per window. See F104.
 * `/facebook` and `/google` issue sessions too; left in the global bucket, an
 * anonymous map session on the same address could 429 social sign-in.
 */
export const CREDENTIAL_PATHS = [
  'login',
  'register',
  'refresh-token',
  'forgot-password',
  'reset-password',
  'facebook',
  'google',
].map((path) => `/api/v1/auth/${path}`);

export const FORGOT_PASSWORD_PATH = '/api/v1/auth/forgot-password';

/**
 * Whether `path` is under one of [CREDENTIAL_PATHS], matched the way `app.use`
 * mounts them (the path itself or anything below it). Case-sensitive, unlike
 * Express routing, so it can only ever match a subset of what the credential
 * limiter covers — nothing skips both limiters.
 */
export function isCredentialPath(path: string): boolean {
  return CREDENTIAL_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * The per-address rate-limit key for a forgot-password body: the email, trimmed
 * and lowercased the way `AuthRepo.findUserByEmail` matches it, so spelling
 * variants of one address share one budget. Undefined when there is no usable
 * email — validation rejects that request anyway.
 */
export function resetEmailKey(body: unknown): string | undefined {
  const email = (body as { email?: unknown } | null | undefined)?.email;
  if (typeof email !== 'string') return undefined;
  return email.trim().toLowerCase() || undefined;
}
