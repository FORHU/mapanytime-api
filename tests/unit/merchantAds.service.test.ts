import MerchantAdsService from '../../src/modules/merchantAds/merchantAds.service';
import MerchantAdsRepository from '../../src/modules/merchantAds/merchantAds.repository';

jest.mock('../../src/modules/merchantAds/merchantAds.repository');

const seller = { id: 'seller-1', userId: 'user-1' };
const store = { id: 'store-1', sellerId: 'seller-1' };
const otherStore = { id: 'store-1', sellerId: 'seller-2' };
const ad = { id: 'ad-1', storeId: 'store-1', products: [] };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('MerchantAdsService.updateAd', () => {
  it('rejects when the ad does not exist', async () => {
    (MerchantAdsRepository.getAdById as jest.Mock).mockResolvedValue(null);

    await expect(
      MerchantAdsService.updateAd('user-1', 'ad-1', {
        kind: 'PROMO',
        title: 't',
        description: 'd',
      } as never),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects when the requesting user does not own the store', async () => {
    (MerchantAdsRepository.getAdById as jest.Mock).mockResolvedValue(ad);
    (MerchantAdsRepository.getSellerByUserId as jest.Mock).mockResolvedValue(seller);
    (MerchantAdsRepository.getStoreById as jest.Mock).mockResolvedValue(otherStore);

    await expect(
      MerchantAdsService.updateAd('user-1', 'ad-1', {
        kind: 'PROMO',
        title: 't',
        description: 'd',
      } as never),
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

describe('MerchantAdsService badge resolution', () => {
  const badge = {
    id: 'badge-hot',
    slug: 'HOT',
    label: 'Hot',
    description: 'Great for trending items',
    isActive: true,
  };

  describe('createAd', () => {
    beforeEach(() => {
      (MerchantAdsRepository.getSellerByUserId as jest.Mock).mockResolvedValue(seller);
      (MerchantAdsRepository.getStoreById as jest.Mock).mockResolvedValue(store);
      (MerchantAdsRepository.createAd as jest.Mock).mockResolvedValue({ id: 'ad-1' });
    });

    it('resolves a preset badgeId to the DB row and ignores a client-sent label', async () => {
      (MerchantAdsRepository.getBadgeById as jest.Mock).mockResolvedValue(badge);

      await MerchantAdsService.createAd('user-1', {
        storeId: 'store-1',
        kind: 'PROMO',
        title: 't',
        description: 'd',
        badgeId: 'badge-hot',
        badgeLabel: 'ignored client text',
      } as never);

      expect(MerchantAdsRepository.getBadgeById).toHaveBeenCalledWith('badge-hot');
      expect(MerchantAdsRepository.createAd).toHaveBeenCalledWith(
        expect.objectContaining({
          badgeLabel: 'Hot',
          badge: { connect: { id: 'badge-hot' } },
        }),
      );
    });

    it('rejects an unknown badgeId', async () => {
      (MerchantAdsRepository.getBadgeById as jest.Mock).mockResolvedValue(null);

      await expect(
        MerchantAdsService.createAd('user-1', {
          storeId: 'store-1',
          kind: 'PROMO',
          title: 't',
          description: 'd',
          badgeId: 'does-not-exist',
        } as never),
      ).rejects.toMatchObject({ status: 400, code: 'BADGE_NOT_FOUND' });
      expect(MerchantAdsRepository.createAd).not.toHaveBeenCalled();
    });

    it('rejects an inactive badgeId', async () => {
      (MerchantAdsRepository.getBadgeById as jest.Mock).mockResolvedValue({
        ...badge,
        isActive: false,
      });

      await expect(
        MerchantAdsService.createAd('user-1', {
          storeId: 'store-1',
          kind: 'PROMO',
          title: 't',
          description: 'd',
          badgeId: 'badge-hot',
        } as never),
      ).rejects.toMatchObject({ status: 400, code: 'BADGE_NOT_FOUND' });
    });

    it('stores a custom badgeLabel with no badge connected', async () => {
      await MerchantAdsService.createAd('user-1', {
        storeId: 'store-1',
        kind: 'PROMO',
        title: 't',
        description: 'd',
        badgeLabel: '  My Custom Badge  ',
      } as never);

      expect(MerchantAdsRepository.getBadgeById).not.toHaveBeenCalled();
      const call = (MerchantAdsRepository.createAd as jest.Mock).mock.calls[0][0];
      expect(call.badgeLabel).toBe('My Custom Badge');
      expect(call.badge).toBeUndefined();
    });

    it('leaves the badge fields off the write entirely when neither is sent', async () => {
      await MerchantAdsService.createAd('user-1', {
        storeId: 'store-1',
        kind: 'PROMO',
        title: 't',
        description: 'd',
      } as never);

      const call = (MerchantAdsRepository.createAd as jest.Mock).mock.calls[0][0];
      expect('badgeLabel' in call).toBe(false);
      expect('badge' in call).toBe(false);
    });
  });

  describe('updateAd', () => {
    beforeEach(() => {
      (MerchantAdsRepository.getAdById as jest.Mock).mockResolvedValue(ad);
      (MerchantAdsRepository.getSellerByUserId as jest.Mock).mockResolvedValue(seller);
      (MerchantAdsRepository.getStoreById as jest.Mock).mockResolvedValue(store);
      (MerchantAdsRepository.updateAd as jest.Mock).mockResolvedValue({ id: 'ad-1' });
    });

    it('switches from a custom label to a preset, connecting the badge and overwriting the label', async () => {
      (MerchantAdsRepository.getBadgeById as jest.Mock).mockResolvedValue(badge);

      await MerchantAdsService.updateAd('user-1', 'ad-1', {
        title: 't',
        description: 'd',
        badgeId: 'badge-hot',
      } as never);

      expect(MerchantAdsRepository.updateAd).toHaveBeenCalledWith(
        'ad-1',
        expect.objectContaining({
          badgeLabel: 'Hot',
          badge: { connect: { id: 'badge-hot' } },
        }),
      );
    });

    it('explicitly clears the badge when both fields are sent as null', async () => {
      await MerchantAdsService.updateAd('user-1', 'ad-1', {
        title: 't',
        description: 'd',
        badgeId: null,
        badgeLabel: null,
      } as never);

      expect(MerchantAdsRepository.updateAd).toHaveBeenCalledWith(
        'ad-1',
        expect.objectContaining({
          badgeLabel: null,
          badge: { disconnect: true },
        }),
      );
    });

    it('leaves the badge untouched when neither field is present in the payload', async () => {
      await MerchantAdsService.updateAd('user-1', 'ad-1', {
        title: 'new title',
        description: 'd',
      } as never);

      const call = (MerchantAdsRepository.updateAd as jest.Mock).mock.calls[0][1];
      expect('badgeLabel' in call).toBe(false);
      expect('badge' in call).toBe(false);
    });
  });
});

describe('MerchantAdsService.deleteAd', () => {
  it('rejects when the ad does not exist', async () => {
    (MerchantAdsRepository.getAdById as jest.Mock).mockResolvedValue(null);

    await expect(MerchantAdsService.deleteAd('user-1', 'ad-1')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('rejects when the requesting user does not own the store', async () => {
    (MerchantAdsRepository.getAdById as jest.Mock).mockResolvedValue(ad);
    (MerchantAdsRepository.getSellerByUserId as jest.Mock).mockResolvedValue(seller);
    (MerchantAdsRepository.getStoreById as jest.Mock).mockResolvedValue(otherStore);

    await expect(MerchantAdsService.deleteAd('user-1', 'ad-1')).rejects.toMatchObject({
      status: 403,
    });
  });

  it('blocks deletion once the ad has been applied to a past order', async () => {
    (MerchantAdsRepository.getAdById as jest.Mock).mockResolvedValue(ad);
    (MerchantAdsRepository.getSellerByUserId as jest.Mock).mockResolvedValue(seller);
    (MerchantAdsRepository.getStoreById as jest.Mock).mockResolvedValue(store);
    (MerchantAdsRepository.countOrderItemsByAdId as jest.Mock).mockResolvedValue(3);

    await expect(MerchantAdsService.deleteAd('user-1', 'ad-1')).rejects.toMatchObject({
      status: 409,
    });
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
