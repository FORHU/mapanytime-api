import swaggerJsdoc from 'swagger-jsdoc';
import { PORT } from '../config';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Node.js PostgreSQL API Template',
      version: '1.0.0',
      description:
        'Enterprise-grade Express.js API with Event-Driven Architecture, RabbitMQ, Redis, and Prisma ORM.',
      contact: {
        name: 'API Support',
        email: 'support@example.com',
      },
    },
    servers: [
      {
        url: `http://localhost:${PORT}/api`,
        description: 'Local Development',
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
  },
  // Glob pattern for JSDoc-annotated route files
  apis: ['./src/routes/*.ts', './src/controllers/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
