import MerchantAdsService, {
  AD_COST_PER_CLICK,
  AD_COST_PER_IMPRESSION,
} from '../../src/modules/merchantAds/merchantAds.service';
import MerchantAdsRepository from '../../src/modules/merchantAds/merchantAds.repository';
import MarketingWalletService from '../../src/modules/marketingWallet/marketingWallet.service';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/modules/merchantAds/merchantAds.repository');
jest.mock('../../src/modules/marketingWallet/marketingWallet.service');
jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    stores: {
      findUnique: jest.fn(),
    },
  },
}));

const mockStores = prisma.stores as unknown as { findUnique: jest.Mock };
const mockRecordAdEvent = MerchantAdsRepository.recordAdEvent as jest.Mock;
const mockIncrementAdMetrics = MerchantAdsRepository.incrementAdMetrics as jest.Mock;
const mockSetActive = MerchantAdsRepository.setActive as jest.Mock;
const mockGetAdById = MerchantAdsRepository.getAdById as jest.Mock;
const mockDeductAdSpend = MarketingWalletService.deductAdSpend as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockStores.findUnique.mockResolvedValue({ sellerId: 'seller-1' });
});

describe('MerchantAdsService ad billing in trackEvent', () => {
  const ad = {
    id: 'ad-100',
    storeId: 'store-1',
    title: 'Flash Sale Pin',
    spentAmount: 10,
    totalBudget: 50,
  };

  it('deducts spend and increments ad metrics on CLICK event', async () => {
    mockGetAdById.mockResolvedValueOnce(ad);
    mockDeductAdSpend.mockResolvedValueOnce({ success: true });

    await MerchantAdsService.trackEvent('ad-100', {
      eventType: 'CLICK',
      sessionId: 'sess-1',
    });

    expect(mockRecordAdEvent).toHaveBeenCalledWith(
      expect.objectContaining({ adId: 'ad-100', eventType: 'CLICK', revenueAmount: 0 }),
    );
    expect(mockDeductAdSpend).toHaveBeenCalledWith(
      'seller-1',
      'ad-100',
      AD_COST_PER_CLICK,
      expect.stringContaining('click'),
      expect.anything(),
    );
    expect(mockIncrementAdMetrics).toHaveBeenCalledWith('ad-100', {
      impressions: 0,
      clicks: 1,
      conversions: 0,
      revenue: 0,
      spend: AD_COST_PER_CLICK,
    });
    expect(mockSetActive).not.toHaveBeenCalled();
  });

  it('deducts spend on IMPRESSION event', async () => {
    mockGetAdById.mockResolvedValueOnce(ad);
    mockDeductAdSpend.mockResolvedValueOnce({ success: true });

    await MerchantAdsService.trackEvent('ad-100', {
      eventType: 'IMPRESSION',
      sessionId: 'sess-2',
    });

    expect(mockDeductAdSpend).toHaveBeenCalledWith(
      'seller-1',
      'ad-100',
      AD_COST_PER_IMPRESSION,
      expect.stringContaining('impression'),
      expect.anything(),
    );
    expect(mockIncrementAdMetrics).toHaveBeenCalledWith('ad-100', {
      impressions: 1,
      clicks: 0,
      conversions: 0,
      revenue: 0,
      spend: AD_COST_PER_IMPRESSION,
    });
  });

  it('deactivates ad if wallet balance is insufficient', async () => {
    mockGetAdById.mockResolvedValueOnce(ad);
    mockDeductAdSpend.mockResolvedValueOnce({
      success: false,
      reason: 'INSUFFICIENT_FUNDS',
      balance: 0,
    });

    await MerchantAdsService.trackEvent('ad-100', {
      eventType: 'CLICK',
    });

    expect(mockSetActive).toHaveBeenCalledWith('ad-100', false);
    expect(mockIncrementAdMetrics).toHaveBeenCalledWith('ad-100', {
      impressions: 0,
      clicks: 1,
      conversions: 0,
      revenue: 0,
      spend: 0,
    });
  });

  it('deactivates ad if totalBudget is reached', async () => {
    const nearLimitAd = {
      id: 'ad-100',
      storeId: 'store-1',
      title: 'Flash Sale Pin',
      spentAmount: 49.8,
      totalBudget: 50.0,
    };
    mockGetAdById.mockResolvedValueOnce(nearLimitAd);
    mockDeductAdSpend.mockResolvedValueOnce({ success: true });

    await MerchantAdsService.trackEvent('ad-100', {
      eventType: 'CLICK',
    });

    // 49.80 + 0.50 = 50.30 >= 50.00 budget -> deactivate ad
    expect(mockSetActive).toHaveBeenCalledWith('ad-100', false);
  });
});
