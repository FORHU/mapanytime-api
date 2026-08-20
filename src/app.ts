import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import router from './routes';
import { isDev } from './config';
import setup from './setup';
import cors from 'cors';
import { errorHandler } from './middleware/error.middleware';
import { correlationMiddleware } from './middleware/correlation.middleware';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './utils/swagger';

const app = express();

app.set('trust proxy', 1);

// Assign correlationId + requestId to every request (must be first)
app.use(correlationMiddleware);

// Configure Helmet to allow Swagger UI inline scripts and styles
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'validator.swagger.io'],
        upgradeInsecureRequests: null,
      },
    },
    // Stop Helmet from blocking cross-network data reading
    crossOriginResourcePolicy: false,
  }),
);

/**
 * HTTP CORS allowlist, matching the socket's (F14).
 *
 * Reflecting every origin while `credentials: true` is set lets any site make
 * authenticated calls on a signed-in user's behalf. The socket was fixed for
 * exactly this; HTTP was left reflecting, which is the larger surface of the
 * two. See FLAGS.md F22.
 *
 * Left open when CORS_ORIGIN is unset, because local dev and the Flutter client
 * send no usable Origin header — but see the production guard below: shipping
 * without it configured is a deploy mistake, not a supported mode.
 */
const allowedOrigins = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
  throw new Error(
    'CORS_ORIGIN must be set in production. Starting without it would reflect every ' +
      'origin with credentials enabled, letting any site call this API as a signed-in user.',
  );
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (allowedOrigins.length === 0 || !origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
  }),
);

/**
 * `verify` runs before the body is parsed, which is the only point the
 * unmodified bytes still exist. Provider webhook signatures (PayMongo's
 * `paymongo-signature`) are an HMAC over exactly those bytes — re-serialising
 * the parsed object with JSON.stringify changes key order and whitespace, so
 * the digest never matches. See FLAGS.md.
 */
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

/**
 * Global throttle — a blunt guard against abuse, not a per-feature budget.
 *
 * The previous 100-per-15-minutes worked out to under 7 requests a minute for an entire IP,
 * which a single authenticated dashboard session burns through in a couple of minutes. Two
 * things made it bite harder than the number suggests:
 *   - CORS preflights counted. Every cross-origin call carrying Authorization triggers an
 *     OPTIONS first, so the real budget was roughly half the stated one. They're skipped now.
 *   - Shared egress IPs (office NAT, mobile carriers) pool their users into one budget.
 */
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true, // expose RateLimit-* so clients can back off before being cut off
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  // JSON, not the library's plain-text default — the web client parses every error body as JSON
  // and a text body surfaced to users as a generic "Request failed".
  message: { status: 429, message: 'Too many requests. Please slow down and try again shortly.' },
});

/**
 * Credential endpoints get their own, much tighter budget. Login is the one route where a high
 * request rate is itself the attack, and it must not share a counter with ordinary browsing —
 * otherwise a busy session exhausts the pool that is supposed to be slowing down guessing.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  skipSuccessfulRequests: true, // only failed attempts count toward the limit
  message: { status: 429, message: 'Too many attempts. Please try again in a few minutes.' },
});

// Rate limiting runs in production only, which is why limit problems never surface locally.
// Set RATE_LIMIT_IN_DEV=true to exercise it against a dev server before shipping a change.
if (!isDev || process.env.RATE_LIMIT_IN_DEV === 'true') {
  app.use('/api/v1/auth/login', authLimiter);
  app.use('/api/v1/auth/register', authLimiter);
  app.use(limiter);
}

// Set up security headers
app.disable('x-powered-by');

// API Routes
app.use('/api', router);

// Swagger UI
if (isDev) {
  app.use(
    '/api/docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customSiteTitle: 'Node.js API Docs',
      customCss: '.swagger-ui .topbar { display: none }',
    }),
  );
}
// Catch-All 404 Middleware
app.use((req, res, next) => {
  const error = new Error(`Route not found: ${req.originalUrl}`) as Error & { status?: number };
  error.status = 404;
  // Pass the error to your custom errorHandler below
  next(error);
});

// Error Handling
app.use(errorHandler);

// Run setup
setup().catch((err) => {
  console.log('Setup failed:', err);
});

export default app;
