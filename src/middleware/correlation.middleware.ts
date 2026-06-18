import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { asyncLocalStorage } from '../utils/async-context';

/**
 * Correlation Middleware
 *
 * Assigns a unique requestId and correlationId to each incoming request.
 *
 * - correlationId: Can be passed by the client (e.g., a gateway or mobile app)
 *   via `x-correlation-id` to trace a single business operation across services.
 *   If not provided, it defaults to the same value as requestId.
 *
 * - requestId: Always generated fresh per request. Identifies this specific
 *   HTTP call uniquely.
 *
 * Both IDs are injected into AsyncLocalStorage so all logger calls downstream
 * automatically include them — without needing to pass req objects around.
 */
export const correlationMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const requestId = uuidv4();
  const correlationId = (req.headers['x-correlation-id'] as string) || requestId;

  // Echo both IDs back in the response headers for client traceability
  res.setHeader('x-request-id', requestId);
  res.setHeader('x-correlation-id', correlationId);

  asyncLocalStorage.run({ requestId, correlationId }, () => {
    next();
  });
};
