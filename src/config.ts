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
