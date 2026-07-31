import StoreService from '../../src/services/store.service';
import StoreRepository from '../../src/repositories/store.repository';

jest.mock('../../src/repositories/store.repository');

describe('StoreService', () => {
  describe('getStoreById', () => {
    it('returns store details when store is found and active', async () => {
      const mockStore = {
        id: 'store-123',
        storeName: 'Test Store',
        description: 'A test store',
        isActive: true,
        storeLocations: {
          currentAddress: '123 Test St',
          city: 'Baguio',
          province: 'Benguet',
          country: 'Philippines',
        },
        storeHours: [{ dayOfWeek: 1, openTime: '08:00', closeTime: '18:00', isClosed: false }],
        categories: [{ id: 'cat-1', name: 'Groceries' }],
      };

      (StoreRepository.getStoreById as jest.Mock).mockResolvedValue(mockStore);

      const result = await StoreService.getStoreById('store-123');
      expect(result).toEqual(mockStore);
      expect(StoreRepository.getStoreById).toHaveBeenCalledWith('store-123');
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
      };

      (StoreRepository.getStoreById as jest.Mock).mockResolvedValue(inactiveStore);

      await expect(StoreService.getStoreById('store-inactive')).rejects.toEqual({
        status: 404,
        message: 'Store is not currently active.',
      });
    });
  });
});
