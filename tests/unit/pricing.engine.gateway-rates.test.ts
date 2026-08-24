import PricingEngineService from '../../src/modules/pricing/pricing-engine.service';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    pricingConfigurations: { findFirst: jest.fn() },
    pricingComponents: { findMany: jest.fn() },
  },
}));

const config = prisma.pricingConfigurations.findFirst as jest.Mock;
const components = prisma.pricingComponents.findMany as jest.Mock;

/**
 * Stand up an ACTIVE configuration whose gateway component carries
 * `rate`/`fixed`. The engine reads every component under a configuration in one
 * query and matches them in memory (F37), so the double returns the set rather
 * than answering per-type lookups.
 */
function withGatewayRate(rate: number, fixed = 0) {
  config.mockResolvedValue({ id: 'cfg-1' });
  components.mockResolvedValue([
    {
      id: 'comp-gateway',
      type: 'PAYMENT_PROCESSING_FEE',
      ratePercentage: rate,
      fixedAmount: fixed,
      minFee: null,
      maxFee: null,
      providerId: null,
      paymentMethodId: null,
      sellerPlan: null,
      categoryId: null,
      storeId: null,
    },
  ]); // commission + buyer fee fall back
}

const SUBTOTAL = 1000;

// The contracted PayMongo rate card. A change here is a commercial change, not
// a refactor — see FLAGS.md, Confirmed business rules.
const RATES = {
  gcash: { rate: 0.0223, fixed: 0 },
  maya: { rate: 0.0179, fixed: 0 },
  cardDomestic: { rate: 0.03125, fixed: 13.39 },
};

describe('Gateway rates and the buyer transaction fee', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.mockResolvedValue(null);
    components.mockResolvedValue([]);
  });

  describe('the platform keeps exactly its commission', () => {
    // The invariant the whole fee design exists to protect: whatever PayMongo
    // charges, it is fully covered by the buyer, so the platform nets the 2%
    // commission and nothing else. If this drifts, a rate change silently
    // started costing money.
    it.each([
      ['GCash', RATES.gcash],
      ['Maya', RATES.maya],
      ['domestic card', RATES.cardDomestic],
    ])('holds for %s', async (_label, { rate, fixed }) => {
      withGatewayRate(rate, fixed);

      const r = await PricingEngineService.calculateOrderPricing({
        subtotalAmount: SUBTOTAL,
        paymentMethodId: 'pm-1',
      });

      // What PayMongo actually bills, charged on the captured total.
      const captured = r.buyerTotalAmount;
      const actualGatewayCost = captured * rate + fixed;

      expect(captured - actualGatewayCost - r.sellerNetAmount).toBeCloseTo(20, 2);
    });
  });

  describe('gross-up', () => {
    it('charges more than a flat rate-times-amount, covering the fee on the fee', async () => {
      withGatewayRate(RATES.gcash.rate);

      const r = await PricingEngineService.calculateOrderPricing({
        subtotalAmount: SUBTOTAL,
        paymentMethodId: 'pm-1',
      });

      // Flat would be 22.30 and leaves the platform 50 centavos short.
      expect(r.buyerTransactionFee.totalBuyerFeeAmount).toBeCloseTo(22.81, 2);
      expect(r.buyerTotalAmount).toBeCloseTo(1022.81, 2);
    });

    it('carries the fixed fee through, so small card baskets cost what they cost', async () => {
      withGatewayRate(RATES.cardDomestic.rate, RATES.cardDomestic.fixed);

      const r = await PricingEngineService.calculateOrderPricing({
        subtotalAmount: 100,
        paymentMethodId: 'pm-1',
      });

      // (100 * 0.03125 + 13.39) / (1 - 0.03125)
      expect(r.buyerTransactionFee.totalBuyerFeeAmount).toBeCloseTo(17.05, 2);
    });
  });

  describe('cash', () => {
    // The seeded cash method's code is COD, so matching on the string 'CASH'
    // never fired and every pay-at-the-stall buyer was charged a gateway fee
    // for a gateway that never ran. See FLAGS.md F31.
    it.each([
      ['type CASH', { paymentMethodType: 'CASH' }],
      ['code COD', { paymentMethodCode: 'COD' }],
      ['legacy code CASH_ON_DELIVERY', { paymentMethodCode: 'CASH_ON_DELIVERY' }],
    ])('is never charged a gateway fee — %s', async (_label, context) => {
      withGatewayRate(RATES.gcash.rate);

      const r = await PricingEngineService.calculateOrderPricing({
        subtotalAmount: SUBTOTAL,
        paymentMethodId: 'pm-1',
        ...context,
      });

      expect(r.paymentProcessingCost.calculatedCost).toBe(0);
      expect(r.buyerTransactionFee.totalBuyerFeeAmount).toBe(0);
      expect(r.buyerTotalAmount).toBe(SUBTOTAL);
    });
  });

  describe('platform handling margin', () => {
    it('is zero — the old 0.23% was part of GCash rate, not margin', async () => {
      const r = await PricingEngineService.calculateOrderPricing({ subtotalAmount: SUBTOTAL });
      expect(r.buyerPlatformFee.amount).toBe(0);
    });
  });
});
