import AnalyticsRepository from '../../src/modules/analytics/analytics.repository';
import { prisma } from '../../src/utils/prisma';
import { AnalyticsEventPayload } from '../../src/modules/analytics/analytics.types';

jest.mock('../../src/utils/prisma', () => ({
  prisma: { analyticsEvents: { createMany: jest.fn().mockResolvedValue({ count: 1 }) } },
}));

const createMany = prisma.analyticsEvents.createMany as jest.Mock;

const event: AnalyticsEventPayload = {
  eventType: 'PRODUCT_VIEW' as AnalyticsEventPayload['eventType'],
  userId: null,
  sessionId: 's1',
  storeId: null,
  productId: 'p1',
  categoryId: null,
  metadata: null,
  ipAddress: null,
  userAgent: null,
  occurredAt: '2026-10-15T00:00:00.000Z',
};

beforeEach(() => jest.clearAllMocks());

describe('AnalyticsRepository.createMany', () => {
  it('stores each event id and skips rows already written, so a redelivery adds nothing', async () => {
    await AnalyticsRepository.createMany([event, event], ['e1', 'e2']);

    const args = createMany.mock.calls[0][0];
    expect(args.skipDuplicates).toBe(true);
    expect(args.data.map((r: { eventId?: string }) => r.eventId)).toEqual(['e1', 'e2']);
  });

  it('writes events without ids (the direct fallback path) with a null event id', async () => {
    await AnalyticsRepository.createMany([event]);

    expect(createMany.mock.calls[0][0].data[0].eventId).toBeNull();
  });
});
