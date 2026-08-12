import { consumeBatch } from '../infrastructure/rabbitmq/batch-consumer';
import { ROUTING_KEYS } from '../events/routing-keys';
import AnalyticsRepository from '../modules/analytics/analytics.repository';
import { AnalyticsEventPayload } from '../modules/analytics/analytics.types';
import logger from '../utils/logger';

const QUEUE_NAME = 'analytics.queue';

/**
 * Batch size and flush interval are the two knobs that decide the trade between
 * write throughput and how stale the event table is allowed to get.
 *
 * 200 sits in the range docs/analytics-evaluation.md recommends (100–500): big
 * enough that the per-statement overhead stops mattering, small enough that a
 * failed batch sends a manageable number of events to the DLQ. The 5s interval
 * bounds staleness when traffic is too thin to fill a batch.
 */
const BATCH_SIZE = Number(process.env.ANALYTICS_BATCH_SIZE || 200);
const FLUSH_INTERVAL_MS = Number(process.env.ANALYTICS_FLUSH_INTERVAL_MS || 5000);

export const startAnalyticsConsumer = async () => {
  await consumeBatch<AnalyticsEventPayload>(
    {
      queueName: QUEUE_NAME,
      routingKey: ROUTING_KEYS.ANALYTICS_EVENT_RECORDED,
      batchSize: BATCH_SIZE,
      flushIntervalMs: FLUSH_INTERVAL_MS,
    },
    async (events) => {
      const written = await AnalyticsRepository.createMany(events);
      logger.debug(`[AnalyticsConsumer] Wrote ${written} event(s)`);
    },
  );
};
