import StoreService from '../../src/modules/stores/store.service';
import { prisma } from '../../src/utils/prisma';
import { REJECTED_STORE_TTL_MS } from '../../src/modules/adminApprovals/storeApproval.service';

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    stores: { findMany: jest.fn() },
    sellerOrganizationMembers: { findMany: jest.fn(), update: jest.fn() },
  },
}));

jest.mock('../../src/infrastructure/socket', () => ({
  emitStoreUpserted: jest.fn(),
  emitStoreRemoved: jest.fn(),
}));

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockPrisma = prisma as unknown as {
  $transaction: jest.Mock;
  stores: { findMany: jest.Mock };
  sellerOrganizationMembers: { findMany: jest.Mock; update: jest.Mock };
};

/**
 * The 24-hour sweep.
 *
 * `now` is injected throughout rather than faked with timers: the window is the
 * thing under test, and a test that has to wait a day to prove it is no test.
 */
describe('StoreService.purgeExpiredRejectedStores', () => {
  const NOW = new Date('2026-09-09T12:00:00.000Z');

  let tx: {
    stores: { updateMany: jest.Mock };
    auditLogs: { createMany: jest.Mock };
  };

  beforeEach(() => {
    jest.clearAllMocks();

    tx = {
      stores: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLogs: { createMany: jest.fn() },
    };

    mockPrisma.$transaction.mockImplementation((fn: (client: typeof tx) => unknown) => fn(tx));
    mockPrisma.sellerOrganizationMembers.findMany.mockResolvedValue([]);
  });

  it('asks only for rejected, undeleted stores past the cutoff', async () => {
    mockPrisma.stores.findMany.mockResolvedValue([]);

    await StoreService.purgeExpiredRejectedStores(NOW);

    expect(mockPrisma.stores.findMany).toHaveBeenCalledWith({
      where: {
        approvalStatus: 'REJECTED',
        deletedAt: null,
        rejectedAt: { lte: new Date(NOW.getTime() - REJECTED_STORE_TTL_MS) },
      },
      select: { id: true, sellerId: true, storeLocations: true },
    });
  });

  it('deletes a store rejected longer ago than the deletion window', async () => {
    mockPrisma.stores.findMany.mockResolvedValue([
      { id: 'store-old', sellerId: 'org-1', storeLocations: null },
    ]);

    const purged = await StoreService.purgeExpiredRejectedStores(NOW);

    expect(purged).toBe(1);
    expect(tx.stores.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['store-old'] }, approvalStatus: 'REJECTED', deletedAt: null },
      data: { deletedAt: NOW, isActive: false },
    });
  });

  // The cutoff is the database's filter, so "still inside the window" shows up
  // here as the query returning nothing — and the sweep must then not write.
  it('leaves a store still inside the deletion window alone', async () => {
    mockPrisma.stores.findMany.mockResolvedValue([]);

    const purged = await StoreService.purgeExpiredRejectedStores(NOW);

    expect(purged).toBe(0);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('attributes the deletion to the expiry, with no actor', async () => {
    mockPrisma.stores.findMany.mockResolvedValue([
      { id: 'store-old', sellerId: 'org-1', storeLocations: null },
    ]);

    await StoreService.purgeExpiredRejectedStores(NOW);

    expect(tx.auditLogs.createMany).toHaveBeenCalledWith({
      data: [
        {
          performedById: null,
          action: 'STORE_DELETED',
          entityType: 'STORE',
          entityId: 'store-old',
          metadata: { reason: 'REJECTION_EXPIRED' },
        },
      ],
    });
  });

  // Safe to run repeatedly: the second pass in the same hour matches nothing,
  // because `deletedAt: null` is part of the compare-and-set.
  it('reports zero when another run already took the rows', async () => {
    mockPrisma.stores.findMany.mockResolvedValue([
      { id: 'store-old', sellerId: 'org-1', storeLocations: null },
    ]);
    tx.stores.updateMany.mockResolvedValue({ count: 0 });

    const purged = await StoreService.purgeExpiredRejectedStores(NOW);

    expect(purged).toBe(0);
    expect(mockPrisma.sellerOrganizationMembers.findMany).not.toHaveBeenCalled();
  });

  it("rewrites each organization's assignment lists once per sweep", async () => {
    mockPrisma.stores.findMany.mockResolvedValue([
      { id: 'store-a', sellerId: 'org-1', storeLocations: null },
      { id: 'store-b', sellerId: 'org-1', storeLocations: null },
      { id: 'store-c', sellerId: 'org-2', storeLocations: null },
    ]);
    tx.stores.updateMany.mockResolvedValue({ count: 3 });

    await StoreService.purgeExpiredRejectedStores(NOW);

    expect(mockPrisma.sellerOrganizationMembers.findMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.sellerOrganizationMembers.findMany).toHaveBeenCalledWith({
      where: { sellerId: 'org-1', assignedStoreIds: { hasSome: ['store-a', 'store-b'] } },
      select: { id: true, assignedStoreIds: true },
    });
  });
});
