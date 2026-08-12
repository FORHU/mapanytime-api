import { Channel, ConsumeMessage } from 'amqplib';
import { rabbitConnection } from './connection';
import { APP_EXCHANGE, DLX_EXCHANGE } from './exchanges';
import logger from '../../utils/logger';
import { DomainEventMessage } from './consumer';

export interface BatchConsumerOptions {
  queueName: string;
  routingKey: string;
  /** Flush once this many messages are buffered. */
  batchSize: number;
  /** Flush a partial batch after this long, so a quiet queue still drains. */
  flushIntervalMs: number;
}

interface Buffered<T> {
  message: ConsumeMessage;
  payload: T;
}

/**
 * Consume a queue in batches rather than one message at a time.
 *
 * The per-message `consume()` in this folder is the right default. This exists
 * for high-volume append-only streams where one INSERT per message is the
 * bottleneck — analytics ingestion being the case it was written for.
 *
 * How it differs, and why:
 *
 * - **Dedicated channel.** The shared channel sets prefetch(1); batching needs
 *   many messages in flight, so this opens its own with prefetch = batchSize.
 * - **Deferred ack.** Messages are acked only once the handler has durably
 *   processed the whole batch, using `ack(lastMessage, allUpTo=true)` — one
 *   frame for the batch instead of one per message. Nothing is acked before it
 *   is written, so a crash mid-batch redelivers rather than loses.
 * - **At-least-once, not exactly-once.** A crash between the write committing
 *   and the ack landing redelivers the batch, so a handler must tolerate
 *   duplicates. For an append-only event log that means occasional duplicate
 *   rows, which aggregation dedupes by session anyway.
 */
export const consumeBatch = async <T>(
  options: BatchConsumerOptions,
  handler: (payloads: T[]) => Promise<void>,
): Promise<void> => {
  const { queueName, routingKey, batchSize, flushIntervalMs } = options;

  const channel: Channel = await rabbitConnection.createDedicatedChannel(batchSize);

  const dlqName = `${queueName}.dlq`;
  await channel.assertQueue(dlqName, { durable: true });
  await channel.bindQueue(dlqName, DLX_EXCHANGE, routingKey);

  await channel.assertQueue(queueName, {
    durable: true,
    deadLetterExchange: DLX_EXCHANGE,
    deadLetterRoutingKey: routingKey,
  });
  await channel.bindQueue(queueName, APP_EXCHANGE, routingKey);

  let buffer: Buffered<T>[] = [];
  let timer: NodeJS.Timeout | null = null;
  // Guards against the size-triggered and timer-triggered flush overlapping.
  let flushing = false;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = async () => {
    if (flushing || buffer.length === 0) return;
    flushing = true;
    clearTimer();

    // Take the buffer so messages arriving during the await land in the next
    // batch instead of being acked by this one.
    const batch = buffer;
    buffer = [];

    const last = batch[batch.length - 1].message;

    try {
      await handler(batch.map((b) => b.payload));
      channel.ack(last, true);
      logger.info(`[RabbitMQ][Batch] Flushed ${batch.length} message(s) from ${queueName}`);
    } catch (error) {
      logger.error(
        `[RabbitMQ][Batch] Handler failed for ${batch.length} message(s) on ${queueName}. Routing to DLQ.`,
        error,
      );
      // requeue=false: a requeue here would spin the same failing batch in a
      // hot loop. The DLQ keeps the events for replay once the cause is fixed.
      channel.nack(last, true, false);
    } finally {
      flushing = false;
      // More arrived while we were writing — keep draining.
      if (buffer.length >= batchSize) {
        void flush();
      } else if (buffer.length > 0) {
        scheduleFlush();
      }
    }
  };

  const scheduleFlush = () => {
    if (timer) return;
    timer = setTimeout(() => {
      // Clear before flushing: if a flush is already running this one returns
      // early, and a stale non-null timer would stop the finally block from
      // re-arming — stranding a partial batch until the next message arrives.
      timer = null;
      void flush();
    }, flushIntervalMs);
  };

  await channel.consume(queueName, (msg: ConsumeMessage | null) => {
    if (!msg) return;

    let parsed: DomainEventMessage<T>;
    try {
      parsed = JSON.parse(msg.content.toString()) as DomainEventMessage<T>;
    } catch {
      // Unparseable messages must not sit in the buffer holding up an ack range.
      logger.error(`[RabbitMQ][Batch] Unparseable message on ${queueName}. Discarding.`);
      channel.nack(msg, false, false);
      return;
    }

    buffer.push({ message: msg, payload: parsed.payload });

    if (buffer.length >= batchSize) {
      void flush();
    } else {
      scheduleFlush();
    }
  });

  logger.info(
    `[RabbitMQ][Batch] Consumer listening on ${queueName} (routingKey: ${routingKey}, batchSize: ${batchSize}, flushInterval: ${flushIntervalMs}ms)`,
  );
};
