import swaggerJsdoc from 'swagger-jsdoc';
import { PORT } from '../config';

const definition: swaggerJsdoc.Options['definition'] = {
  openapi: '3.0.0',
  info: {
    title: 'MapAnytime Marketplace API',
    version: '1.0.0',
    description:
      'Enterprise-grade Express.js API for the MapAnytime marketplace, featuring geospatial querying, S3 direct uploads, Redis caching, and interactive Prisma ORM transactions.',
    contact: {
      name: 'API Support',
      email: 'support@example.com',
    },
  },
  servers: [
    {
      url: `/api`,
      description: 'Current Environment',
    },
    {
      url: `http://localhost:${PORT}/api`,
      description: 'Local Fallback',
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your JWT access token.',
      },
    },
    schemas: {
      SuccessResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'success' },
          statusCode: { type: 'integer', example: 200 },
          data: { type: 'object' },
          message: { type: 'string' },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'error' },
          statusCode: { type: 'integer', example: 400 },
          message: { type: 'string', example: 'Validation failed' },
          code: { type: 'string' },
          details: { type: 'object' },
        },
      },
      PageResult: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'object' } },
          total: { type: 'integer', example: 87 },
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 20 },
          totalPages: { type: 'integer', example: 5 },
        },
      },
    },
  },
  security: [{ BearerAuth: [] }],
};

/**
 * Glob patterns for the YAML specs and any JSDoc-annotated source.
 *
 * These are matched against the filesystem at startup, so a path that no
 * longer exists fails silently — it just contributes no endpoints. Keep them
 * in step with the layout: the YAML lives in src/swagger/, and feature code
 * lives in src/modules/, not the old src/{routes,controllers}/ folders.
 *
 * Exported so `tests/unit/swagger.spec.test.ts` can assert every pattern still
 * matches something. They pointed at deleted folders once and `/api-docs`
 * served 0 endpoints without a single failing check.
 */
export const SWAGGER_APIS = [
  './src/swagger/*.yaml',
  './src/modules/**/*.route.ts',
  './src/modules/**/*.controller.ts',
];

const options: swaggerJsdoc.Options = {
  definition,
  apis: SWAGGER_APIS,
};

export const swaggerSpec = swaggerJsdoc(options);
