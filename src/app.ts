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
app.use(helmet());

app.use(
  cors({
    origin: ['http://localhost:4000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set up rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});

if (!isDev) app.use(limiter);

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
