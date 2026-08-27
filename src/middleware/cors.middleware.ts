import cors from 'cors';
import logger from '../utils/logger';

/**
 * One CORS allowlist, shared by the HTTP app and the socket gateway (F14, F22).
 *
 * Reflecting every origin while `credentials: true` is set lets any site make
 * authenticated calls on a signed-in user's behalf. Both surfaces were fixed
 * separately and each parsed `CORS_ORIGIN` for itself; they now share this
 * module, so they cannot drift apart the way F73's two return-URL checks did.
 *
 * The allowlist is left open when `CORS_ORIGIN` is unset, because local dev and
 * the Flutter client send no usable `Origin` header — but see `assertConfigured`:
 * shipping to production without it is a deploy mistake, not a supported mode.
 */

/** A browser `Origin` is always bare: scheme, host, optional port. No path. */
export const ORIGIN_SHAPE = /^https?:\/\/[^/]+$/;

/**
 * Splits `CORS_ORIGIN` into origins.
 *
 * Matching is exact string equality, so `https://example.com/` in the env var
 * matches nothing a browser will ever send. The trailing slash is stripped
 * rather than rejected because its intent is unambiguous — it is the single
 * most common way to write this value wrong. Anything else malformed survives
 * parsing and is reported by `logConfiguration`, because guessing at it would
 * hide the mistake instead of naming it (F95).
 */
export function parseAllowedOrigins(raw: string | undefined = process.env.CORS_ORIGIN): string[] {
  return (raw ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * An empty allowlist accepts everything (development). A request with no
 * `Origin` header — curl, Postman, the Flutter app, server-to-server — is not a
 * browser cross-origin request and is never subject to the allowlist.
 */
export function isOriginAllowed(origin: string | undefined, allowed: string[]): boolean {
  return allowed.length === 0 || !origin || allowed.includes(origin);
}

export const allowedOrigins = parseAllowedOrigins();

/** Refuses to boot a production process that would reflect every origin. */
export function assertConfigured(nodeEnv = process.env.NODE_ENV): void {
  if (nodeEnv === 'production' && allowedOrigins.length === 0) {
    throw new Error(
      'CORS_ORIGIN must be set in production. Starting without it would reflect every ' +
        'origin with credentials enabled, letting any site call this API as a signed-in user.',
    );
  }
}

/**
 * Says what the allowlist actually is at boot.
 *
 * `assertConfigured` proves only that `CORS_ORIGIN` is non-empty, never that it
 * names the real front end — which is exactly how F94 stayed live in production
 * for a week: the API booted clean while rejecting every browser that called it.
 * A wrong value is indistinguishable from a right one until someone loads the
 * site, unless the process says which origins it will accept.
 */
export function logConfiguration(): void {
  const malformed = allowedOrigins.filter((origin) => !ORIGIN_SHAPE.test(origin));
  if (malformed.length > 0) {
    logger.warn(
      `CORS_ORIGIN contains entries that cannot match a browser Origin header: ` +
        `${malformed.join(', ')}. Expected bare origins, e.g. https://example.com`,
    );
  }

  logger.info(
    allowedOrigins.length === 0
      ? 'CORS: no allowlist configured, every origin is accepted (development only)'
      : `CORS allowlist: ${allowedOrigins.join(', ')}`,
  );
}

/**
 * Rejects with a 403 rather than letting the error handler default to 500.
 *
 * A rejected origin is a configuration fact, not a server fault, and logging
 * the value is what turns "the site is down" into a one-line diagnosis. Under
 * F94 every failure logged as `500 - Internal Server Error`, which reads as a
 * crash and named neither the origin nor the allowlist it was checked against.
 */
export function rejectOrigin(origin: string): Error & { status: number } {
  logger.warn(
    `CORS rejected origin ${origin} — allowlist: ${allowedOrigins.join(', ') || '(open)'}`,
  );
  return Object.assign(new Error(`Origin not allowed by CORS: ${origin}`), { status: 403 });
}

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    if (isOriginAllowed(origin, allowedOrigins)) {
      return callback(null, true);
    }
    return callback(rejectOrigin(origin as string));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
});
