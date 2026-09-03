import StoreService from '../../src/modules/stores/store.service';
import StoreRepository from '../../src/modules/stores/store.repository';
import CategoryRepository from '../../src/modules/categories/category.repository';
import { prisma } from '../../src/utils/prisma';
import type { OrgContext } from '../../src/modules/organization/orgContext';
import { ALL_SELLER_FEATURES } from '../../src/modules/organization/sellerPermissions.constant';

jest.mock('../../src/modules/stores/store.repository');

jest.mock('../../src/modules/categories/category.repository', () => ({
  __esModule: true,
  default: { findById: jest.fn() },
}));

jest.mock('../../src/utils/prisma', () => ({
  prisma: { $transaction: jest.fn() },
}));

jest.mock('../../src/infrastructure/socket', () => ({
  emitStoreUpserted: jest.fn(),
}));

describe('StoreService', () => {
  describe('getStoreById', () => {
    it('returns store details when store is found and active', async () => {
      const mockStore = {
        id: 'store-123',
        storeName: 'Test Store',
        description: 'A test store',
        isActive: true,
        approvalStatus: 'ACTIVE',
        storeLocations: {
          currentAddress: '123 Test St',
          city: 'Baguio',
          province: 'Benguet',
          country: 'Philippines',
        },
        storeHours: [{ dayOfWeek: 1, openMinutes: 480, closeMinutes: 1080, isClosed: false }],
        categories: [{ id: 'cat-1', name: 'Groceries' }],
        primaryCategory: { id: 'cat-1', name: 'Groceries' },
        merchantAds: [],
      };

      (StoreRepository.getStoreById as jest.Mock).mockResolvedValue(mockStore);

      const result = await StoreService.getStoreById('store-123');
      expect(result).toEqual({ ...mockStore, logoUrl: null, bannerUrl: null });
      expect(StoreRepository.getStoreById).toHaveBeenCalledWith('store-123');
    });

    it('drops a stock-linked ad once its linked inventory is sold out', async () => {
      const mockStore = {
        id: 'store-123',
        storeName: 'Test Store',
        isActive: true,
        approvalStatus: 'ACTIVE',
        merchantAds: [
          {
            id: 'ad-promo',
            kind: 'PROMO',
            products: [],
          },
          {
            id: 'ad-event-live',
            kind: 'EVENT',
            products: [
              {
                variant: null,
                product: { inventory: [{ quantityOnHand: 5, quantityReserved: 2 }] },
              },
            ],
          },
          {
            id: 'ad-event-sold-out',
            kind: 'EVENT',
            products: [
              {
                variant: null,
                product: { inventory: [{ quantityOnHand: 3, quantityReserved: 3 }] },
              },
            ],
          },
        ],
      };

      (StoreRepository.getStoreById as jest.Mock).mockResolvedValue(mockStore);

      const result = await StoreService.getStoreById('store-123');
      expect(result.merchantAds.map((ad: { id: string }) => ad.id)).toEqual([
        'ad-promo',
        'ad-event-live',
      ]);
    });

    it('throws 404 if store does not exist', async () => {
      (StoreRepository.getStoreById as jest.Mock).mockResolvedValue(null);

      await expect(StoreService.getStoreById('non-existent')).rejects.toEqual({
        status: 404,
        message: 'Store not found.',
      });
    });

    it('throws 404 if store is inactive', async () => {
      const inactiveStore = {
        id: 'store-inactive',
        storeName: 'Closed Store',
        isActive: false,
        approvalStatus: 'ACTIVE',
      };

      (StoreRepository.getStoreById as jest.Mock).mockResolvedValue(inactiveStore);

      await expect(StoreService.getStoreById('store-inactive')).rejects.toEqual({
        status: 404,
        message: 'Store is not currently active.',
      });
    });

    it.each(['PENDING', 'REJECTED'])(
      'throws 404 for a store with approvalStatus %s, even if isActive is true',
      async (approvalStatus) => {
        const pendingStore = {
          id: 'store-pending',
          storeName: 'Pending Store',
          // isActive:true simulates a seller self-toggling their own PATCH
          // /stores/:id "open for business" flag before admin review — the
          // approvalStatus check must reject regardless.
          isActive: true,
          approvalStatus,
        };

        (StoreRepository.getStoreById as jest.Mock).mockResolvedValue(pendingStore);

        await expect(StoreService.getStoreById('store-pending')).rejects.toEqual({
          status: 404,
          message: 'Store not found.',
        });
      },
    );
  });

  describe('getStoreProducts', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      (StoreRepository.getStoreProducts as jest.Mock).mockResolvedValue({
        items: [],
        total: 0,
      });
    });

    it('returns products for an approved store', async () => {
      (StoreRepository.getStoreById as jest.Mock).mockResolvedValue({
        id: 'store-123',
        approvalStatus: 'ACTIVE',
      });

      const result = await StoreService.getStoreProducts('store-123', 20, 0);

      expect(result).toEqual({ items: [], total: 0, limit: 20, offset: 0, hasMore: false });
      expect(StoreRepository.getStoreProducts).toHaveBeenCalledWith('store-123', 20, 0);
    });

    it('throws 404 if the store does not exist', async () => {
      (StoreRepository.getStoreById as jest.Mock).mockResolvedValue(null);

      await expect(StoreService.getStoreProducts('missing', 20, 0)).rejects.toEqual({
        status: 404,
        message: 'Store not found.',
      });
      expect(StoreRepository.getStoreProducts).not.toHaveBeenCalled();
    });

    it.each(['PENDING', 'REJECTED'])(
      'throws 404 for a store with approvalStatus %s',
      async (approvalStatus) => {
        (StoreRepository.getStoreById as jest.Mock).mockResolvedValue({
          id: 'store-pending',
          approvalStatus,
        });

        await expect(StoreService.getStoreProducts('store-pending', 20, 0)).rejects.toEqual({
          status: 404,
          message: 'Store not found.',
        });
        expect(StoreRepository.getStoreProducts).not.toHaveBeenCalled();
      },
    );
  });

  describe('updateStore', () => {
    // `updateStore(context, storeId, input)` now — the old second argument was a
    // `sellerId` compared against `store.sellerId`; ownership moved to the
    // caller's organization, so the store carries `sellerOrganizationId` and the
    // seller id no longer participates.
    const admin: OrgContext = {
      organizationId: 'org-1',
      role: 'SELLER_ADMIN',
      isAdmin: true,
      assignedStoreIds: null,
      permissions: [...ALL_SELLER_FEATURES],
    };

    const existingStore = {
      id: 'store-1',
      sellerId: 'seller-1',
      sellerOrganizationId: 'org-1',
      storeName: 'Test Store',
      storeLocations: null,
    };

    let tx: {
      stores: { update: jest.Mock; findUnique: jest.Mock };
      storeLocations: { update: jest.Mock };
    };

    beforeEach(() => {
      jest.clearAllMocks();

      tx = {
        stores: {
          update: jest.fn(),
          findUnique: jest.fn().mockResolvedValue({ ...existingStore }),
        },
        storeLocations: { update: jest.fn() },
      };

      (prisma.$transaction as unknown as jest.Mock).mockImplementation(
        (fn: (client: typeof tx) => unknown) => fn(tx),
      );
      (StoreRepository.getStoreById as jest.Mock).mockResolvedValue(existingStore);
    });

    it('writes both the primary scalar and the M2M set so they cannot drift', async () => {
      (CategoryRepository.findById as jest.Mock).mockResolvedValue({ id: 'cat-B' });

      await StoreService.updateStore(admin, 'store-1', { categoryId: 'cat-B' });

      expect(tx.stores.update).toHaveBeenCalledWith({
        where: { id: 'store-1' },
        data: {
          primaryCategory: { connect: { id: 'cat-B' } },
          categories: { set: [{ id: 'cat-B' }] },
        },
      });
    });

    it('replaces the M2M set rather than adding to it, so no stale row survives', async () => {
      (CategoryRepository.findById as jest.Mock).mockResolvedValue({ id: 'cat-B' });

      await StoreService.updateStore(admin, 'store-1', { categoryId: 'cat-B' });

      const { data } = (tx.stores.update as jest.Mock).mock.calls[0][0];
      expect(data.categories).toEqual({ set: [{ id: 'cat-B' }] });
      expect(data.categories.connect).toBeUndefined();
    });

    it('throws 404 for an unknown categoryId instead of leaking a Prisma error', async () => {
      (CategoryRepository.findById as jest.Mock).mockResolvedValue(null);

      await expect(
        StoreService.updateStore(admin, 'store-1', { categoryId: 'missing' }),
      ).rejects.toEqual({ status: 404, message: 'Category not found.' });

      expect(tx.stores.update).not.toHaveBeenCalled();
    });

    it('leaves categories untouched when categoryId is absent from the patch', async () => {
      await StoreService.updateStore(admin, 'store-1', { storeName: 'Renamed' });

      expect(CategoryRepository.findById).not.toHaveBeenCalled();
      const { data } = (tx.stores.update as jest.Mock).mock.calls[0][0];
      expect(data).toEqual({ storeName: 'Renamed' });
    });
  });
});
