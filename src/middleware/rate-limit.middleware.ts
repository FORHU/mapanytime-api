import type { Express, Request } from 'express';
import rateLimit, {
  ipKeyGenerator,
  RateLimitExceededEventHandler,
  RateLimitRequestHandler,
} from 'express-rate-limit';
import {
  CREDENTIAL_FAILURE_LIMIT_MAX,
  CREDENTIAL_RATE_LIMIT_MAX,
  GLOBAL_RATE_LIMIT_MAX,
  PASSWORD_RESET_EMAIL_LIMIT_MAX,
  PASSWORD_RESET_EMAIL_LIMIT_WINDOW_MINUTES,
} from '../config';
import { clientIp } from '../utils/client-ip.util';
import {
  CREDENTIAL_PATHS,
  FORGOT_PASSWORD_PATH,
  isCredentialPath,
  resetEmailKey,
} from '../utils/credential-paths.util';
import logger from '../utils/logger';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export interface RateLimits {
  global: number;
  credential: number;
  credentialFailures: number;
  resetEmail: number;
  resetEmailWindowMinutes: number;
}

const configuredLimits: RateLimits = {
  global: GLOBAL_RATE_LIMIT_MAX,
  credential: CREDENTIAL_RATE_LIMIT_MAX,
  credentialFailures: CREDENTIAL_FAILURE_LIMIT_MAX,
  resetEmail: PASSWORD_RESET_EMAIL_LIMIT_MAX,
  resetEmailWindowMinutes: PASSWORD_RESET_EMAIL_LIMIT_WINDOW_MINUTES,
};

// Keyed on the real visitor, not the Cloudflare edge in front of us; see client-ip.util.ts.
// ipKeyGenerator groups IPv6 addresses by subnet so one host can't rotate through its /64.
const ipKey = (req: Request) => ipKeyGenerator(clientIp(req) ?? '');

const skipPreflight = (req: Request) => req.method === 'OPTIONS';

/**
 * The library's default response, plus one log line per blocked request. The stores are in
 * memory, so without this there is no record of whose traffic filled a bucket.
 */
const logBlocked =
  (name: string, keyOf: (req: Request) => string | undefined): RateLimitExceededEventHandler =>
  (req, res, _next, options) => {
    logger.warn(
      `[RateLimit] ${name} blocked ${req.method} ${req.originalUrl} ip=${ipKey(req)} key=${keyOf(req)}`,
    );
    res.status(options.statusCode).json(options.message);
  };

export interface RateLimiters {
  global: RateLimitRequestHandler;
  credential: RateLimitRequestHandler;
  credentialFailures: RateLimitRequestHandler;
  resetEmail: RateLimitRequestHandler;
}

/**
 * Every store here is express-rate-limit's in-memory one: it can't become unavailable, so
 * no limiter can quietly stop counting. The cost is that counts are per process and reset on
 * deploy — fine for one API container; a shared store is needed before running several.
 */
export function createRateLimiters(limits: RateLimits = configuredLimits): RateLimiters {
  /**
   * Global throttle — a blunt guard against abuse, not a per-feature budget.
   *
   * The previous 100-per-15-minutes worked out to under 7 requests a minute for an entire IP,
   * which a single authenticated dashboard session burns through in a couple of minutes. Two
   * things made it bite harder than the number suggests:
   *   - CORS preflights counted. Every cross-origin call carrying Authorization triggers an
   *     OPTIONS first, so the real budget was roughly half the stated one. They're skipped now.
   *   - Shared egress IPs (office NAT, mobile carriers) pool their users into one budget.
   *
   * That pooling is also why credential routes are skipped: on mobile data carriers put many
   * subscribers behind one CGNAT IPv4, and ipKeyGenerator pools IPv6 by /56, so other traffic
   * on a shared IP would otherwise lock someone out of logging in. Credential routes have
   * their own limiters below.
   */
  const global = rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    limit: limits.global,
    standardHeaders: true, // expose RateLimit-* so clients can back off before being cut off
    legacyHeaders: false,
    skip: (req) => skipPreflight(req) || isCredentialPath(req.path),
    keyGenerator: ipKey,
    handler: logBlocked('global', ipKey),
    // JSON, not the library's plain-text default — the web client parses every error body as
    // JSON and a text body surfaced to users as a generic "Request failed".
    message: { status: 429, message: 'Too many requests. Please slow down and try again shortly.' },
  });

  /**
   * Every credential request counts, successful or not. The failure-only limiter below cannot
   * stand alone: forgot-password answers 200 whether or not the account exists, so it never
   * fails, and successful logins and registrations would go unthrottled.
   */
  const credential = rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    limit: limits.credential,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipPreflight,
    keyGenerator: ipKey,
    handler: logBlocked('credential', ipKey),
    message: { status: 429, message: 'Too many attempts. Please try again in a few minutes.' },
  });

  /**
   * Login is the one route where a high failure rate is itself the attack, so failures get a
   * much tighter budget of their own. `skipSuccessfulRequests` is what makes throttling
   * `/refresh-token` safe here — a client refreshing normally never touches it, while one
   * replaying a dead token burns it.
   */
  const credentialFailures = rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    limit: limits.credentialFailures,
    // Off so these don't overwrite `credential`'s headers on the same response.
    standardHeaders: false,
    legacyHeaders: false,
    skip: skipPreflight,
    keyGenerator: ipKey,
    handler: logBlocked('credential-failures', ipKey),
    skipSuccessfulRequests: true,
    message: { status: 429, message: 'Too many attempts. Please try again in a few minutes.' },
  });

  /**
   * Caps reset emails to one address however many IPs ask. It counts before any account
   * lookup, identically for addresses with and without an account, and its 429 is the same
   * for every address — so it reveals nothing the generic 200 doesn't.
   */
  const resetEmail = rateLimit({
    windowMs: limits.resetEmailWindowMinutes * 60 * 1000,
    limit: limits.resetEmail,
    standardHeaders: false,
    legacyHeaders: false,
    // No usable email: validation answers 400, and the IP limiters have already counted it.
    skip: (req) => skipPreflight(req) || resetEmailKey(req.body) === undefined,
    keyGenerator: (req) => resetEmailKey(req.body) ?? '',
    handler: logBlocked('reset-email', (req) => resetEmailKey(req.body)),
    message: {
      status: 429,
      message: 'Too many reset requests for this address. Please try again later.',
    },
  });

  return { global, credential, credentialFailures, resetEmail };
}

/** Mounts the limiters. Must run after the body parsers — the reset-email key reads the body. */
export function applyRateLimits(app: Express, limiters: RateLimiters = createRateLimiters()) {
  for (const path of CREDENTIAL_PATHS) {
    app.use(path, limiters.credential, limiters.credentialFailures);
  }
  app.use(FORGOT_PASSWORD_PATH, limiters.resetEmail);
  app.use(limiters.global);
}
