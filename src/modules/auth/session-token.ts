import crypto from 'crypto';
import { AUTH_SECRET } from './auth-secret';

/**
 * The bearer token clients hold (#122): a Better Auth session token plus an
 * HMAC of it, `<token>.<signature>` — exactly the signed session-cookie value
 * Better Auth verifies (better-call's `serializeSignedCookie`), which its
 * `bearer` plugin turns a bearer token back into. The signature is HMAC-SHA256
 * with the auth secret in **standard, padded base64** (44 chars, may contain
 * `+ / =`). Not base64url: a base64url signature passes the bearer plugin's own
 * check but fails the cookie layer behind it, so getSession answers null — the
 * end-to-end check against a real database is what caught that.
 *
 * The signature is what lets callers outside a request check a token without a
 * database read: the rate limiter keys on it, and a forged token falls back to
 * the address bucket, the same way an unverifiable JWT did before.
 */
function sign(value: string): string {
  return crypto.createHmac('sha256', AUTH_SECRET).update(value).digest('base64');
}

export function signSessionToken(sessionToken: string): string {
  return `${sessionToken}.${sign(sessionToken)}`;
}

/** The raw session token if the signature is genuine, else null. Never touches the database. */
export function verifySessionToken(bearerToken: string): string | null {
  const dot = bearerToken.lastIndexOf('.');
  if (dot <= 0 || dot === bearerToken.length - 1) return null;
  const sessionToken = bearerToken.slice(0, dot);
  const given = Buffer.from(bearerToken.slice(dot + 1));
  const expected = Buffer.from(sign(sessionToken));
  return given.length === expected.length && crypto.timingSafeEqual(given, expected)
    ? sessionToken
    : null;
}

/** The token from an `Authorization: Bearer <token>` header, if any. */
export function bearerFrom(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const [scheme, token] = authorization.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}
