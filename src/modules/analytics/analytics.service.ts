import { rabbitmq } from '../../infrastructure/rabbitmq';
import { ROUTING_KEYS } from '../../events/routing-keys';
import logger from '../../utils/logger';
import AnalyticsRepository from './analytics.repository';
import {
  AnalyticsEventInput,
  AnalyticsEventPayload,
  AnalyticsRequestContext,
} from './analytics.types';

export interface RecordResult {
  accepted: number;
  /** 'queued' — handed to RabbitMQ. 'direct' — queue was down, written inline. */
  transport: 'queued' | 'direct';
}

export default class AnalyticsService {
  /**
   * Normalise a client-reported event into the wire payload.
   *
   * userId, ipAddress and userAgent come from the request, never from the body:
   * anything self-reported here would let a caller attribute events to another
   * user and poison the rankings built on top of them.
   */
  private static normalise(
    input: AnalyticsEventInput,
    context: AnalyticsRequestContext,
  ): AnalyticsEventPayload {
    // A client clock can be wrong or hostile. Accept a supplied occurredAt only
    // if it parses and is not in the future; otherwise use receipt time.
    const now = new Date();
    const supplied = input.occurredAt ? new Date(input.occurredAt) : null;
    const usable = supplied && !Number.isNaN(supplied.getTime()) && supplied <= now;

    return {
      eventType: input.eventType,
      userId: context.userId ?? null,
      sessionId: input.sessionId ?? null,
      storeId: input.storeId ?? null,
      productId: input.productId ?? null,
      categoryId: input.categoryId ?? null,
      metadata: input.metadata ?? null,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
      occurredAt: (usable ? supplied : now).toISOString(),
    };
  }

  /**
   * Accept a batch of events and get them off the request path.
   *
   * Publishing is best-effort: if RabbitMQ is unreachable the events are written
   * straight to the database instead. That is slower and defeats the batching,
   * but silently dropping behavioural data is worse — the whole point of the
   * event log is that it is the record other features get built on. Only if
   * *both* paths fail does the caller see an error.
   */
  static async record(
    inputs: AnalyticsEventInput[],
    context: AnalyticsRequestContext,
  ): Promise<RecordResult> {
    const payloads = inputs.map((input) => AnalyticsService.normalise(input, context));

    const published = await Promise.all(
      payloads.map((payload) => rabbitmq.publish(ROUTING_KEYS.ANALYTICS_EVENT_RECORDED, payload)),
    );

    const failed = payloads.filter((_, i) => !published[i]);
    if (failed.length === 0) {
      return { accepted: payloads.length, transport: 'queued' };
    }

    logger.warn(
      `[Analytics] ${failed.length}/${payloads.length} event(s) could not be queued — writing directly.`,
    );

    // Let this throw — the controller hands it to the global error middleware.
    await AnalyticsRepository.createMany(failed);

    return { accepted: payloads.length, transport: 'direct' };
  }
}
