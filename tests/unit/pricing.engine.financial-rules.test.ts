import PricingEngineService from '../../src/modules/pricing/pricing-engine.service';

// The engine reads an optional PricingConfigurations row; with none stored it
// falls back to its built-in rates, which is the state every environment is in
// today. These tests pin the confirmed business rules against that path.
jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    pricingConfigurations: { findFirst: jest.fn().mockResolvedValue(null) },
    pricingComponents: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));

const SUBTOTAL = 1000;

describe('Confirmed financial rules', () => {
  // VAT was removed on 2026-08-20: the platform is a marketplace intermediary
  // and does not collect the seller's output VAT. These lock that in — a
  // failure here means a tax term crept back into the buyer's total.
  describe('No tax is added to an order', () => {
    it('leaves the order amount as subtotal - discount', async () => {
      const r = await PricingEngineService.calculateOrderPricing({
        subtotalAmount: SUBTOTAL,
        discountAmount: 200,
      });
      expect(r.orderAmount).toBe(SUBTOTAL - 200);
    });

    it('charges the buyer nothing beyond the order amount and the transaction fee', async () => {
      const r = await PricingEngineService.calculateOrderPricing({
        subtotalAmount: SUBTOTAL,
      });
      expect(r.orderAmount).toBe(SUBTOTAL);
      expect(r.buyerTotalAmount).toBe(
        Number((SUBTOTAL + r.buyerTransactionFee.totalBuyerFeeAmount).toFixed(2)),
      );
    });
  });

  describe('Marketplace commission base', () => {
    it('is the discounted subtotal at the agreed 2.00%', async () => {
      const r = await PricingEngineService.calculateOrderPricing({
        subtotalAmount: SUBTOTAL,
      });

      // 2.00% of 1,000 — the seller agreement's base.
      expect(r.sellerMarketplaceCommission.amount).toBe(20);
    });

    // Settled 2026-08-20 (FLAGS.md F4). The base was the gross subtotal, so a
    // seller funding a promotion paid commission on money no buyer ever handed
    // them. A failure here means the base drifted back to gross.
    it('is net of the discount, not the gross subtotal', async () => {
      const r = await PricingEngineService.calculateOrderPricing({
        subtotalAmount: SUBTOTAL,
        discountAmount: 200,
      });

      // 2.00% of the 800 the seller actually sold.
      expect(r.sellerMarketplaceCommission.amount).toBe(16);

      // The base this must never silently become: the gross 1,000.
      expect(r.sellerMarketplaceCommission.amount).not.toBe(20);
    });

    it('falls to zero when a discount takes the basket to nothing', async () => {
      const r = await PricingEngineService.calculateOrderPricing({
        subtotalAmount: SUBTOTAL,
        discountAmount: SUBTOTAL,
      });
      expect(r.sellerMarketplaceCommission.amount).toBe(0);
    });

    it('never goes negative when a discount exceeds the subtotal', async () => {
      const r = await PricingEngineService.calculateOrderPricing({
        subtotalAmount: SUBTOTAL,
        discountAmount: SUBTOTAL + 500,
      });
      expect(r.sellerMarketplaceCommission.amount).toBe(0);
    });
  });

  describe('Seller settlement', () => {
    it('is the subtotal less the commission', async () => {
      const r = await PricingEngineService.calculateOrderPricing({
        subtotalAmount: SUBTOTAL,
      });
      // 1,000 subtotal - 20 commission.
      expect(r.sellerNetAmount).toBe(980);
    });

    it('subtracts a seller-funded discount', async () => {
      const r = await PricingEngineService.calculateOrderPricing({
        subtotalAmount: SUBTOTAL,
        discountAmount: 200,
      });
      // 1,000 - 200 - 16 commission. The commission is 2% of the discounted
      // 800, not the gross 1,000 — see the commission base tests.
      expect(r.sellerNetAmount).toBe(784);
    });
  });

  describe('Payment fee payer policy', () => {
    const input = { subtotalAmount: SUBTOTAL };

    it('BUYER: the buyer carries the gateway cost', async () => {
      const r = await PricingEngineService.calculateOrderPricing({
        ...input,
        paymentFeePayerPolicy: 'BUYER',
      });
      expect(r.buyerTransactionFee.providerProcessingFee).toBe(
        r.paymentProcessingCost.calculatedCost,
      );
      expect(r.sellerNetAmount).toBe(980);
    });

    it('SELLER: the gateway cost comes out of the settlement, not the buyer', async () => {
      const r = await PricingEngineService.calculateOrderPricing({
        ...input,
        paymentFeePayerPolicy: 'SELLER',
      });
      expect(r.buyerTransactionFee.providerProcessingFee).toBe(0);
      // 1,000 - 20 commission - 20 gateway
      expect(r.sellerNetAmount).toBe(960);
      // The platform already recovered it from the seller.
      expect(r.platformPaymentCost).toBe(0);
    });

    it('PLATFORM: neither buyer nor seller carries the gateway cost', async () => {
      const r = await PricingEngineService.calculateOrderPricing({
        ...input,
        paymentFeePayerPolicy: 'PLATFORM',
      });
      expect(r.buyerTransactionFee.providerProcessingFee).toBe(0);
      expect(r.sellerNetAmount).toBe(980);
      expect(r.platformPaymentCost).toBe(r.paymentProcessingCost.calculatedCost);
    });

    it('adds no platform handling fee — that 0.23% was GCash rate, not margin', async () => {
      // Retired 2026-08-20. The old 0.23% was the remainder of GCash's 2.23%
      // after it was split into a fictional cost-plus-margin, so the platform
      // booked revenue it had already remitted. See FLAGS.md.
      for (const policy of ['BUYER', 'SELLER', 'PLATFORM', 'SHARED'] as const) {
        const r = await PricingEngineService.calculateOrderPricing({
          ...input,
          paymentFeePayerPolicy: policy,
        });
        expect(r.buyerTransactionFee.platformHandlingFee).toBe(0);
      }
    });

    it('SHARED: buyer and seller split the gateway cost, not buyer and platform', async () => {
      // The seller's half used to be left unassigned, so the platform absorbed
      // it. See FLAGS.md F29.
      const r = await PricingEngineService.calculateOrderPricing({
        ...input,
        paymentFeePayerPolicy: 'SHARED',
      });
      const cost = r.paymentProcessingCost.calculatedCost;

      expect(r.buyerTransactionFee.providerProcessingFee).toBeCloseTo(cost / 2, 2);
      // Whatever the buyer did not cover comes off the settlement.
      expect(r.sellerNetAmount).toBeCloseTo(980 - (cost - cost / 2), 2);
      // Between them the two halves cover the gateway in full, so the platform
      // still nets exactly its commission and carries none of the cost.
      expect(r.platformNetRevenue).toBeCloseTo(20, 2);
    });
  });

  describe('Cash orders', () => {
    it('carry no gateway cost', async () => {
      const r = await PricingEngineService.calculateOrderPricing({
        subtotalAmount: SUBTOTAL,
        paymentMethodCode: 'CASH',
      });
      expect(r.paymentProcessingCost.calculatedCost).toBe(0);
    });
  });

  describe('Buyer total', () => {
    it('is order amount plus the buyer transaction fee, and nothing else', async () => {
      const r = await PricingEngineService.calculateOrderPricing({
        subtotalAmount: SUBTOTAL,
        discountAmount: 50,
      });
      expect(r.orderAmount).toBe(SUBTOTAL - 50);
      expect(r.buyerTotalAmount).toBe(
        Number((r.orderAmount + r.buyerTransactionFee.totalBuyerFeeAmount).toFixed(2)),
      );
    });
  });
});
