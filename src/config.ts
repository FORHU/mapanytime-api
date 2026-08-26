import dotenv from 'dotenv';
dotenv.config();

export const PORT = process.env.PORT || 3002;
export const NODE_ENV = process.env.NODE_ENV || 'development';

export const ACCESS_TOKEN_SECRET =
  process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET || 'access-secret';
export const REFRESH_TOKEN_SECRET =
  process.env.REFRESH_TOKEN_SECRET || process.env.JWT_REFRESH_SECRET || 'refresh-secret';
export const ACCESS_TOKEN_EXPIRY =
  process.env.ACCESS_TOKEN_EXPIRY || process.env.JWT_EXPIRY || '7d';
export const REFRESH_TOKEN_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || '30d';

export const DATABASE_URL = process.env.DATABASE_URL;

export const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
export const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
export const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
export const REDIS_TTL_SECONDS = parseInt(process.env.REDIS_TTL_SECONDS || '3600');
export const REDIS_TLS = process.env.REDIS_TLS === 'true';
export const WORKER_HEALTH_PORT = parseInt(process.env.WORKER_HEALTH_PORT || '8080');

export const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

/**
 * Mail transport.
 *
 * Both `MAILER_*` and `SMTP_*` spellings are written by the deploy workflows
 * and both appear in `.env.example`, but only `SMTP_*` was ever read — so every
 * `MAILER_*` value CI carefully plumbed through went nowhere. Each name now
 * falls back to the other, so whichever half an environment sets is the half
 * that works.
 */
export const MAILER_TRANSPORT_HOST =
  process.env.MAILER_TRANSPORT_HOST || process.env.SMTP_HOST || 'smtp.ethereal.email';
export const MAILER_TRANSPORT_PORT = parseInt(
  process.env.MAILER_TRANSPORT_PORT || process.env.SMTP_PORT || '587',
);
/** Implicit TLS. True for 465 unless explicitly overridden. */
export const MAILER_TRANSPORT_SECURE = process.env.MAILER_TRANSPORT_SECURE
  ? process.env.MAILER_TRANSPORT_SECURE === 'true'
  : MAILER_TRANSPORT_PORT === 465;
export const MAILER_EMAIL = process.env.MAILER_EMAIL || process.env.SMTP_USER || '';
export const MAILER_PASSWORD = process.env.MAILER_PASSWORD || process.env.SMTP_PASS || '';
/** Display name on the From header. */
export const MAILER_FROM_NAME = process.env.MAILER_FROM_NAME || 'MapAnytime';

// Retained under their original names — the email consumer and anything else
// importing these keeps working, and they now resolve identically.
export const SMTP_HOST = MAILER_TRANSPORT_HOST;
export const SMTP_PORT = MAILER_TRANSPORT_PORT;
export const SMTP_USER = MAILER_EMAIL;
export const SMTP_PASS = MAILER_PASSWORD;

export const AWS_REGION = process.env.AWS_REGION || 'ap-southeast-1';
export const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY || '';
export const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || '';
export const AWS_S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || process.env.S3_BUCKET || '';
export const S3_CDN_URL = process.env.S3_CDN_URL || '';

export const THIRD_PARTY_API_KEY = process.env.THIRD_PARTY_API_KEY || '';

export const isDev = NODE_ENV === 'development';

/**
 * Base URL of the buyer-facing web app. Both PayMongo and Xendit build their
 * success/cancel redirect URLs from it — it is the address the buyer's browser
 * is sent to after paying, not the API and not the mobile app.
 *
 * `FRONTEND_URL` is the older spelling, still accepted so an environment that
 * sets either one works — the same both-spellings treatment `MAILER_*` /
 * `SMTP_*` get above.
 */
export const MAPANYTIME_WEB_APP_URL =
  process.env.MAPANYTIME_WEB_APP_URL || process.env.FRONTEND_URL || '';

/**
 * The rules Xendit enforces on a checkout return URL, as one predicate.
 *
 * This exists so startup validation and the provider agree on what "valid"
 * means. They previously did not: the provider tested
 * `startsWith('https://')` alone, which passes `https://localhost:3000`
 * straight through to a 400 it cannot explain.
 *
 * Returns a list of human-readable problems, empty when the URL is usable.
 */
export function checkoutReturnUrlProblems(url: string): string[] {
  if (!url) return ['it is not set'];

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [`"${url}" is not a valid URL`];
  }

  const problems: string[] = [];
  if (parsed.protocol !== 'https:') problems.push('the scheme must be https');
  const port = explicitPortOf(url, parsed);
  if (port) problems.push(`it must not carry a port (found :${port})`);
  if (parsed.hostname === 'localhost') problems.push('the hostname "localhost" is rejected');
  return problems;
}

/**
 * The port as written, which is not the same as `URL.port`.
 *
 * `new URL()` normalises away a scheme's default port, so
 * `new URL('https://example.com:443').port` is the empty string. Xendit still
 * rejects that URL — it objects to the port being written at all, not to its
 * value — so reading `URL.port` alone silently passes the one case a reader is
 * most likely to try after being told "it must be https".
 */
function explicitPortOf(url: string, parsed: URL): string {
  if (parsed.port) return parsed.port;

  const schemeEnd = url.indexOf('://');
  if (schemeEnd === -1) return '';

  let authority = url.slice(schemeEnd + 3).split(/[/?#]/)[0];
  const at = authority.lastIndexOf('@');
  if (at !== -1) authority = authority.slice(at + 1);

  // A bracketed IPv6 literal is full of colons; only one after the closing
  // bracket can be a port.
  const from = authority.startsWith('[') ? authority.indexOf(']') : 0;
  const colon = authority.indexOf(':', from);
  if (colon === -1) return '';

  const match = /^:(\d+)$/.exec(authority.slice(colon));
  return match ? match[1] : '';
}

/**
 * A return-URL base Xendit is guaranteed to accept.
 *
 * Falls back to the RFC 2606 placeholder when the configured value fails any
 * rule, so local development is not blocked by a URL that only has to exist,
 * not resolve — the webhook confirms payment, this is merely where the browser
 * lands afterwards. `assertCheckoutReturnUrl` has already warned at startup if
 * this substitution is going to happen, so it is loud rather than silent.
 */
export function strictCheckoutReturnUrlBase(): string {
  return checkoutReturnUrlProblems(MAPANYTIME_WEB_APP_URL).length === 0
    ? MAPANYTIME_WEB_APP_URL
    : 'https://example.com';
}

/**
 * Xendit validates the return URL before it will create a payment session, and
 * rejects far more than "not HTTPS" — verified against the live sandbox on
 * 2026-08-25:
 *
 *   https://app.example.test      201    domain, no port
 *   https://127.0.0.1             201    bare IPv4 is fine
 *   https://localhost             400    the hostname itself is denied
 *   https://app.example.test:443  400    ANY explicit port, even the default
 *   http://app.example.test       400    scheme must be https
 *
 * Every rejection is the same opaque `400 INVALID_URL / "Please provide a
 * valid HTTPS URL"`, which names only the scheme and so sends you looking in
 * the wrong place when the real problem is a port.
 *
 * `.env.example` ships `FRONTEND_URL="http://localhost:3000"` — wrong on two
 * of the three counts — so configuring from it produces a checkout that fails
 * on every single Xendit order while looking perfectly sensible. This check
 * moves that failure to startup, where it is one line in the log, instead of
 * to the buyer pressing Pay.
 */
export function assertCheckoutReturnUrl(): void {
  const problems = checkoutReturnUrlProblems(MAPANYTIME_WEB_APP_URL);
  if (problems.length === 0) return;

  const message =
    `[config] MAPANYTIME_WEB_APP_URL is unusable as a checkout return URL — ` +
    `${problems.join('; ')}. Xendit rejects such a session with 400 INVALID_URL, so ` +
    'checkout will fall back to https://example.com and the buyer will land there after ' +
    'paying. Use an https origin with no port, e.g. https://<your-tailscale-ipv4> for local ' +
    'device testing. (The legacy name FRONTEND_URL is still read if the new one is unset.)';

  if (NODE_ENV === 'production') throw new Error(message);
  console.warn(message);
}
