import crypto from 'crypto';
import { AUTH_SECRET } from './auth-secret';

/**
 * The bearer token clients hold (#122): a Better Auth session token plus an
 * HMAC of it, `<token>.<signature>` — exactly the signed-cookie value Better
 * Auth's `bearer` plugin accepts when `requireSignature` is on. The signature
 * is HMAC-SHA256 with the auth secret, unpadded base64url — byte-for-byte what
 * Better Auth's own `createHMAC('SHA-256', 'base64urlnopad')` produces.
 *
 * The signature is what lets callers outside a request check a token without a
 * database read: the rate limiter keys on it, and a forged token falls back to
 * the address bucket, the same way an unverifiable JWT did before.
 */
function sign(value: string): string {
  return crypto.createHmac('sha256', AUTH_SECRET).update(value).digest('base64url');
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
