import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';
import { setTimeout as sleep } from 'node:timers/promises';
import { v4 as uuidv4 } from 'uuid';
import { sqs } from './clients';
import { DomainEvent, EventMetadata } from './publisher';
import { asyncLocalStorage } from '../../utils/async-context';
import logger from '../../utils/logger';

/** Kept under this name for the consumers that already import it. */
export type DomainEventMessage<T> = DomainEvent<T>;

/** SQS long-poll ceiling. An idle consumer makes about three requests a minute. */
export const WAIT_TIME_SECONDS = 20;
/** How long to back off after a failed receive, which returns at once. */
const RECEIVE_ERROR_BACKOFF_MS = 5000;

export interface ConsumeOptions {
  /** Messages handled at the same time. Also the receive size, so SQS caps it at 10. */
  concurrency?: number;
  /** Seconds a received message stays hidden from other workers. Renewed while it runs. */
  visibilityTimeoutSeconds?: number;
  /** Seconds before a failed message is retried. */
  retryDelaySeconds?: number;
}

export interface Consumer {
  /**
   * Stop polling and resolve once in-flight messages are handled. Can take up
   * to WAIT_TIME_SECONDS longer when a poll is open — see the receive below.
   */
  stop(): Promise<void>;
}

/**
 * Consume one SQS queue, a message at a time per slot.
 *
 * Retries and the dead-letter queue are SQS's: a failed message is not deleted,
 * it comes back after `retryDelaySeconds`, and the queue's redrive policy moves
 * it to `<queue>-dlq` once it has been received `maxReceiveCount` times. That
 * replaces the RabbitMQ retry queue and `app.dlx`.
 *
 * Delivery is at least once, so every handler must be safe to run twice.
 */
export const consume = <T>(
  queueUrl: string,
  handler: (payload: T, metadata: EventMetadata) => Promise<void>,
  { concurrency = 1, visibilityTimeoutSeconds = 60, retryDelaySeconds = 30 }: ConsumeOptions = {},
): Consumer => {
  const abort = new AbortController();
  const batchSize = Math.max(1, Math.min(concurrency, 10));

  const loop = (async () => {
    while (!abort.signal.aborted) {
      let messages: Message[];
      try {
        const res = await sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: queueUrl,
            // Receive only what can start now. A message waiting behind another
            // is not renewed, so its timeout runs out and a second worker runs it.
            MaxNumberOfMessages: batchSize,
            WaitTimeSeconds: WAIT_TIME_SECONDS,
            VisibilityTimeout: visibilityTimeoutSeconds,
            MessageSystemAttributeNames: ['ApproximateReceiveCount'],
          }),
          // No abortSignal, on purpose. SQS does not see a cancelled poll, so a
          // message can still be handed to it and then sit hidden, unhandled,
          // for the whole visibility timeout.
        );
        messages = res.Messages ?? [];
      } catch (error) {
        logger.warn(`[EventBus] Receive failed on ${queueUrl}. Backing off.`, error);
        await sleep(RECEIVE_ERROR_BACKOFF_MS, undefined, { signal: abort.signal }).catch(() => {});
        continue;
      }

      if (abort.signal.aborted) {
        // Received while shutting down: hand them straight back to another worker.
        await Promise.all(messages.map((m) => releaseMessage(queueUrl, m)));
        break;
      }

      await Promise.all(
        messages.map((m) =>
          handleOne(queueUrl, m, handler, visibilityTimeoutSeconds, retryDelaySeconds),
        ),
      );
    }
  })();

  logger.info(`[EventBus] Consumer listening on ${queueUrl}`);

  return {
    stop: async () => {
      abort.abort();
      await loop;
    },
  };
};

/** Make a received message visible again at once. */
export const releaseMessage = (queueUrl: string, m: Message): Promise<unknown> =>
  sqs
    .send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: m.ReceiptHandle!,
        VisibilityTimeout: 0,
      }),
    )
    .catch(() => {});

/** Parse an event body, or undefined when it can never be handled. */
export const parseEvent = <T>(m: Message): DomainEvent<T> | undefined => {
  try {
    const event = JSON.parse(m.Body ?? '') as DomainEvent<T>;
    return event && typeof event === 'object' && 'payload' in event ? event : undefined;
  } catch {
    return undefined;
  }
};

/** Never throws, so one bad message cannot stop the loop. */
const handleOne = async <T>(
  queueUrl: string,
  m: Message,
  handler: (payload: T, metadata: EventMetadata) => Promise<void>,
  visibilityTimeoutSeconds: number,
  retryDelaySeconds: number,
): Promise<void> => {
  const receipt = { QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle! };

  const event = parseEvent<T>(m);
  if (!event) {
    // Retrying cannot fix it, so log and drop rather than fill the DLQ.
    logger.error(
      `[EventBus] Dropping unparseable message ${m.MessageId} on ${queueUrl}: ${m.Body?.slice(0, 500)}`,
    );
    await sqs.send(new DeleteMessageCommand(receipt)).catch(() => {});
    return;
  }

  const { metadata, payload } = event;
  const receiveCount = m.Attributes?.ApproximateReceiveCount ?? '1';

  // Resume the publisher's correlation context so worker logs line up with the
  // HTTP request that raised the event.
  const context = {
    correlationId: metadata?.correlationId || uuidv4(),
    requestId: metadata?.requestId || uuidv4(),
  };

  // Keep the message hidden while it runs, or another worker picks it up mid-job.
  const heartbeat = setInterval(
    () => {
      sqs
        .send(
          new ChangeMessageVisibilityCommand({
            ...receipt,
            VisibilityTimeout: visibilityTimeoutSeconds,
          }),
        )
        .catch(() => {});
    },
    Math.max(1000, (visibilityTimeoutSeconds * 1000) / 3),
  );

  await asyncLocalStorage.run(context, async () => {
    try {
      await handler(payload, metadata);
    } catch (error) {
      // Not deleted: SQS redelivers it after the delay, and the redrive policy
      // moves it to the DLQ after maxReceiveCount receives.
      logger.warn(
        `[EventBus] Handler failed on ${queueUrl} [eventId:${metadata?.eventId}, receive ${receiveCount}]. Retrying in ${retryDelaySeconds}s unless it is dead-lettered.`,
        error,
      );
      await sqs
        .send(
          new ChangeMessageVisibilityCommand({ ...receipt, VisibilityTimeout: retryDelaySeconds }),
        )
        .catch(() => {});
      return;
    } finally {
      clearInterval(heartbeat);
    }

    // Handled. A failed delete only means it comes back once the visibility
    // timeout runs out and runs again, which handlers already have to tolerate.
    await sqs.send(new DeleteMessageCommand(receipt)).catch((error) => {
      logger.warn(
        `[EventBus] Handled ${metadata?.eventId} on ${queueUrl} but could not delete it; it will repeat.`,
        error,
      );
    });
  });
};
