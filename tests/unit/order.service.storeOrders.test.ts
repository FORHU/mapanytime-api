import OrderService from '../../src/modules/orders/order.service';
import OrderRepository, {
  StoreOrdersPageQuery,
  StoreOrderStatsResult,
} from '../../src/modules/orders/order.repository';
import { prisma } from '../../src/utils/prisma';
import type { AuthUser } from '../../src/modules/auth/auth.repository';

jest.mock('../../src/modules/orders/order.repository');
jest.mock('../../src/infrastructure/socket', () => ({
  emitNotificationToUser: jest.fn(),
}));
jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    sellers: { findUnique: jest.fn() },
    stores: { findMany: jest.fn() },
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
  stores: { findMany: jest.Mock };
};

const SELLER = {
  id: 'seller-1',
  userId: 'user-1',
  stores: [{ id: 'store-1' }, { id: 'store-2' }],
};

/**
 * A seller who owns their stores outright and belongs to no organization —
 * the pre-organization shape, which must keep working.
 */
const OWNER = {
  id: 'user-1',
  orgMemberships: [],
  seller: { sellerOrganizationId: null },
} as unknown as AuthUser;

/**
 * Organization staff: no stores of their own, two assigned to them. This is the
 * shape that used to be refused outright — `resolveSellerStoreIds` only ever
 * looked at directly-owned stores, so a seller_user could not read orders for
 * the stores they were explicitly given.
 */
const STAFF = {
  id: 'user-2',
  orgMemberships: [
    {
      sellerOrganizationId: 'org-1',
      role: 'SELLER_USER',
      assignedStores: [{ storeId: 'store-1' }, { storeId: 'store-2' }],
    },
  ],
  seller: null,
} as unknown as AuthUser;

describe('OrderService.getStoreOrders — server-side pagination', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.sellers.findUnique.mockResolvedValue(SELLER);
    mockedPrisma.stores.findMany.mockResolvedValue([]);
  });

  const query = { page: 2, limit: 20, skip: 20 };

  it('returns a page envelope and forwards filter params to the repository', async () => {
    mockedRepo.getStoreOrdersPage.mockResolvedValue({
      items: [{ id: 'order-1' }],
      total: 41,
    });

    const result = await OrderService.getStoreOrders(OWNER, 'store-1', {
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

    await OrderService.getStoreOrders(OWNER, 'ALL', query);
    expect(mockedRepo.getStoreOrdersPage).toHaveBeenCalledWith(
      ['store-1', 'store-2'],
      expect.anything(),
    );

    await OrderService.getStoreOrders(OWNER, undefined, query);
    expect(mockedRepo.getStoreOrdersPage).toHaveBeenCalledWith(
      ['store-1', 'store-2'],
      expect.anything(),
    );
  });

  it('rejects with 404 when the store is outside the caller scope', async () => {
    // 404 rather than 403 so a store id outside the caller's scope is
    // indistinguishable from one that does not exist, matching the rest of the
    // seller-organization code. The old message also contained the word
    // "unauthorized", which the web fetcher mistook for a dead session and
    // retried behind a token refresh forever.
    await expect(OrderService.getStoreOrders(OWNER, 'store-foreign', query)).rejects.toMatchObject({
      status: 404,
    });
    expect(mockedRepo.getStoreOrdersPage).not.toHaveBeenCalled();
  });

  it('rejects with 403 for a user who is neither a seller nor an org member', async () => {
    mockedPrisma.sellers.findUnique.mockResolvedValue(null);

    await expect(OrderService.getStoreOrders(OWNER, 'store-1', query)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('resolves assigned stores for org staff who own none', async () => {
    // The regression guard. STAFF has no `Sellers` row at all, so the legacy
    // owner lookup yields nothing; the stores come from the org scope.
    mockedPrisma.sellers.findUnique.mockResolvedValue(null);
    mockedPrisma.stores.findMany.mockResolvedValue([{ id: 'store-1' }, { id: 'store-2' }]);
    mockedRepo.getStoreOrdersPage.mockResolvedValue({ items: [], total: 0 });

    await OrderService.getStoreOrders(STAFF, 'store-1', query);

    expect(mockedRepo.getStoreOrdersPage).toHaveBeenCalledWith(['store-1'], expect.anything());
  });

  it('still refuses a store the org member was not assigned', async () => {
    mockedPrisma.sellers.findUnique.mockResolvedValue(null);
    mockedPrisma.stores.findMany.mockResolvedValue([{ id: 'store-1' }, { id: 'store-2' }]);

    await expect(OrderService.getStoreOrders(STAFF, 'store-9', query)).rejects.toMatchObject({
      status: 404,
    });
    expect(mockedRepo.getStoreOrdersPage).not.toHaveBeenCalled();
  });
});

describe('OrderService.getStoreOrderStats', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.sellers.findUnique.mockResolvedValue(SELLER);
    mockedPrisma.stores.findMany.mockResolvedValue([]);
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

    const stats = await OrderService.getStoreOrderStats(OWNER, 'store-1');

    expect(mockedRepo.getStoreOrderStats).toHaveBeenCalledWith(['store-1']);
    expect(stats).toEqual({
      totalRevenue: 15250.5,
      pendingCount: 6, // PENDING + PROCESSING + READY_FOR_PICKUP
      fulfilledCount: 3, // COMPLETED
      statusCounts: expect.objectContaining({ ALL: 10, CANCELLED: 1 }),
      lowStockCount: 4,
    });
  });

  it('rejects with 404 when the store is outside the caller scope', async () => {
    await expect(OrderService.getStoreOrderStats(OWNER, 'store-foreign')).rejects.toMatchObject({
      status: 404,
    });
    expect(mockedRepo.getStoreOrderStats).not.toHaveBeenCalled();
  });
});
