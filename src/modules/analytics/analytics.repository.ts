import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { AnalyticsEventPayload } from './analytics.types';

/** Wire payload → the row shape Prisma expects. */
const toRow = (event: AnalyticsEventPayload): Prisma.AnalyticsEventsCreateManyInput => ({
  eventType: event.eventType,
  userId: event.userId,
  sessionId: event.sessionId,
  storeId: event.storeId,
  productId: event.productId,
  categoryId: event.categoryId,
  metadata: (event.metadata ?? Prisma.JsonNull) as Prisma.InputJsonValue,
  ipAddress: event.ipAddress,
  userAgent: event.userAgent,
  occurredAt: new Date(event.occurredAt),
});

export default class AnalyticsRepository {
  /**
   * Batch-insert events.
   *
   * `createMany` issues a single multi-row INSERT, which is the whole point of
   * routing events through a queue — see docs/analytics-evaluation.md on
   * avoiding one write per page view.
   */
  static async createMany(events: AnalyticsEventPayload[]): Promise<number> {
    if (events.length === 0) return 0;

    const result = await prisma.analyticsEvents.createMany({
      data: events.map(toRow),
    });
    return result.count;
  }

  /** Single insert, used only by the degraded path when the queue is unreachable. */
  static async create(event: AnalyticsEventPayload): Promise<void> {
    await prisma.analyticsEvents.create({ data: toRow(event) });
  }
}
