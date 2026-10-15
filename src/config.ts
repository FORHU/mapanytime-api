import dotenv from 'dotenv';
dotenv.config();

export const PORT = process.env.PORT || 3002;
export const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * Signs Better Auth's session tokens and the payment-return links (#122).
 * Required in production — a default would let anyone who reads the source
 * forge sessions — so a production process without it refuses to start
 * (modules/auth/auth-secret.ts). Development and tests fall back to a fixed,
 * obviously-not-secret value.
 *
 * Replaces the JWT `ACCESS_TOKEN_SECRET` / `REFRESH_TOKEN_SECRET` and their
 * expiry settings, removed with JWT.
 */
export const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || '';

/**
 * Better Auth's base URL (its standard `BETTER_AUTH_URL`), when it must differ from
 * `MAPANYTIME_API_PUBLIC_URL` — in local development, where that one stays unset
 * because Xendit refuses a localhost return URL. Production leaves this unset and
 * uses `MAPANYTIME_API_PUBLIC_URL` for both (better-auth.ts).
 */
export const BETTER_AUTH_URL = process.env.BETTER_AUTH_URL || '';
/**
 * A positive whole number from the environment, or `fallback` when unset.
 *
 * Throws on anything else rather than resolving to `NaN` — these feed rate
 * limits, and a typo in a limit must stop the process at startup, not quietly
 * weaken or disable the protection.
 */
export function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new Error(`Invalid ${name} "${raw}". Expected a positive whole number.`);
  }
  return Number(raw);
}

/**
 * Rate limits. Windows are 15 minutes unless named otherwise; all but the reset-email
 * limit are per client IP. See middleware/rate-limit.middleware.ts for how they combine.
 */
export const GLOBAL_RATE_LIMIT_MAX = positiveIntEnv('GLOBAL_RATE_LIMIT_MAX', 1000);
/** Every request to a credential route, successful or not. */
export const CREDENTIAL_RATE_LIMIT_MAX = positiveIntEnv('CREDENTIAL_RATE_LIMIT_MAX', 100);
/** Failed requests to a credential route — the password-guessing brake. */
export const CREDENTIAL_FAILURE_LIMIT_MAX = positiveIntEnv('CREDENTIAL_FAILURE_LIMIT_MAX', 20);
/** Forgot-password requests per email address, whether or not an account exists. */
export const PASSWORD_RESET_EMAIL_LIMIT_MAX = positiveIntEnv('PASSWORD_RESET_EMAIL_LIMIT_MAX', 5);
export const PASSWORD_RESET_EMAIL_LIMIT_WINDOW_MINUTES = positiveIntEnv(
  'PASSWORD_RESET_EMAIL_LIMIT_WINDOW_MINUTES',
  60,
);

export const DATABASE_URL = process.env.DATABASE_URL;

export const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
export const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
export const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
export const REDIS_TTL_SECONDS = parseInt(process.env.REDIS_TTL_SECONDS || '3600');
export const REDIS_TLS = process.env.REDIS_TLS === 'true';
export const WORKER_HEALTH_PORT = parseInt(process.env.WORKER_HEALTH_PORT || '8080');

/**
 * The async event bus (#127): an SNS topic fanned out to one SQS queue per
 * consumer. Locally these point at LocalStack (see .env.example); deployed,
 * they come from the environment's variables. No defaults on purpose: a queue
 * URL that silently pointed somewhere else would let two environments steal
 * each other's messages.
 */
export const EVENTS_TOPIC_ARN = process.env.EVENTS_TOPIC_ARN || '';
export const EMAIL_SEND_QUEUE_URL = process.env.EMAIL_SEND_QUEUE_URL || '';
export const ANALYTICS_EVENTS_QUEUE_URL = process.env.ANALYTICS_EVENTS_QUEUE_URL || '';

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
