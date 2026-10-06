import type { Express, Request } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit, {
  ipKeyGenerator,
  RateLimitExceededEventHandler,
  RateLimitRequestHandler,
  Store,
} from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import RedisUtil from '../utils/redis.util';
import {
  ACCESS_TOKEN_SECRET,
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

/** The user a bearer token was signed for, or undefined if it doesn't verify. */
function bearerUserId(req: Request): string | undefined {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return undefined;
  try {
    const { userId } = jwt.verify(token, ACCESS_TOKEN_SECRET, { ignoreExpiration: true }) as {
      userId?: unknown;
    };
    return typeof userId === 'string' && userId ? userId : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Signed-in callers get a bucket of their own; everyone else shares one per address.
 *
 * The token is only signature-checked — no session or account lookup. A token from a
 * logged-out session still names a real user and `authenticate` 401s it afterwards,
 * while a forged one fails here and falls back to the address, so nobody can claim
 * another user's bucket or mint new ones. Expiry is ignored on purpose: access tokens
 * last 15 minutes, and keying an expired one on a full address bucket would answer 429
 * instead of the 401 that makes clients refresh — the lockout this key exists to end.
 *
 * Anonymous IPv6 is grouped by /64, not the library's /56: carriers hand each phone its
 * own /64, so a /56 on mobile data spans hundreds of subscribers.
 */
const globalKey = (req: Request) => {
  const userId = bearerUserId(req);
  return userId ? `user:${userId}` : `ip:${ipKeyGenerator(clientIp(req) ?? '', 64)}`;
};

const skipPreflight = (req: Request) => req.method === 'OPTIONS';

/**
 * The library's default response, plus one log line per blocked request with rich diagnostic metadata.
 */
const logBlocked =
  (name: string, keyOf: (req: Request) => string | undefined): RateLimitExceededEventHandler =>
  (req, res, _next, options) => {
    const correlationId = (req.headers['x-correlation-id'] ||
      req.headers['x-request-id'] ||
      '') as string;
    const userId = bearerUserId(req);
    const retryAfter = res.getHeader('Retry-After');
    logger.warn(
      `[RateLimit] ${name} blocked ${req.method} ${req.originalUrl} ` +
        `ip=${ipKey(req)} key=${keyOf(req)}` +
        (userId ? ` user=${userId}` : '') +
        (correlationId ? ` correlationId=${correlationId}` : '') +
        (retryAfter ? ` retryAfter=${retryAfter}` : ''),
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
 * Creates rate limiters backed by Redis (rate-limit-redis) when available,
 * falling back gracefully to express-rate-limit's in-memory store in dev or unit tests.
 */
export function createRateLimiters(
  limits: RateLimits = configuredLimits,
  customStore?: Store,
): RateLimiters {
  const isRedisHealthy = () => Boolean(customStore || RedisUtil.client?.isOpen);

  // In production, when Redis is unavailable, apply a restrictive local emergency limit
  // on security-sensitive auth endpoints and log a security alert.
  const emergencyAuthLimit = (normalLimit: number, emergencyCap = 5): number => {
    if (isRedisHealthy() || process.env.NODE_ENV === 'test') {
      return normalLimit;
    }
    logger.warn(
      `[RateLimit:EMERGENCY] Redis unavailable! Enforcing restrictive emergency auth limit (${Math.min(
        normalLimit,
        emergencyCap,
      )}) instead of ${normalLimit}.`,
    );
    return Math.min(normalLimit, emergencyCap);
  };

  const storeFor = (prefix: string): Store | undefined => {
    if (customStore) return customStore;
    if (RedisUtil.client?.isOpen) {
      return new RedisStore({
        sendCommand: (...args: string[]) =>
          RedisUtil.client.sendCommand(args) as Promise<
            boolean | number | string | (boolean | number | string)[]
          >,
        prefix: `rl:${prefix}:`,
      });
    }
    return undefined;
  };

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
   * On mobile data carriers put many subscribers behind one CGNAT IPv4, so keying on the
   * address let strangers' traffic fill a signed-in user's budget: login (skipped here) still
   * worked, then the map, every other screen and even logout answered 429. Signed-in traffic
   * is therefore keyed on the user (see globalKey), and only anonymous traffic on the address.
   * Credential routes stay skipped so a full address bucket can't block signing in; they have
   * their own limiters below.
   */
  const global = rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    limit: limits.global,
    store: storeFor('global'),
    standardHeaders: true, // expose RateLimit-* so clients can back off before being cut off
    legacyHeaders: false,
    skip: (req) => skipPreflight(req) || isCredentialPath(req.path),
    keyGenerator: globalKey,
    handler: logBlocked('global', globalKey),
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
    limit: emergencyAuthLimit(limits.credential, 5),
    store: storeFor('credential'),
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
    limit: emergencyAuthLimit(limits.credentialFailures, 3),
    store: storeFor('credential-failures'),
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
    limit: emergencyAuthLimit(limits.resetEmail, 2),
    store: storeFor('reset-email'),
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

/**
 * Per-address budget for the public APK download (GET /v1/app/download). Each hit presigns a URL
 * to a large object, so this sits well under the global budget while leaving room for retries
 * and a household behind one address. Mounted on the route itself rather than in applyRateLimits.
 */
export function createDownloadLimiter(limit = 20): RateLimitRequestHandler {
  return rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipPreflight,
    keyGenerator: ipKey,
    handler: logBlocked('apk-download', ipKey),
    message: { status: 429, message: 'Too many downloads. Please try again in a few minutes.' },
  });
}

/** Mounts the limiters. Must run after the body parsers — the reset-email key reads the body. */
export function applyRateLimits(app: Express, limiters: RateLimiters = createRateLimiters()) {
  for (const path of CREDENTIAL_PATHS) {
    app.use(path, limiters.credential, limiters.credentialFailures);
  }
  app.use(FORGOT_PASSWORD_PATH, limiters.resetEmail);
  app.use(limiters.global);
}
