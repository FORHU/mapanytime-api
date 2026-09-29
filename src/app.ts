import express from 'express';
import helmet from 'helmet';
import router from './routes';
import { isDev } from './config';
import setup from './setup';
import { errorHandler } from './middleware/error.middleware';
import { correlationMiddleware } from './middleware/correlation.middleware';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './utils/swagger';
import { applyRateLimits } from './middleware/rate-limit.middleware';
import { assertConfigured, corsMiddleware, logConfiguration } from './middleware/cors.middleware';

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

// HTTP CORS allowlist, shared with the socket gateway — see cors.middleware.ts
// for why it is one module and what each branch is protecting (F14, F22, F94).
assertConfigured();
logConfiguration();
app.use(corsMiddleware);

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

// Rate limiting runs in production only, which is why limit problems never surface locally.
// Set RATE_LIMIT_IN_DEV=true to exercise it against a dev server before shipping a change.
// See rate-limit.middleware.ts for the limiters and how they combine.
if (!isDev || process.env.RATE_LIMIT_IN_DEV === 'true') {
  applyRateLimits(app);
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
