import ProductRepository from '../../src/modules/products/product.repository';
import AnalyticsRepository from '../../src/modules/analytics/analytics.repository';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    products: { findMany: jest.fn(), count: jest.fn() },
  },
}));

jest.mock('../../src/modules/analytics/analytics.repository', () => ({
  __esModule: true,
  default: {
    getTrending: jest.fn(),
    getMostViewed: jest.fn(),
  },
}));

const mockTransaction = prisma.$transaction as jest.Mock;
const mockGetTrending = AnalyticsRepository.getTrending as jest.Mock;
const mockGetMostViewed = AnalyticsRepository.getMostViewed as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

const makeProduct = (
  id: string,
  price: number,
  storeLoc?: { latitude: number; longitude: number },
) => ({
  id,
  name: `Product ${id}`,
  price,
  isActive: true,
  category: null,
  tags: [],
  options: [],
  productImages: [],
  merchantAdLinks: [],
  store: {
    id: `store-${id}`,
    storeName: `Store ${id}`,
    storeLocations: storeLoc ?? null,
  },
});

describe('ProductRepository.getAllProducts sorting', () => {
  it('sorts by proximity when center coordinates and sortBy=proximity are provided', async () => {
    // Center: Manila (14.5995, 120.9842)
    // Store 1: close (14.6000, 120.9850) ~ 0.1km
    // Store 2: farther (14.7000, 121.0000) ~ 11km
    const pFar = makeProduct('far', 100, { latitude: 14.7, longitude: 121.0 });
    const pNear = makeProduct('near', 100, { latitude: 14.6, longitude: 120.985 });

    mockTransaction.mockResolvedValueOnce([[pFar, pNear], 2]);

    const result = await ProductRepository.getAllProducts({
      sortBy: 'proximity',
      centerLat: 14.5995,
      centerLng: 120.9842,
      skip: 0,
      take: 10,
    });

    expect(result.items[0].id).toBe('near');
    expect(result.items[1].id).toBe('far');
    expect(result.items[0].distanceKm).toBeLessThan(result.items[1].distanceKm!);
  });

  it('sorts by trending rank when sortBy=trending is provided', async () => {
    const p1 = makeProduct('p1', 100);
    const p2 = makeProduct('p2', 200);

    mockTransaction.mockResolvedValueOnce([[p1, p2], 2]);
    mockGetTrending.mockResolvedValueOnce([
      { id: 'p2', score: 50 },
      { id: 'p1', score: 10 },
    ]);

    const result = await ProductRepository.getAllProducts({
      sortBy: 'trending',
      skip: 0,
      take: 10,
    });

    expect(result.items[0].id).toBe('p2');
    expect(result.items[1].id).toBe('p1');
  });

  it('sorts by most_viewed rank when sortBy=most_viewed is provided', async () => {
    const p1 = makeProduct('p1', 100);
    const p2 = makeProduct('p2', 200);

    mockTransaction.mockResolvedValueOnce([[p1, p2], 2]);
    mockGetMostViewed.mockResolvedValueOnce([
      { id: 'p2', score: 500 },
      { id: 'p1', score: 100 },
    ]);

    const result = await ProductRepository.getAllProducts({
      sortBy: 'most_viewed',
      skip: 0,
      take: 10,
    });

    expect(result.items[0].id).toBe('p2');
    expect(result.items[1].id).toBe('p1');
  });
});
