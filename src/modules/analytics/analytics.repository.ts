import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { AnalyticsEventPayload } from './analytics.types';

export interface ProductRollupSummary {
  productId: string;
  views: number;
  clicks: number;
  cartAdds: number;
  orders: number;
}

export interface StoreRollupSummary {
  storeId: string;
  views: number;
  clicks: number;
  cartAdds: number;
  orders: number;
}

export interface RankedItem {
  id: string;
  score: number;
}

/** Wire payload → the row shape Prisma expects. */
const toRow = (
  event: AnalyticsEventPayload,
  eventId?: string,
): Prisma.AnalyticsEventsCreateManyInput => ({
  eventId: eventId ?? null,
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
   *
   * `eventIds` lines up with `events`. A row whose event id is already stored
   * is skipped, so a batch SQS delivers twice is written once.
   */
  static async createMany(
    events: AnalyticsEventPayload[],
    eventIds: (string | undefined)[] = [],
  ): Promise<number> {
    if (events.length === 0) return 0;

    const result = await prisma.analyticsEvents.createMany({
      data: events.map((event, i) => toRow(event, eventIds[i])),
      skipDuplicates: true,
    });
    return result.count;
  }

  /** Single insert, used only by the degraded path when the queue is unreachable. */
  static async create(event: AnalyticsEventPayload): Promise<void> {
    await prisma.analyticsEvents.create({ data: toRow(event) });
  }

  /**
   * Aggregate product events across a time window with session deduplication on views.
   */
  static async aggregateProductRollups(
    startDate: Date,
    endDate: Date,
  ): Promise<ProductRollupSummary[]> {
    const rows = await prisma.$queryRaw<ProductRollupSummary[]>`
      SELECT
        "productId",
        COUNT(DISTINCT CASE WHEN "eventType"::text = 'PRODUCT_VIEW' THEN COALESCE("sessionId", "id") END)::int AS "views",
        COUNT(CASE WHEN "eventType"::text = 'PRODUCT_CLICK' THEN 1 END)::int AS "clicks",
        COUNT(CASE WHEN "eventType"::text = 'ADD_TO_CART' THEN 1 END)::int AS "cartAdds",
        COUNT(CASE WHEN "eventType"::text = 'ORDER_COMPLETED' THEN 1 END)::int AS "orders"
      FROM "AnalyticsEvents"
      WHERE "occurredAt" >= ${startDate} AND "occurredAt" <= ${endDate} AND "productId" IS NOT NULL
      GROUP BY "productId"
    `;
    return rows;
  }

  /**
   * Aggregate store events across a time window with session deduplication on views.
   */
  static async aggregateStoreRollups(
    startDate: Date,
    endDate: Date,
  ): Promise<StoreRollupSummary[]> {
    const rows = await prisma.$queryRaw<StoreRollupSummary[]>`
      SELECT
        "storeId",
        COUNT(DISTINCT CASE WHEN "eventType"::text = 'STORE_VIEW' THEN COALESCE("sessionId", "id") END)::int AS "views",
        COUNT(CASE WHEN "eventType"::text = 'PRODUCT_CLICK' THEN 1 END)::int AS "clicks",
        COUNT(CASE WHEN "eventType"::text = 'ADD_TO_CART' THEN 1 END)::int AS "cartAdds",
        COUNT(CASE WHEN "eventType"::text = 'ORDER_COMPLETED' THEN 1 END)::int AS "orders"
      FROM "AnalyticsEvents"
      WHERE "occurredAt" >= ${startDate} AND "occurredAt" <= ${endDate} AND "storeId" IS NOT NULL
      GROUP BY "storeId"
    `;
    return rows;
  }

  /**
   * Persist daily rollups into AnalyticsDailyRollups (idempotent via unique constraint).
   */
  static async saveDailyRollups(
    date: Date,
    productRollups: ProductRollupSummary[],
    storeRollups: StoreRollupSummary[],
  ): Promise<number> {
    const records: Prisma.AnalyticsDailyRollupsCreateManyInput[] = [
      ...productRollups.map((r) => ({
        date,
        targetType: 'PRODUCT',
        targetId: r.productId,
        views: r.views,
        clicks: r.clicks,
        cartAdds: r.cartAdds,
        orders: r.orders,
      })),
      ...storeRollups.map((r) => ({
        date,
        targetType: 'STORE',
        targetId: r.storeId,
        views: r.views,
        clicks: r.clicks,
        cartAdds: r.cartAdds,
        orders: r.orders,
      })),
    ];

    if (records.length === 0) return 0;

    const result = await prisma.analyticsDailyRollups.createMany({
      data: records,
      skipDuplicates: true,
    });
    return result.count;
  }

  /**
   * Most-viewed ranking over the past N days.
   * Reads from daily rollups; falls back to raw events if no rollups exist yet.
   */
  static async getMostViewed(
    targetType: 'PRODUCT' | 'STORE',
    days = 7,
    limit = 20,
  ): Promise<RankedItem[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await prisma.$queryRaw<Array<{ targetId: string; score: number }>>`
      SELECT "targetId", SUM("views")::int AS "score"
      FROM "AnalyticsDailyRollups"
      WHERE "targetType" = ${targetType} AND "date" >= ${since}
      GROUP BY "targetId"
      ORDER BY "score" DESC
      LIMIT ${limit}
    `;

    if (rows.length > 0) {
      return rows.map((r) => ({ id: r.targetId, score: Number(r.score) }));
    }

    const eventType = targetType === 'PRODUCT' ? 'PRODUCT_VIEW' : 'STORE_VIEW';
    const col = targetType === 'PRODUCT' ? Prisma.sql`"productId"` : Prisma.sql`"storeId"`;
    const eventRows = await prisma.$queryRaw<Array<{ id: string; score: number }>>`
      SELECT ${col} AS "id", COUNT(DISTINCT COALESCE("sessionId", "id"))::int AS "score"
      FROM "AnalyticsEvents"
      WHERE "eventType"::text = ${eventType} AND "occurredAt" >= ${since} AND ${col} IS NOT NULL
      GROUP BY ${col}
      ORDER BY "score" DESC
      LIMIT ${limit}
    `;
    return eventRows.map((r) => ({ id: r.id, score: Number(r.score) }));
  }

  /**
   * Trending ranking over recent hours (default 24h) from raw events.
   */
  static async getTrending(
    targetType: 'PRODUCT' | 'STORE',
    hours = 24,
    limit = 20,
  ): Promise<RankedItem[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const eventType = targetType === 'PRODUCT' ? 'PRODUCT_VIEW' : 'STORE_VIEW';
    const col = targetType === 'PRODUCT' ? Prisma.sql`"productId"` : Prisma.sql`"storeId"`;
    const rows = await prisma.$queryRaw<Array<{ id: string; score: number }>>`
      SELECT ${col} AS "id", COUNT(DISTINCT COALESCE("sessionId", "id"))::int AS "score"
      FROM "AnalyticsEvents"
      WHERE "eventType"::text = ${eventType} AND "occurredAt" >= ${since} AND ${col} IS NOT NULL
      GROUP BY ${col}
      ORDER BY "score" DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({ id: r.id, score: Number(r.score) }));
  }
}
