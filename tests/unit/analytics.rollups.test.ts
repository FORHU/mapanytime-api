import AnalyticsRepository from '../../src/modules/analytics/analytics.repository';
import AnalyticsService from '../../src/modules/analytics/analytics.service';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    analyticsDailyRollups: {
      createMany: jest.fn(),
    },
  },
}));

const mockQueryRaw = prisma.$queryRaw as jest.Mock;
const mockCreateMany = prisma.analyticsDailyRollups.createMany as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AnalyticsRepository.aggregateProductRollups & aggregateStoreRollups', () => {
  it('calls queryRaw with proper date ranges for product rollups', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { productId: 'p1', views: 10, clicks: 5, cartAdds: 2, orders: 1 },
    ]);

    const start = new Date('2026-10-18T00:00:00.000Z');
    const end = new Date('2026-10-18T23:59:59.999Z');
    const result = await AnalyticsRepository.aggregateProductRollups(start, end);

    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ productId: 'p1', views: 10, clicks: 5, cartAdds: 2, orders: 1 }]);
  });

  it('calls queryRaw with proper date ranges for store rollups', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { storeId: 's1', views: 15, clicks: 3, cartAdds: 1, orders: 1 },
    ]);

    const start = new Date('2026-10-18T00:00:00.000Z');
    const end = new Date('2026-10-18T23:59:59.999Z');
    const result = await AnalyticsRepository.aggregateStoreRollups(start, end);

    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ storeId: 's1', views: 15, clicks: 3, cartAdds: 1, orders: 1 }]);
  });
});

describe('AnalyticsRepository.saveDailyRollups', () => {
  it('saves product and store rollups with skipDuplicates', async () => {
    mockCreateMany.mockResolvedValueOnce({ count: 2 });

    const date = new Date('2026-10-18T00:00:00.000Z');
    const count = await AnalyticsRepository.saveDailyRollups(
      date,
      [{ productId: 'p1', views: 5, clicks: 1, cartAdds: 0, orders: 0 }],
      [{ storeId: 's1', views: 8, clicks: 2, cartAdds: 1, orders: 1 }],
    );

    expect(count).toBe(2);
    expect(mockCreateMany).toHaveBeenCalledWith({
      data: [
        {
          date,
          targetType: 'PRODUCT',
          targetId: 'p1',
          views: 5,
          clicks: 1,
          cartAdds: 0,
          orders: 0,
        },
        {
          date,
          targetType: 'STORE',
          targetId: 's1',
          views: 8,
          clicks: 2,
          cartAdds: 1,
          orders: 1,
        },
      ],
      skipDuplicates: true,
    });
  });

  it('returns 0 immediately if there are no records to save', async () => {
    const count = await AnalyticsRepository.saveDailyRollups(new Date(), [], []);
    expect(count).toBe(0);
    expect(mockCreateMany).not.toHaveBeenCalled();
  });
});

describe('AnalyticsRepository.getMostViewed & getTrending', () => {
  it('returns most viewed from rollups when available', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { targetId: 'p1', score: 100 },
      { targetId: 'p2', score: 50 },
    ]);

    const result = await AnalyticsRepository.getMostViewed('PRODUCT', 7, 10);
    expect(result).toEqual([
      { id: 'p1', score: 100 },
      { id: 'p2', score: 50 },
    ]);
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it('falls back to raw AnalyticsEvents if no rollups exist', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([]) // from rollups
      .mockResolvedValueOnce([{ id: 'p3', score: 12 }]); // fallback

    const result = await AnalyticsRepository.getMostViewed('PRODUCT', 7, 10);
    expect(result).toEqual([{ id: 'p3', score: 12 }]);
    expect(mockQueryRaw).toHaveBeenCalledTimes(2);
  });

  it('returns trending items from raw events in the recent window', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { id: 'p1', score: 30 },
      { id: 'p2', score: 20 },
    ]);

    const result = await AnalyticsRepository.getTrending('PRODUCT', 24, 10);
    expect(result).toEqual([
      { id: 'p1', score: 30 },
      { id: 'p2', score: 20 },
    ]);
  });
});

describe('AnalyticsService.generateDailyRollups', () => {
  it('aggregates both products and stores and persists them', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([{ productId: 'p1', views: 10, clicks: 2, cartAdds: 1, orders: 1 }])
      .mockResolvedValueOnce([{ storeId: 's1', views: 20, clicks: 4, cartAdds: 2, orders: 2 }]);
    mockCreateMany.mockResolvedValueOnce({ count: 2 });

    const targetDate = new Date('2026-10-18T12:00:00.000Z');
    const count = await AnalyticsService.generateDailyRollups(targetDate);

    expect(count).toBe(2);
    expect(mockCreateMany).toHaveBeenCalledTimes(1);
  });
});
