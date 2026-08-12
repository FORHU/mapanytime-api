import { ANALYTICSEVENTTYPE } from '@prisma/client';

export { ANALYTICSEVENTTYPE };

/** One interaction as the client reports it. */
export interface AnalyticsEventInput {
  eventType: ANALYTICSEVENTTYPE;
  /** Client-generated anonymous session id — see docs/analytics-evaluation.md §2. */
  sessionId?: string;
  storeId?: string;
  productId?: string;
  categoryId?: string;
  metadata?: Record<string, unknown>;
  /** ISO-8601. Defaults to server receipt time when the client omits it. */
  occurredAt?: string;
}

/**
 * An event after the service has stamped it with everything the client is not
 * trusted to supply. This is what travels over RabbitMQ and what the worker
 * writes, so its shape is a wire contract — changing a field name here means
 * in-flight messages published by the old code will not match.
 */
export interface AnalyticsEventPayload {
  eventType: ANALYTICSEVENTTYPE;
  userId: string | null;
  sessionId: string | null;
  storeId: string | null;
  productId: string | null;
  categoryId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  /** ISO-8601 string; the worker parses it back to a Date. */
  occurredAt: string;
}

/** Request-scoped context the service stamps onto every event. */
export interface AnalyticsRequestContext {
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}
