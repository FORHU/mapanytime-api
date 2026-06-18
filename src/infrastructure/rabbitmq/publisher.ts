import { v4 as uuidv4 } from "uuid";
import { rabbitConnection } from "./connection";
import { APP_EXCHANGE } from "./exchanges";
import { getContext } from "../../utils/async-context";
import logger from "../../utils/logger";

export interface EventMetadata {
  eventId: string;
  eventType: string;
  correlationId?: string;
  requestId?: string;
  timestamp: string;
  version: string;
}

export interface DomainEvent<T> {
  metadata: EventMetadata;
  payload: T;
}

/**
 * Publish a domain event to the topic exchange.
 *
 * Automatically injects the current correlationId and requestId from
 * AsyncLocalStorage into the event metadata headers, so the worker process
 * can resume the same logging context.
 */
export const publish = async <T>(
  routingKey: string,
  payload: T,
  version = "1",
): Promise<boolean> => {
  try {
    const channel = rabbitConnection.getChannel();
    const ctx = getContext();

    const metadata: EventMetadata = {
      eventId: uuidv4(),
      eventType: routingKey,
      correlationId: ctx?.correlationId,
      requestId: ctx?.requestId,
      timestamp: new Date().toISOString(),
      version,
    };

    const event: DomainEvent<T> = { metadata, payload };
    const messageBuffer = Buffer.from(JSON.stringify(event));

    const result = channel.publish(APP_EXCHANGE, routingKey, messageBuffer, {
      persistent: true,
      timestamp: Date.now(),
      contentType: "application/json",
      headers: {
        correlationId: metadata.correlationId,
        requestId: metadata.requestId,
        eventId: metadata.eventId,
        eventType: metadata.eventType,
        timestamp: metadata.timestamp,
        version: metadata.version,
      },
    });

    logger.info(
      `[RabbitMQ] Published event: ${routingKey} [eventId:${metadata.eventId}]`,
    );
    return result;
  } catch (error) {
    logger.error(`[RabbitMQ] Failed to publish event: ${routingKey}`, error);
    return false;
  }
};
