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
 * Bridge until the providers import the constant above. `PayMongoProvider` and
 * `XenditProvider` both read `process.env.FRONTEND_URL` directly, so writing
 * the resolved value back is what lets the new name reach them without editing
 * two files that are mid-merge. Remove this once they take the value from
 * config instead of the environment.
 */
if (MAPANYTIME_WEB_APP_URL) {
  process.env.FRONTEND_URL = MAPANYTIME_WEB_APP_URL;
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
  const problems: string[] = [];

  if (!MAPANYTIME_WEB_APP_URL) {
    problems.push('it is not set');
  } else {
    let parsed: URL | undefined;
    try {
      parsed = new URL(MAPANYTIME_WEB_APP_URL);
    } catch {
      problems.push(`"${MAPANYTIME_WEB_APP_URL}" is not a valid URL`);
    }

    if (parsed) {
      if (parsed.protocol !== 'https:') problems.push('the scheme must be https');
      if (parsed.port) problems.push(`it must not carry a port (found :${parsed.port})`);
      if (parsed.hostname === 'localhost') problems.push('the hostname "localhost" is rejected');
    }
  }

  if (problems.length === 0) return;

  const message =
    `[config] MAPANYTIME_WEB_APP_URL is unusable as a checkout return URL — ` +
    `${problems.join('; ')}. Xendit will reject every payment session with 400 INVALID_URL. ` +
    'Use an https origin with no port, e.g. https://<your-tailscale-ipv4> for local device ' +
    'testing. (The legacy name FRONTEND_URL is still read if the new one is unset.)';

  if (NODE_ENV === 'production') throw new Error(message);
  console.warn(message);
}
