import { PublishBatchCommand, PublishCommand } from '@aws-sdk/client-sns';
import { v4 as uuidv4 } from 'uuid';
import { sns } from './clients';
import { EVENTS_TOPIC_ARN } from '../../config';
import { getContext } from '../../utils/async-context';
import logger from '../../utils/logger';

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

/** The SNS message attribute each queue's subscription filter policy matches on. */
export const EVENT_TYPE_ATTRIBUTE = 'eventType';

/**
 * Publish a domain event to the events topic.
 *
 * The routing key goes out as the `eventType` message attribute, and each
 * consumer's queue is subscribed with a filter policy on it — that is what
 * replaced the RabbitMQ topic exchange's bindings. Subscriptions use raw
 * message delivery, so the queue receives exactly the JSON written here.
 *
 * The metadata carries the request's correlationId and requestId (see
 * `envelope` below).
 *
 * Never throws: returns false when the event could not be published, and the
 * caller decides whether that matters (analytics falls back to a direct write).
 */
export const publish = async <T>(
  routingKey: string,
  payload: T,
  version = '1',
): Promise<boolean> => {
  if (!EVENTS_TOPIC_ARN) {
    logger.error(`[EventBus] EVENTS_TOPIC_ARN is not set. Dropping event: ${routingKey}`);
    return false;
  }

  try {
    const event = envelope(routingKey, payload, version);

    await sns.send(
      new PublishCommand({
        TopicArn: EVENTS_TOPIC_ARN,
        Message: JSON.stringify(event),
        MessageAttributes: eventTypeAttribute(routingKey),
      }),
    );

    logger.info(`[EventBus] Published event: ${routingKey} [eventId:${event.metadata.eventId}]`);
    return true;
  } catch (error) {
    logger.error(`[EventBus] Failed to publish event: ${routingKey}`, error);
    return false;
  }
};

/** SNS PublishBatch takes at most ten entries (and 256 KB in all) per call. */
const SNS_BATCH_LIMIT = 10;

/**
 * Publish many events of one type, ten per SNS call instead of one call each.
 *
 * Returns one boolean per payload, in order, so a caller can fall back for
 * exactly the ones that failed. Like `publish`, it never throws: a chunk SNS
 * rejects outright (throttling, or over the 256 KB batch limit) comes back as
 * all false.
 */
export const publishMany = async <T>(
  routingKey: string,
  payloads: T[],
  version = '1',
): Promise<boolean[]> => {
  if (!EVENTS_TOPIC_ARN) {
    logger.error(
      `[EventBus] EVENTS_TOPIC_ARN is not set. Dropping ${payloads.length} event(s): ${routingKey}`,
    );
    return payloads.map(() => false);
  }

  const results = payloads.map(() => false);

  for (let start = 0; start < payloads.length; start += SNS_BATCH_LIMIT) {
    const chunk = payloads.slice(start, start + SNS_BATCH_LIMIT);
    try {
      const res = await sns.send(
        new PublishBatchCommand({
          TopicArn: EVENTS_TOPIC_ARN,
          PublishBatchRequestEntries: chunk.map((payload, i) => ({
            Id: String(start + i),
            Message: JSON.stringify(envelope(routingKey, payload, version)),
            MessageAttributes: eventTypeAttribute(routingKey),
          })),
        }),
      );
      for (const ok of res.Successful ?? []) results[Number(ok.Id)] = true;
      if (res.Failed?.length) {
        logger.error(
          `[EventBus] ${res.Failed.length}/${chunk.length} event(s) not published: ${routingKey}`,
          res.Failed,
        );
      }
    } catch (error) {
      logger.error(`[EventBus] Failed to publish ${chunk.length} event(s): ${routingKey}`, error);
    }
  }

  const published = results.filter(Boolean).length;
  if (published > 0) {
    logger.info(`[EventBus] Published ${published} event(s): ${routingKey}`);
  }
  return results;
};

/**
 * Wrap a payload with its metadata. The current correlationId and requestId
 * come from AsyncLocalStorage, so the worker can resume the same logging context.
 */
const envelope = <T>(routingKey: string, payload: T, version: string): DomainEvent<T> => {
  const ctx = getContext();
  return {
    metadata: {
      eventId: uuidv4(),
      eventType: routingKey,
      correlationId: ctx?.correlationId,
      requestId: ctx?.requestId,
      timestamp: new Date().toISOString(),
      version,
    },
    payload,
  };
};

const eventTypeAttribute = (routingKey: string) => ({
  [EVENT_TYPE_ATTRIBUTE]: { DataType: 'String', StringValue: routingKey },
});
