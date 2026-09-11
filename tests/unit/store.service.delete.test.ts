import StoreService from '../../src/modules/stores/store.service';
import StoreRepository from '../../src/modules/stores/store.repository';
import { REJECTED_STORE_TTL_MS } from '../../src/modules/adminApprovals/storeApproval.service';
import { prisma } from '../../src/utils/prisma';
import { emitStoreRemoved } from '../../src/infrastructure/socket';
import type { OrgContext } from '../../src/modules/organization/orgContext';
import { ALL_SELLER_FEATURES } from '../../src/modules/organization/sellerPermissions.constant';

jest.mock('../../src/modules/stores/store.repository');

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
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
  sellerOrganizationMembers: { findMany: jest.Mock; update: jest.Mock };
};

/**
 * Manual deletion of a rejected store.
 *
 * The status rule is the point of the whole suite: the seller UI only shows the
 * button on a REJECTED card, but the endpoint is reachable directly, so every
 * other status has to be refused here rather than hidden there.
 */
describe('StoreService.deleteRejectedStore', () => {
  const admin: OrgContext = {
    organizationId: 'org-1',
    role: 'SELLER_ADMIN',
    isAdmin: true,
    isOwner: true,
    assignedStoreIds: null,
    permissions: [...ALL_SELLER_FEATURES],
    sellerStatus: 'APPROVED',
  };

  const rejectedStore = {
    id: 'store-1',
    sellerId: 'org-1',
    storeName: 'Rejected Store',
    approvalStatus: 'REJECTED' as const,
    storeLocations: { latitude: 16.4, longitude: 120.6 },
  };

  let tx: {
    stores: { updateMany: jest.Mock };
    auditLogs: { create: jest.Mock };
  };

  beforeEach(() => {
    jest.clearAllMocks();

    tx = {
      stores: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLogs: { create: jest.fn() },
    };

    mockPrisma.$transaction.mockImplementation((fn: (client: typeof tx) => unknown) => fn(tx));
    mockPrisma.sellerOrganizationMembers.findMany.mockResolvedValue([]);
    (StoreRepository.getStoreById as jest.Mock).mockResolvedValue(rejectedStore);
  });

  it('soft-deletes a rejected store rather than removing the row', async () => {
    const result = await StoreService.deleteRejectedStore(admin, 'store-1', 'user-1');

    expect(result).toEqual({ id: 'store-1' });
    expect(tx.stores.updateMany).toHaveBeenCalledWith({
      where: { id: 'store-1', approvalStatus: 'REJECTED', deletedAt: null },
      data: { deletedAt: expect.any(Date), isActive: false },
    });
  });

  it('records who deleted it and why', async () => {
    await StoreService.deleteRejectedStore(admin, 'store-1', 'user-1');

    expect(tx.auditLogs.create).toHaveBeenCalledWith({
      data: {
        performedById: 'user-1',
        action: 'STORE_DELETED',
        entityType: 'STORE',
        entityId: 'store-1',
        metadata: { reason: 'SELLER_DELETED_REJECTED' },
      },
    });
  });

  // The status guard, one case per status the transition matrix can produce.
  it.each(['PENDING', 'UNDER_REVIEW', 'NEEDS_REVISION', 'ACTIVE'] as const)(
    'refuses to delete a %s store',
    async (approvalStatus) => {
      (StoreRepository.getStoreById as jest.Mock).mockResolvedValue({
        ...rejectedStore,
        approvalStatus,
      });

      await expect(
        StoreService.deleteRejectedStore(admin, 'store-1', 'user-1'),
      ).rejects.toMatchObject({
        status: 409,
        code: 'STORE_NOT_REJECTED',
        message: 'Only rejected stores can be deleted.',
      });

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    },
  );

  // 404 rather than 403 throughout: an out-of-scope store must be
  // indistinguishable from one that does not exist, or ids can be probed.
  it("refuses another organization's store with a 404", async () => {
    (StoreRepository.getStoreById as jest.Mock).mockResolvedValue({
      ...rejectedStore,
      sellerId: 'org-2',
    });

    await expect(StoreService.deleteRejectedStore(admin, 'store-1', 'user-1')).rejects.toEqual({
      status: 404,
      message: 'Store not found.',
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a store outside a staff member's assigned set", async () => {
    const staff: OrgContext = {
      ...admin,
      role: 'SELLER_MEMBER',
      isAdmin: false,
      isOwner: false,
      assignedStoreIds: ['store-other'],
    };

    await expect(StoreService.deleteRejectedStore(staff, 'store-1', 'user-1')).rejects.toEqual({
      status: 404,
      message: 'Store not found.',
    });
  });

  it('refuses a store that no longer exists', async () => {
    (StoreRepository.getStoreById as jest.Mock).mockResolvedValue(null);

    await expect(StoreService.deleteRejectedStore(admin, 'store-1', 'user-1')).rejects.toEqual({
      status: 404,
      message: 'Store not found.',
    });
  });

  // An admin reopening the store for appeal in the same instant must win.
  it('reports a conflict when the status changed mid-request', async () => {
    tx.stores.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      StoreService.deleteRejectedStore(admin, 'store-1', 'user-1'),
    ).rejects.toMatchObject({ status: 409, code: 'CONCURRENT_MODIFICATION' });
  });

  describe('cleanup after the commit', () => {
    it('prunes the deleted id from staff assignment lists', async () => {
      mockPrisma.sellerOrganizationMembers.findMany.mockResolvedValue([
        { id: 'member-1', assignedStoreIds: ['store-1', 'store-2'] },
      ]);

      await StoreService.deleteRejectedStore(admin, 'store-1', 'user-1');

      expect(mockPrisma.sellerOrganizationMembers.update).toHaveBeenCalledWith({
        where: { id: 'member-1' },
        data: { assignedStoreIds: ['store-2'] },
      });
    });

    it('tells open buyer maps to drop the marker', async () => {
      await StoreService.deleteRejectedStore(admin, 'store-1', 'user-1');

      expect(emitStoreRemoved).toHaveBeenCalledWith('store-1', 16.4, 120.6);
    });

    // The store is already gone from the database by this point; a broken socket
    // or a failed list rewrite must not surface as a failed deletion.
    it('still succeeds when the cleanup fails', async () => {
      mockPrisma.sellerOrganizationMembers.findMany.mockRejectedValue(new Error('db down'));

      await expect(StoreService.deleteRejectedStore(admin, 'store-1', 'user-1')).resolves.toEqual({
        id: 'store-1',
      });
    });
  });
});

/**
 * The deadline the seller's countdown reads.
 *
 * Computed here rather than in the browser so the window has exactly one
 * definition — the same constant the sweep enforces.
 */
describe('StoreService.getMyStores deletion deadline', () => {
  const rejectedAt = new Date('2026-09-09T10:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Derived from the constant, not a literal date. A hardcoded "+24h" here was a
  // second copy of the window — the very duplication `getMyStores` avoids by
  // computing the deadline from `REJECTED_STORE_TTL_MS` — so it broke the moment
  // that constant was tuned. What matters is the relationship, at any window.
  it('is one deletion window after the rejection', async () => {
    (StoreRepository.getStoresByScope as jest.Mock).mockResolvedValue([
      { id: 'store-1', approvalStatus: 'REJECTED', rejectedAt },
    ]);

    const [store] = await StoreService.getMyStores({});

    expect(store.scheduledDeletionAt).toEqual(
      new Date(rejectedAt.getTime() + REJECTED_STORE_TTL_MS),
    );
  });

  it.each(['PENDING', 'UNDER_REVIEW', 'NEEDS_REVISION', 'ACTIVE'] as const)(
    'is null on a %s store',
    async (approvalStatus) => {
      (StoreRepository.getStoresByScope as jest.Mock).mockResolvedValue([
        { id: 'store-1', approvalStatus, rejectedAt: null },
      ]);

      const [store] = await StoreService.getMyStores({});

      expect(store.scheduledDeletionAt).toBeNull();
    },
  );

  // Rows rejected before the column existed. The sweep skips them, so the card
  // must not promise a deadline nothing will act on.
  it('is null on a rejected row that predates the column', async () => {
    (StoreRepository.getStoresByScope as jest.Mock).mockResolvedValue([
      { id: 'store-1', approvalStatus: 'REJECTED', rejectedAt: null },
    ]);

    const [store] = await StoreService.getMyStores({});

    expect(store.scheduledDeletionAt).toBeNull();
  });
});
