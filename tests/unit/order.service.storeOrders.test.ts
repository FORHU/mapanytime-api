import OrderService from '../../src/modules/orders/order.service';
import OrderRepository, {
  StoreOrdersPageQuery,
  StoreOrderStatsResult,
} from '../../src/modules/orders/order.repository';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/modules/orders/order.repository');
jest.mock('../../src/infrastructure/socket', () => ({
  emitNotificationToUser: jest.fn(),
}));
jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    sellers: { findUnique: jest.fn() },
  },
}));

type StoreOrderRow = Awaited<
  ReturnType<typeof OrderRepository.getStoreOrdersPage>
>['items'][number];

const mockedRepo = OrderRepository as unknown as {
  getStoreOrdersPage: jest.Mock<
    Promise<{ items: Array<Partial<StoreOrderRow>>; total: number }>,
    [string[], StoreOrdersPageQuery]
  >;
  getStoreOrderStats: jest.Mock<Promise<StoreOrderStatsResult>>;
};
const mockedPrisma = prisma as unknown as {
  sellers: { findUnique: jest.Mock };
};

const SELLER = {
  id: 'seller-1',
  userId: 'user-1',
  stores: [{ id: 'store-1' }, { id: 'store-2' }],
};

describe('OrderService.getStoreOrders — server-side pagination', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.sellers.findUnique.mockResolvedValue(SELLER);
  });

  const query = { page: 2, limit: 20, skip: 20 };

  it('returns a page envelope and forwards filter params to the repository', async () => {
    mockedRepo.getStoreOrdersPage.mockResolvedValue({
      items: [{ id: 'order-1' }],
      total: 41,
    });

    const result = await OrderService.getStoreOrders('user-1', 'store-1', {
      ...query,
      status: 'PENDING',
      search: 'widget',
      sortOrder: 'asc',
    });

    expect(mockedRepo.getStoreOrdersPage).toHaveBeenCalledWith(['store-1'], {
      status: 'PENDING',
      search: 'widget',
      sortOrder: 'asc',
      skip: 20,
      take: 20,
    });
    expect(result).toMatchObject({
      items: [{ id: 'order-1' }],
      total: 41,
      page: 2,
      limit: 20,
      totalPages: 3,
    });
  });

  it('scopes to all seller stores when storeId is ALL or omitted', async () => {
    mockedRepo.getStoreOrdersPage.mockResolvedValue({ items: [], total: 0 });

    await OrderService.getStoreOrders('user-1', 'ALL', query);
    expect(mockedRepo.getStoreOrdersPage).toHaveBeenCalledWith(
      ['store-1', 'store-2'],
      expect.anything(),
    );

    await OrderService.getStoreOrders('user-1', undefined, query);
    expect(mockedRepo.getStoreOrdersPage).toHaveBeenCalledWith(
      ['store-1', 'store-2'],
      expect.anything(),
    );
  });

  it('rejects with 403 when the store is not owned by the seller', async () => {
    await expect(
      OrderService.getStoreOrders('user-1', 'store-foreign', query),
    ).rejects.toMatchObject({ status: 403 });
    expect(mockedRepo.getStoreOrdersPage).not.toHaveBeenCalled();
  });

  it('rejects with 403 for non-sellers', async () => {
    mockedPrisma.sellers.findUnique.mockResolvedValue(null);

    await expect(OrderService.getStoreOrders('user-1', 'store-1', query)).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe('OrderService.getStoreOrderStats', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.sellers.findUnique.mockResolvedValue(SELLER);
  });

  it('derives pending/fulfilled counts from DB status counts', async () => {
    mockedRepo.getStoreOrderStats.mockResolvedValue({
      totalRevenue: 15250.5,
      statusCounts: {
        ALL: 10,
        PENDING: 2,
        PROCESSING: 1,
        READY_FOR_PICKUP: 3,
        COMPLETED: 3,
        CANCELLED: 1,
        FAILED: 0,
      },
      lowStockCount: 4,
    });

    const stats = await OrderService.getStoreOrderStats('user-1', 'store-1');

    expect(mockedRepo.getStoreOrderStats).toHaveBeenCalledWith(['store-1']);
    expect(stats).toEqual({
      totalRevenue: 15250.5,
      pendingCount: 6, // PENDING + PROCESSING + READY_FOR_PICKUP
      fulfilledCount: 3, // COMPLETED
      statusCounts: expect.objectContaining({ ALL: 10, CANCELLED: 1 }),
      lowStockCount: 4,
    });
  });

  it('rejects with 403 when the store is not owned by the seller', async () => {
    await expect(OrderService.getStoreOrderStats('user-1', 'store-foreign')).rejects.toMatchObject({
      status: 403,
    });
    expect(mockedRepo.getStoreOrderStats).not.toHaveBeenCalled();
  });
});
