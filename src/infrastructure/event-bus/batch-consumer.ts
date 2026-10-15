import {
  ChangeMessageVisibilityBatchCommand,
  DeleteMessageBatchCommand,
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';
import { setTimeout as sleep } from 'node:timers/promises';
import { sqs } from './clients';
import { Consumer, dropUnhandled, handlesEvent, parseEvent, WAIT_TIME_SECONDS } from './consumer';
import { EventMetadata } from './publisher';
import logger from '../../utils/logger';

export interface BatchConsumerOptions {
  queueUrl: string;
  /** Flush once this many messages are buffered. */
  batchSize: number;
  /** Flush a partial batch this long after its first message, so a quiet queue still drains. */
  flushIntervalMs: number;
  /**
   * Seconds a received message stays hidden. Must outlast the flush interval
   * plus the write, or a buffered message is redelivered while it waits.
   */
  visibilityTimeoutSeconds?: number;
  /** Seconds before a failed batch is retried. */
  retryDelaySeconds?: number;
  /** The event types this consumer handles. See `ConsumeOptions.eventTypes`. */
  eventTypes?: readonly string[];
}

/** SQS batch calls (receive, delete, change visibility) take at most ten entries. */
const SQS_BATCH_LIMIT = 10;
const RECEIVE_ERROR_BACKOFF_MS = 5000;

interface Buffered<T> {
  message: Message;
  payload: T;
  metadata: EventMetadata;
}

/**
 * Consume a queue in batches rather than one message at a time.
 *
 * `consume()` is the right default. This exists for high-volume append-only
 * streams where one INSERT per message is the bottleneck: analytics ingestion
 * is the case it was written for.
 *
 * - **One loop, no timers.** Receives (ten at most, an SQS limit) fill a buffer
 *   until it reaches `batchSize` or the flush deadline passes. While a partial
 *   batch waits, the long poll is shortened to end at the deadline. Two flushes
 *   can never overlap.
 * - **Delete after write.** Messages are deleted only once the handler has
 *   written the whole batch. A crash mid-batch redelivers rather than loses.
 * - **Failures retry, then dead-letter.** A failed batch is made visible again
 *   after `retryDelaySeconds`, and the redrive policy parks messages that keep
 *   failing in `<queue>-dlq`.
 * - **At least once, not exactly once.** A crash between the write and the
 *   delete redelivers the batch, so the handler must tolerate duplicates. It
 *   gets each event's metadata, in the same order as the payloads, so it can
 *   key on `eventId`.
 * - **Stopping flushes.** On stop, whatever is buffered is written before the
 *   loop exits, so nothing waits out a visibility timeout.
 */
export const consumeBatch = <T>(
  options: BatchConsumerOptions,
  handler: (payloads: T[], metadata: EventMetadata[]) => Promise<void>,
): Consumer => {
  const {
    queueUrl,
    batchSize,
    flushIntervalMs,
    visibilityTimeoutSeconds = 60,
    retryDelaySeconds = 30,
    eventTypes,
  } = options;

  const abort = new AbortController();
  let buffer: Buffered<T>[] = [];
  let deadline = 0;

  const flush = async () => {
    const batch = buffer;
    buffer = [];

    try {
      await handler(
        batch.map((b) => b.payload),
        batch.map((b) => b.metadata),
      );
    } catch (error) {
      logger.error(
        `[EventBus][Batch] Handler failed for ${batch.length} message(s) on ${queueUrl}. Retrying in ${retryDelaySeconds}s unless dead-lettered.`,
        error,
      );
      await inChunks(batch, (chunk) =>
        sqs.send(
          new ChangeMessageVisibilityBatchCommand({
            QueueUrl: queueUrl,
            Entries: chunk.map((b, i) => ({
              Id: String(i),
              ReceiptHandle: b.message.ReceiptHandle!,
              VisibilityTimeout: retryDelaySeconds,
            })),
          }),
        ),
      );
      return;
    }

    await inChunks(batch, async (chunk) => {
      const res = await sqs.send(
        new DeleteMessageBatchCommand({
          QueueUrl: queueUrl,
          Entries: chunk.map((b, i) => ({
            Id: String(i),
            ReceiptHandle: b.message.ReceiptHandle!,
          })),
        }),
      );
      if (res.Failed?.length) {
        // Already written; they will be redelivered and written again.
        logger.warn(
          `[EventBus][Batch] ${res.Failed.length} written message(s) on ${queueUrl} could not be deleted and will repeat.`,
        );
      }
    });
    logger.info(`[EventBus][Batch] Flushed ${batch.length} message(s) from ${queueUrl}`);
  };

  const loop = (async () => {
    for (;;) {
      const due =
        buffer.length >= batchSize ||
        (buffer.length > 0 && (Date.now() >= deadline || abort.signal.aborted));
      if (due) await flush();
      if (abort.signal.aborted) break;

      // With a partial batch waiting, poll only until its flush deadline.
      const waitSeconds =
        buffer.length === 0
          ? WAIT_TIME_SECONDS
          : Math.min(WAIT_TIME_SECONDS, Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));

      let messages: Message[];
      try {
        const res = await sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: Math.min(SQS_BATCH_LIMIT, batchSize - buffer.length),
            WaitTimeSeconds: waitSeconds,
            VisibilityTimeout: visibilityTimeoutSeconds,
          }),
          // No abortSignal: see the note in consumer.ts.
        );
        messages = res.Messages ?? [];
      } catch (error) {
        logger.warn(`[EventBus][Batch] Receive failed on ${queueUrl}. Backing off.`, error);
        await sleep(RECEIVE_ERROR_BACKOFF_MS, undefined, { signal: abort.signal }).catch(() => {});
        continue;
      }

      for (const message of messages) {
        const event = parseEvent<T>(message);
        if (!event) {
          logger.error(
            `[EventBus][Batch] Dropping unparseable message ${message.MessageId} on ${queueUrl}.`,
          );
          await sqs
            .send(
              new DeleteMessageCommand({
                QueueUrl: queueUrl,
                ReceiptHandle: message.ReceiptHandle!,
              }),
            )
            .catch(() => {});
          continue;
        }
        if (!handlesEvent(event, eventTypes)) {
          await dropUnhandled(queueUrl, message, event);
          continue;
        }
        if (buffer.length === 0) deadline = Date.now() + flushIntervalMs;
        buffer.push({ message, payload: event.payload, metadata: event.metadata });
      }
    }
  })();

  logger.info(
    `[EventBus][Batch] Consumer listening on ${queueUrl} (batchSize: ${batchSize}, flushInterval: ${flushIntervalMs}ms)`,
  );

  return {
    stop: async () => {
      abort.abort();
      await loop;
    },
  };
};

/** Run `fn` over `items` in SQS-sized chunks, logging (not throwing) failures. */
const inChunks = async <B>(items: B[], fn: (chunk: B[]) => Promise<unknown>): Promise<void> => {
  for (let i = 0; i < items.length; i += SQS_BATCH_LIMIT) {
    await fn(items.slice(i, i + SQS_BATCH_LIMIT)).catch((error) =>
      logger.error('[EventBus][Batch] SQS batch call failed', error),
    );
  }
};
