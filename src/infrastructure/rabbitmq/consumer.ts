import { ConsumeMessage } from 'amqplib';
import { v4 as uuidv4 } from 'uuid';
import { rabbitConnection } from './connection';
import { APP_EXCHANGE, DLX_EXCHANGE } from './exchanges';
import { asyncLocalStorage } from '../../utils/async-context';
import logger from '../../utils/logger';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

export interface DomainEventMessage<T> {
  metadata: {
    eventId: string;
    eventType: string;
    correlationId?: string;
    requestId?: string;
    timestamp: string;
    version: string;
  };
  payload: T;
}

export const consume = async <T>(
  queueName: string,
  routingKey: string,
  handler: (payload: T, metadata: DomainEventMessage<T>['metadata']) => Promise<void>,
): Promise<void> => {
  const channel = rabbitConnection.getChannel();

  const dlqName = `${queueName}.dlq`;
  const retryQueueName = `${queueName}.retry`;

  // 1. Assert Dead Letter Queue
  await channel.assertQueue(dlqName, { durable: true });
  await channel.bindQueue(dlqName, DLX_EXCHANGE, routingKey);

  // 2. Assert Retry Queue (messages wait for TTL, then re-enter main queue)
  await channel.assertQueue(retryQueueName, {
    durable: true,
    deadLetterExchange: '',
    deadLetterRoutingKey: queueName,
    messageTtl: RETRY_DELAY_MS,
  });

  // 3. Assert Main Queue
  await channel.assertQueue(queueName, {
    durable: true,
    deadLetterExchange: DLX_EXCHANGE,
    deadLetterRoutingKey: routingKey,
  });
  await channel.bindQueue(queueName, APP_EXCHANGE, routingKey);

  // 4. Start Consuming
  await channel.consume(queueName, async (msg: ConsumeMessage | null) => {
    if (!msg) return;

    let parsedEvent: DomainEventMessage<T> | null = null;

    try {
      parsedEvent = JSON.parse(msg.content.toString()) as DomainEventMessage<T>;
    } catch {
      logger.error(`[RabbitMQ] Failed to parse message on queue: ${queueName}. Discarding.`);
      channel.nack(msg, false, false);
      return;
    }

    const { metadata, payload } = parsedEvent;

    // Resume correlation context from message headers so all worker logs
    // carry the same correlationId as the original HTTP request.
    const correlationId =
      (msg.properties.headers?.correlationId as string) || metadata.correlationId || uuidv4();
    const requestId =
      (msg.properties.headers?.requestId as string) || metadata.requestId || uuidv4();

    await asyncLocalStorage.run({ correlationId, requestId }, async () => {
      const headers = msg.properties.headers || {};
      const retryCount = (headers['x-retry-count'] || 0) as number;

      try {
        await handler(payload, metadata);
        channel.ack(msg);
      } catch (error) {
        if (retryCount < MAX_RETRIES) {
          logger.warn(
            `[RabbitMQ] Handler failed for ${queueName}. Retrying (${retryCount + 1}/${MAX_RETRIES})...`,
          );

          channel.publish('', retryQueueName, msg.content, {
            persistent: true,
            headers: { ...headers, 'x-retry-count': retryCount + 1 },
          });

          channel.ack(msg);
        } else {
          logger.error(
            `[RabbitMQ] Max retries exceeded for ${queueName} [eventId:${metadata.eventId}]. Moving to DLQ.`,
          );
          channel.nack(msg, false, false);
        }
      }
    });
  });

  logger.info(`[RabbitMQ] Consumer listening on queue: ${queueName} (routingKey: ${routingKey})`);
};
