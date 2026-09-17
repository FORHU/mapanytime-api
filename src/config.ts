import dotenv from 'dotenv';
dotenv.config();

export const PORT = process.env.PORT || 3002;
export const NODE_ENV = process.env.NODE_ENV || 'development';

export const ACCESS_TOKEN_SECRET =
  process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET || 'access-secret';
export const REFRESH_TOKEN_SECRET =
  process.env.REFRESH_TOKEN_SECRET || process.env.JWT_REFRESH_SECRET || 'refresh-secret';
/**
 * Access tokens are meant to be short-lived; this default used to be `7d`.
 *
 * Nothing depended on the long life — `activeSessionId` is what actually revokes
 * a token, and it revokes immediately regardless of `exp`. What seven days bought
 * was blast radius: a token lifted out of `sessionStorage` stayed usable for a
 * week unless the victim happened to log out. See OPEN-FLAGS.md F98.
 *
 * Both clients refresh transparently on 401 and queue concurrent requests while
 * they do (`web/src/shared/lib/http.ts`, Flutter's `AuthInterceptor`), so a short
 * expiry costs a silent round-trip rather than a visible sign-out.
 */
export const ACCESS_TOKEN_EXPIRY =
  process.env.ACCESS_TOKEN_EXPIRY || process.env.JWT_EXPIRY || '15m';
export const REFRESH_TOKEN_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || '30d';

/**
 * The refresh lifetime again, in milliseconds, for the session row's `expiresAt`.
 *
 * These two must agree. They did not: the JWT was signed for `REFRESH_TOKEN_EXPIRY`
 * while the row it is validated against was hardcoded to seven days, so on day
 * eight a signature-valid token failed with a bare "Invalid token" (F99). The
 * duration is now written once and derived here.
 */
export const REFRESH_TOKEN_EXPIRY_MS = parseDuration(REFRESH_TOKEN_EXPIRY);

/**
 * Parses the `ms`-style duration strings `jsonwebtoken` accepts (`'30d'`, `'15m'`,
 * `'900s'`, or a bare number of seconds) into milliseconds.
 *
 * `ms` itself is a transitive dependency of `jsonwebtoken`, not a direct one, so
 * it is not ours to import — this covers the spellings this config actually uses
 * and refuses anything else loudly rather than silently resolving to `NaN`, which
 * would put `Invalid Date` in `expiresAt` and fail every refresh.
 */
function parseDuration(value: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w|y)?$/i.exec(value.trim());
  if (!match) {
    throw new Error(
      `Invalid token expiry "${value}". Expected a number of seconds or an ms-style duration such as "15m", "7d".`,
    );
  }

  const amount = parseFloat(match[1]);
  const unit = (match[2] || 's').toLowerCase();
  const perUnit: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000,
  };

  return amount * perUnit[unit];
}

/**
 * How long a just-rotated refresh token still answers without being treated as
 * theft. See OPEN-FLAGS.md F103 and §14 of the auth architecture note.
 *
 * Deliberately small. Both clients serialise their refreshes, so this covers the
 * genuine races they cannot — a retry landing after the response was lost, two
 * tabs waking together — and nothing else. Set it to 0 to disable the grace and
 * treat every reuse as compromise.
 */
export const REFRESH_TOKEN_GRACE_MS = parseInt(process.env.REFRESH_TOKEN_GRACE_MS || '10000');

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
export const AWS_S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || process.env.S3_BUCKET || '';
export const S3_CDN_URL = process.env.S3_CDN_URL || '';

/**
 * Facebook Login. Both empty by default so `AuthSvc.facebookLogin` can fail
 * closed with a 501 — same shape as the disabled `googleLogin` — instead of
 * calling the Graph API with an empty app id/secret.
 */
export const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || '';
export const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || '';

/**
 * Google Sign-In. Only a client ID — ID token verification is a signature
 * check against Google's public keys, not an OAuth code exchange, so there is
 * no client secret to hold. Empty by default so `AuthSvc.googleLogin` fails
 * closed with a 501 instead of verifying against an empty audience.
 */
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

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
 * This API's own public origin, as reachable from outside the network.
 *
 * The post-payment return page is served by this service, not by the web app
 * (`GET /v1/payments/xendit/return`), so the return URL Xendit sends the buyer's
 * browser to is built from this rather than from `MAPANYTIME_WEB_APP_URL`. That
 * matters because the web dev server is on a port Xendit will not accept.
 *
 * This is the deployed API origin, `https://mapanytime.com`. Xendit is tested
 * against the live site: the return page and the webhook
 * (`/api/v1/payments/webhook/xendit`) are both served there. Leave it unset
 * locally — a local checkout still opens a Xendit session, but the webhook goes
 * to the live site, so a local order never completes.
 */
export const MAPANYTIME_API_PUBLIC_URL = process.env.MAPANYTIME_API_PUBLIC_URL || '';

/**
 * Origin for links a recipient clicks out of an email.
 *
 * Deliberately separate from `MAPANYTIME_WEB_APP_URL`. That one is constrained by
 * Xendit, which rejects a return URL that is http, carries a port, or resolves to
 * localhost — so in local development it has to be set to an origin a browser on
 * the developer's machine generally cannot reach, and a setup link built from it
 * goes nowhere. An emailed link is under no such constraint and has every reason
 * to be clickable.
 *
 * Falls back to the Xendit origin when unset, which is the right answer in
 * production where both are the same public https host.
 */
export const MAPANYTIME_WEB_APP_EMAIL_URL =
  process.env.MAPANYTIME_WEB_APP_EMAIL_URL || MAPANYTIME_WEB_APP_URL || 'http://localhost:4000';

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
  const { url } = checkoutReturnUrlCandidate();
  return checkoutReturnUrlProblems(url).length === 0 ? url : 'https://example.com';
}

/**
 * Which origin the return URL is built from, and under which name to blame it.
 *
 * `MAPANYTIME_API_PUBLIC_URL` wins because the return page is served by this
 * service. `MAPANYTIME_WEB_APP_URL` remains the fallback so an environment that
 * only ever set that one keeps working. Deliberately no fallback *past* a set
 * `MAPANYTIME_API_PUBLIC_URL`: if it is set but malformed, that is the value to
 * report, not one silently swapped behind the operator's back.
 */
export function checkoutReturnUrlCandidate(): { url: string; source: string } {
  return MAPANYTIME_API_PUBLIC_URL
    ? { url: MAPANYTIME_API_PUBLIC_URL, source: 'MAPANYTIME_API_PUBLIC_URL' }
    : { url: MAPANYTIME_WEB_APP_URL, source: 'MAPANYTIME_WEB_APP_URL' };
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
  const { url, source } = checkoutReturnUrlCandidate();
  const problems = checkoutReturnUrlProblems(url);
  if (problems.length === 0) return;

  const message =
    `[config] ${source} is unusable as a checkout return URL — ` +
    `${problems.join('; ')}. Xendit rejects such a session with 400 INVALID_URL, so ` +
    'checkout will fall back to https://example.com and the buyer will land there after ' +
    'paying. Use an https origin with no port — set MAPANYTIME_API_PUBLIC_URL to the ' +
    'deployed API origin, e.g. https://mapanytime.com; Xendit is tested against the live ' +
    'site, not locally. (For MAPANYTIME_WEB_APP_URL the legacy name FRONTEND_URL is ' +
    'still read if the new one is unset.)';

  if (NODE_ENV === 'production') throw new Error(message);
  console.warn(message);
}
