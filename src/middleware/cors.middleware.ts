import cors from 'cors';
import logger from '../utils/logger';
import { MAPANYTIME_WEB_APP_URL, checkoutReturnUrlProblems } from '../config';

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

/**
 * The origin(s) of the buyer-facing web app, derived from the URL the API is
 * already configured to send buyers back to after paying.
 *
 * This exists because F94 was survivable only by luck: `CORS_ORIGIN` is a
 * deploy secret with no relationship to anything the code can check, so a wrong
 * value locked every browser out of a healthy API for a week. The web app URL
 * is different — `assertCheckoutReturnUrl` throws at boot in production when it
 * is missing or unusable, so a running production process is proof that this
 * value is a real https front-end origin. An origin the API already trusts
 * enough to hand a paying customer to is, by definition, its own front end.
 *
 * The `www` sibling is included because both hosts serve the same application
 * (F96) and a browser treats them as different origins. Only that exact prefix
 * is toggled — this is not a wildcard, and it never leaves the configured host.
 */
export function webAppOrigins(webAppUrl: string = MAPANYTIME_WEB_APP_URL): string[] {
  if (checkoutReturnUrlProblems(webAppUrl).length > 0) return [];

  const { protocol, host } = new URL(webAppUrl);
  const origin = `${protocol}//${host}`;
  const sibling = host.startsWith('www.')
    ? `${protocol}//${host.slice(4)}`
    : `${protocol}//www.${host}`;

  return [origin, sibling];
}

/**
 * The effective allowlist: what `CORS_ORIGIN` names, plus the app's own front
 * end. The secret still governs every *other* origin — partners, admin hosts,
 * staging front ends — and nothing here reflects an arbitrary origin. It only
 * guarantees that a correctly configured payment redirect and a working login
 * can never again disagree.
 */
export function buildAllowlist(
  raw: string | undefined = process.env.CORS_ORIGIN,
  webAppUrl: string = MAPANYTIME_WEB_APP_URL,
): string[] {
  const configured = parseAllowedOrigins(raw);
  if (configured.length === 0) return [];

  const derived = webAppOrigins(webAppUrl).filter((o) => !configured.includes(o));
  return [...configured, ...derived];
}

export const allowedOrigins = buildAllowlist();

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

  if (allowedOrigins.length === 0) {
    logger.info('CORS: no allowlist configured, every origin is accepted (development only)');
    return;
  }

  // Name the derived entries separately. They are the difference between a
  // wrong CORS_ORIGIN taking the site down and merely being wrong, so which
  // origins came from where is the first thing worth knowing in an incident.
  //
  // Attribution runs from the secret outwards, not from the derived set: an
  // origin both sources name belongs to CORS_ORIGIN, and counting it as derived
  // would report a correctly configured deploy as "0 from CORS_ORIGIN" — the
  // exact reading that would send the next incident looking in the wrong place.
  const fromSecret = parseAllowedOrigins();
  const derived = allowedOrigins.filter((o) => !fromSecret.includes(o));
  logger.info(`CORS allowlist: ${allowedOrigins.join(', ')}`);
  logger.info(
    `CORS sources: ${fromSecret.length} from CORS_ORIGIN, ` +
      `${derived.length} derived from MAPANYTIME_WEB_APP_URL`,
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
