import { GetTopicAttributesCommand } from '@aws-sdk/client-sns';
import { sns } from './clients';
import { publish, publishMany } from './publisher';
import { consume } from './consumer';
import { consumeBatch } from './batch-consumer';
import { EVENTS_TOPIC_ARN } from '../../config';

const PING_TIMEOUT_MS = 2000;

/**
 * The async event bus: one SNS topic, fanned out to an SQS queue per consumer.
 * Topology, queues and subscriptions live in infra/README.md (deployed) and
 * docker/localstack/init-events.sh (local).
 *
 * There is nothing to connect or close. SNS and SQS are plain HTTPS calls.
 */
export const eventBus = {
  publish,
  publishMany,
  consume,
  consumeBatch,
  /** True when the events topic answers. Used by the readiness check. */
  ping: async (): Promise<boolean> => {
    if (!EVENTS_TOPIC_ARN) return false;
    try {
      await sns.send(new GetTopicAttributesCommand({ TopicArn: EVENTS_TOPIC_ARN }), {
        abortSignal: AbortSignal.timeout(PING_TIMEOUT_MS),
      });
      return true;
    } catch {
      return false;
    }
  },
};

export type { Consumer, ConsumeOptions, DomainEventMessage } from './consumer';
export type { BatchConsumerOptions } from './batch-consumer';
export type { DomainEvent, EventMetadata } from './publisher';
