import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

interface AppError {
  status?: number;
  statusCode?: number;
  message?: string;
  stack?: string;
  name?: string;
  // Prisma known-request errors carry a `code` (e.g. "P2002") and `meta`.
  code?: string;
  meta?: Record<string, unknown>;
}

/**
 * Maps Prisma known-request error codes to HTTP semantics so repository-level
 * failures surface as proper 4xx responses instead of a generic 500.
 * Reference: https://www.prisma.io/docs/orm/reference/error-reference
 */
function mapPrismaError(err: AppError): { status: number; message: string } | null {
  switch (err.code) {
    case 'P2002': // Unique constraint violation
      return { status: 409, message: 'A record with these details already exists' };
    case 'P2025': // Record to update/delete not found
      return { status: 404, message: 'Resource not found' };
    case 'P2003': // Foreign key constraint failed
      return { status: 400, message: 'Invalid reference to a related resource' };
    case 'P2000': // Value too long for the column
      return { status: 400, message: 'One or more values are too long' };
    default:
      return null;
  }
}

export const errorHandler = (err: AppError, req: Request, res: Response, _next: NextFunction) => {
  // Always log the full error server-side (message + Prisma code) for diagnostics,
  // regardless of what we return to the client.
  logger.error(
    `${err.status || err.statusCode || 500} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}${
      err.code ? ` - prisma:${err.code}` : ''
    }`,
  );

  const isDev = process.env.NODE_ENV === 'development';

  // 1. Explicit status thrown by our own services (e.g. { status: 400, message }).
  let status = err.status || err.statusCode;
  let message = err.message;

  // 2. Prisma known-request errors → proper HTTP code + a safe message.
  if (!status) {
    const prismaMapped = mapPrismaError(err);
    if (prismaMapped) {
      status = prismaMapped.status;
      message = prismaMapped.message;
    } else if (err.name === 'PrismaClientValidationError') {
      // Bad query arguments — a client/data problem, not a server fault.
      status = 400;
      message = 'Invalid request data';
    }
  }

  // 3. Fallback for anything unclassified.
  if (!status) status = 500;

  // 4. Never leak internal error details (raw Prisma text, stack traces) to
  //    clients on server faults — send a generic message; the details are logged.
  if (status >= 500) {
    message = 'Internal Server Error';
  } else if (!message) {
    message = 'Request failed';
  }

  res.status(status).json({
    status: 'error',
    statusCode: status,
    message,
    ...(isDev && { stack: err.stack }),
  });
};
