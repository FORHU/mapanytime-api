import MerchantAdsService from '../../src/modules/merchantAds/merchantAds.service';
import MerchantAdsRepository from '../../src/modules/merchantAds/merchantAds.repository';

jest.mock('../../src/modules/merchantAds/merchantAds.repository');

const seller = { id: 'seller-1', userId: 'user-1' };
const store = { id: 'store-1', sellerId: 'seller-1' };
const otherStore = { id: 'store-1', sellerId: 'seller-2' };
const ad = { id: 'ad-1', storeId: 'store-1' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('MerchantAdsService.updateAd', () => {
  it('rejects when the ad does not exist', async () => {
    (MerchantAdsRepository.getAdById as jest.Mock).mockResolvedValue(null);

    await expect(
      MerchantAdsService.updateAd('user-1', 'ad-1', { kind: 'PROMO', title: 't', description: 'd' } as never),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects when the requesting user does not own the store', async () => {
    (MerchantAdsRepository.getAdById as jest.Mock).mockResolvedValue(ad);
    (MerchantAdsRepository.getSellerByUserId as jest.Mock).mockResolvedValue(seller);
    (MerchantAdsRepository.getStoreById as jest.Mock).mockResolvedValue(otherStore);

    await expect(
      MerchantAdsService.updateAd('user-1', 'ad-1', { kind: 'PROMO', title: 't', description: 'd' } as never),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('updates the ad and replaces linked products when the owner requests it', async () => {
    (MerchantAdsRepository.getAdById as jest.Mock).mockResolvedValue(ad);
    (MerchantAdsRepository.getSellerByUserId as jest.Mock).mockResolvedValue(seller);
    (MerchantAdsRepository.getStoreById as jest.Mock).mockResolvedValue(store);
    (MerchantAdsRepository.updateAd as jest.Mock).mockResolvedValue({ id: 'ad-1' });

    const payload = {
      kind: 'EVENT' as const,
      title: 'Flash sale',
      description: 'd',
      products: [{ productId: 'prod-1' }],
    };

    await MerchantAdsService.updateAd('user-1', 'ad-1', payload);

    expect(MerchantAdsRepository.updateAd).toHaveBeenCalledWith('ad-1', {
      kind: 'EVENT',
      title: 'Flash sale',
      description: 'd',
    });
    expect(MerchantAdsRepository.replaceAdProducts).toHaveBeenCalledWith('ad-1', payload.products);
  });
});

describe('MerchantAdsService.deleteAd', () => {
  it('rejects when the ad does not exist', async () => {
    (MerchantAdsRepository.getAdById as jest.Mock).mockResolvedValue(null);

    await expect(MerchantAdsService.deleteAd('user-1', 'ad-1')).rejects.toMatchObject({ status: 404 });
  });

  it('rejects when the requesting user does not own the store', async () => {
    (MerchantAdsRepository.getAdById as jest.Mock).mockResolvedValue(ad);
    (MerchantAdsRepository.getSellerByUserId as jest.Mock).mockResolvedValue(seller);
    (MerchantAdsRepository.getStoreById as jest.Mock).mockResolvedValue(otherStore);

    await expect(MerchantAdsService.deleteAd('user-1', 'ad-1')).rejects.toMatchObject({ status: 403 });
  });

  it('blocks deletion once the ad has been applied to a past order', async () => {
    (MerchantAdsRepository.getAdById as jest.Mock).mockResolvedValue(ad);
    (MerchantAdsRepository.getSellerByUserId as jest.Mock).mockResolvedValue(seller);
    (MerchantAdsRepository.getStoreById as jest.Mock).mockResolvedValue(store);
    (MerchantAdsRepository.countOrderItemsByAdId as jest.Mock).mockResolvedValue(3);

    await expect(MerchantAdsService.deleteAd('user-1', 'ad-1')).rejects.toMatchObject({ status: 409 });
    expect(MerchantAdsRepository.deleteAd).not.toHaveBeenCalled();
  });

  it('deletes the ad when the owner requests it and no orders reference it', async () => {
    (MerchantAdsRepository.getAdById as jest.Mock).mockResolvedValue(ad);
    (MerchantAdsRepository.getSellerByUserId as jest.Mock).mockResolvedValue(seller);
    (MerchantAdsRepository.getStoreById as jest.Mock).mockResolvedValue(store);
    (MerchantAdsRepository.countOrderItemsByAdId as jest.Mock).mockResolvedValue(0);

    await MerchantAdsService.deleteAd('user-1', 'ad-1');

    expect(MerchantAdsRepository.deleteAd).toHaveBeenCalledWith('ad-1');
  });
});
