import MerchantAdsService from '../../src/modules/merchantAds/merchantAds.service';
import MerchantAdsRepository from '../../src/modules/merchantAds/merchantAds.repository';
import {
  assertStoreInScope,
  resolveAccessibleStoreIds,
} from '../../src/modules/organization/storeAccess';
import type { AuthUser } from '../../src/modules/auth/auth.repository';

jest.mock('../../src/modules/merchantAds/merchantAds.repository');
jest.mock('../../src/modules/organization/storeAccess');

const assertStoreInScopeMock = assertStoreInScope as jest.Mock;
const resolveAccessibleStoreIdsMock = resolveAccessibleStoreIds as jest.Mock;

/**
 * Store scope is resolved from the DB per request, so the tests drive the
 * scope helpers directly rather than reconstructing memberships. `user` stands
 * for any caller — a SELLER_ADMIN, an assigned SELLER_USER, or a legacy seller;
 * which one it is only changes what the helpers return.
 */
const user = { id: 'user-1' } as unknown as AuthUser;

const ad = {
  id: 'ad-1',
  storeId: 'store-1',
  products: [],
  startAt: null,
  expiresAt: null,
  isActive: true,
  kind: 'PROMO',
  discountType: null,
};

/** What the scope helper throws for a store the caller may not reach. */
const OUT_OF_SCOPE = { status: 404, message: 'Store not found.' };

beforeEach(() => {
  jest.clearAllMocks();
  // Default: the caller may reach the store. Individual tests override.
  assertStoreInScopeMock.mockResolvedValue(undefined);
  resolveAccessibleStoreIdsMock.mockResolvedValue({
    storeIds: ['store-1'],
    hasOrg: true,
    hasSellerRow: false,
  });
  (MerchantAdsRepository.countProductsInStore as jest.Mock).mockResolvedValue(0);
});

describe('MerchantAdsService store scoping', () => {
  it('lets a SELLER_USER manage an ad in a store assigned to them', async () => {
    // The regression this guards: staff hold no Sellers row, and the old check
    // demanded one before it ever looked at the store.
    (MerchantAdsRepository.getAdById as jest.Mock).mockResolvedValue(ad);
    (MerchantAdsRepository.updateAd as jest.Mock).mockResolvedValue({ id: 'ad-1' });

    await MerchantAdsService.updateAd(user, 'ad-1', {
      title: 'Staff edit',
      description: 'd',
    } as never);

    expect(assertStoreInScopeMock).toHaveBeenCalledWith(user, 'store-1');
    expect(MerchantAdsRepository.updateAd).toHaveBeenCalled();
  });

  it('lets a SELLER_USER create an ad for an assigned store', async () => {
    (MerchantAdsRepository.createAd as jest.Mock).mockResolvedValue({ id: 'ad-1' });

    await MerchantAdsService.createAd(user, {
      storeId: 'store-1',
      kind: 'PROMO',
      title: 't',
      description: 'd',
    } as never);

    expect(assertStoreInScopeMock).toHaveBeenCalledWith(user, 'store-1');
    expect(MerchantAdsRepository.createAd).toHaveBeenCalled();
  });

  it('refuses a sibling store in the same organization', async () => {
    // A SELLER_USER assigned to store-1 must not reach store-2 just because
    // both belong to the organization that hired them.
    assertStoreInScopeMock.mockRejectedValue(OUT_OF_SCOPE);

    await expect(
      MerchantAdsService.createAd(user, {
        storeId: 'store-2',
        kind: 'PROMO',
        title: 't',
        description: 'd',
      } as never),
    ).rejects.toMatchObject({ status: 404 });
    expect(MerchantAdsRepository.createAd).not.toHaveBeenCalled();
  });

  it('scopes toggling an ad to the caller store scope', async () => {
    (MerchantAdsRepository.getAdById as jest.Mock).mockResolvedValue(ad);
    assertStoreInScopeMock.mockRejectedValue(OUT_OF_SCOPE);

    await expect(MerchantAdsService.setActive(user, 'ad-1', false)).rejects.toMatchObject({
      status: 404,
    });
    expect(MerchantAdsRepository.setActive).not.toHaveBeenCalled();
  });

  it('scopes analytics to the caller store scope', async () => {
    (MerchantAdsRepository.getAdById as jest.Mock).mockResolvedValue(ad);
    assertStoreInScopeMock.mockRejectedValue(OUT_OF_SCOPE);

    await expect(MerchantAdsService.getAnalytics(user, 'ad-1')).rejects.toMatchObject({
      status: 404,
    });
    expect(MerchantAdsRepository.getAdAnalytics).not.toHaveBeenCalled();
  });
});

describe('MerchantAdsService.listAllMyAds', () => {
  beforeEach(() => {
    (MerchantAdsRepository.getAdsByStoreIds as jest.Mock).mockResolvedValue([]);
    (MerchantAdsRepository.getStoreTimezones as jest.Mock).mockResolvedValue(new Map());
  });

  it('queries only the stores the caller can reach', async () => {
    resolveAccessibleStoreIdsMock.mockResolvedValue({
      storeIds: ['store-1'],
      hasOrg: true,
      hasSellerRow: false,
    });

    await MerchantAdsService.listAllMyAds(user);

    expect(MerchantAdsRepository.getAdsByStoreIds).toHaveBeenCalledWith(['store-1']);
  });

  it('covers every org store for an admin', async () => {
    resolveAccessibleStoreIdsMock.mockResolvedValue({
      storeIds: ['store-1', 'store-2'],
      hasOrg: true,
      hasSellerRow: false,
    });

    await MerchantAdsService.listAllMyAds(user);

    expect(MerchantAdsRepository.getAdsByStoreIds).toHaveBeenCalledWith(['store-1', 'store-2']);
  });

  it('returns nothing rather than everything for a member with no store assigned', async () => {
    resolveAccessibleStoreIdsMock.mockResolvedValue({
      storeIds: [],
      hasOrg: true,
      hasSellerRow: false,
    });

    const result = await MerchantAdsService.listAllMyAds(user);

    expect(MerchantAdsRepository.getAdsByStoreIds).toHaveBeenCalledWith([]);
    expect(result.items).toEqual([]);
  });

  it('refuses a caller with neither an organization nor a seller row', async () => {
    resolveAccessibleStoreIdsMock.mockResolvedValue({
      storeIds: [],
      hasOrg: false,
      hasSellerRow: false,
    });

    await expect(MerchantAdsService.listAllMyAds(user)).rejects.toMatchObject({ status: 403 });
    expect(MerchantAdsRepository.getAdsByStoreIds).not.toHaveBeenCalled();
  });
});

describe('MerchantAdsService product/store linking', () => {
  it('rejects a product that belongs to another store on create', async () => {
    // One id submitted, zero of them in this store.
    (MerchantAdsRepository.countProductsInStore as jest.Mock).mockResolvedValue(0);

    await expect(
      MerchantAdsService.createAd(user, {
        storeId: 'store-1',
        kind: 'PROMO',
        title: 't',
        description: 'd',
        products: [{ productId: 'prod-from-store-2' }],
      } as never),
    ).rejects.toMatchObject({ status: 404 });
    expect(MerchantAdsRepository.createAd).not.toHaveBeenCalled();
  });

  it('rejects a foreign product on update, checked against the ad own store', async () => {
    (MerchantAdsRepository.getAdById as jest.Mock).mockResolvedValue(ad);
    (MerchantAdsRepository.countProductsInStore as jest.Mock).mockResolvedValue(0);

    await expect(
      MerchantAdsService.updateAd(user, 'ad-1', {
        title: 't',
        description: 'd',
        products: [{ productId: 'prod-from-store-2' }],
      } as never),
    ).rejects.toMatchObject({ status: 404 });

    expect(MerchantAdsRepository.countProductsInStore).toHaveBeenCalledWith('store-1', [
      'prod-from-store-2',
    ]);
    expect(MerchantAdsRepository.replaceAdProducts).not.toHaveBeenCalled();
  });

  it('accepts products that do belong to the store', async () => {
    (MerchantAdsRepository.countProductsInStore as jest.Mock).mockResolvedValue(1);
    (MerchantAdsRepository.createAd as jest.Mock).mockResolvedValue({ id: 'ad-1' });

    await MerchantAdsService.createAd(user, {
      storeId: 'store-1',
      kind: 'PROMO',
      title: 't',
      description: 'd',
      products: [{ productId: 'prod-1' }],
    } as never);

    expect(MerchantAdsRepository.createAd).toHaveBeenCalled();
  });
});

describe('MerchantAdsService.updateAd', () => {
  it('rejects when the ad does not exist', async () => {
    (MerchantAdsRepository.getAdById as jest.Mock).mockResolvedValue(null);

    await expect(
      MerchantAdsService.updateAd(user, 'ad-1', {
        kind: 'PROMO',
        title: 't',
        description: 'd',
      } as never),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects when the store is outside the caller scope', async () => {
    // 404 rather than 403: a store outside your scope must be
    // indistinguishable from one that does not exist, so ids cannot be probed.
    (MerchantAdsRepository.getAdById as jest.Mock).mockResolvedValue(ad);
    assertStoreInScopeMock.mockRejectedValue(OUT_OF_SCOPE);

    await expect(
      MerchantAdsService.updateAd(user, 'ad-1', {
        kind: 'PROMO',
        title: 't',
        description: 'd',
      } as never),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('updates the ad and replaces linked products when the caller may reach the store', async () => {
    (MerchantAdsRepository.getAdById as jest.Mock).mockResolvedValue(ad);
    (MerchantAdsRepository.updateAd as jest.Mock).mockResolvedValue({ id: 'ad-1' });
    (MerchantAdsRepository.countProductsInStore as jest.Mock).mockResolvedValue(1);

    const payload = {
      kind: 'EVENT' as const,
      title: 'Flash sale',
      description: 'd',
      products: [{ productId: 'prod-1' }],
    };

    await MerchantAdsService.updateAd(user, 'ad-1', payload);

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
      (MerchantAdsRepository.createAd as jest.Mock).mockResolvedValue({ id: 'ad-1' });
    });

    it('resolves a preset badgeId to the DB row and ignores a client-sent label', async () => {
      (MerchantAdsRepository.getBadgeById as jest.Mock).mockResolvedValue(badge);

      await MerchantAdsService.createAd(user, {
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
        MerchantAdsService.createAd(user, {
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
        MerchantAdsService.createAd(user, {
          storeId: 'store-1',
          kind: 'PROMO',
          title: 't',
          description: 'd',
          badgeId: 'badge-hot',
        } as never),
      ).rejects.toMatchObject({ status: 400, code: 'BADGE_NOT_FOUND' });
    });

    it('stores a custom badgeLabel with no badge connected', async () => {
      await MerchantAdsService.createAd(user, {
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
      await MerchantAdsService.createAd(user, {
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
      (MerchantAdsRepository.updateAd as jest.Mock).mockResolvedValue({ id: 'ad-1' });
    });

    it('switches from a custom label to a preset, connecting the badge and overwriting the label', async () => {
      (MerchantAdsRepository.getBadgeById as jest.Mock).mockResolvedValue(badge);

      await MerchantAdsService.updateAd(user, 'ad-1', {
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
      await MerchantAdsService.updateAd(user, 'ad-1', {
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
      await MerchantAdsService.updateAd(user, 'ad-1', {
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

    await expect(MerchantAdsService.deleteAd(user, 'ad-1')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('rejects when the store is outside the caller scope', async () => {
    (MerchantAdsRepository.getAdById as jest.Mock).mockResolvedValue(ad);
    assertStoreInScopeMock.mockRejectedValue(OUT_OF_SCOPE);

    await expect(MerchantAdsService.deleteAd(user, 'ad-1')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('blocks deletion once the ad has been applied to a past order', async () => {
    (MerchantAdsRepository.getAdById as jest.Mock).mockResolvedValue(ad);
    (MerchantAdsRepository.countOrderItemsByAdId as jest.Mock).mockResolvedValue(3);

    await expect(MerchantAdsService.deleteAd(user, 'ad-1')).rejects.toMatchObject({
      status: 409,
    });
    expect(MerchantAdsRepository.deleteAd).not.toHaveBeenCalled();
  });

  it('deletes the ad when the caller may reach the store and no orders reference it', async () => {
    (MerchantAdsRepository.getAdById as jest.Mock).mockResolvedValue(ad);
    (MerchantAdsRepository.countOrderItemsByAdId as jest.Mock).mockResolvedValue(0);

    await MerchantAdsService.deleteAd(user, 'ad-1');

    expect(MerchantAdsRepository.deleteAd).toHaveBeenCalledWith('ad-1');
  });
});
