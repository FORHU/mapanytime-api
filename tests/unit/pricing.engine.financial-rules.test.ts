import PricingEngineService from '../../src/modules/pricing/pricing-engine.service';
import TaxationService from '../../src/modules/taxation/taxation.service';

// The engine reads an optional PricingConfigurations row; with none stored it
// falls back to its built-in rates, which is the state every environment is in
// today. These tests pin the confirmed business rules against that path.
jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    pricingConfigurations: { findFirst: jest.fn().mockResolvedValue(null) },
    pricingComponents: { findFirst: jest.fn().mockResolvedValue(null) },
  },
}));

const SUBTOTAL = 1000;
const SHIPPING = 100;

describe('Confirmed financial rules', () => {
  describe('VAT', () => {
    it('is 12% of subtotal', () => {
      expect(TaxationService.calculateTax(SUBTOTAL)).toBe(120);
    });

    it('is carried through the engine untouched', async () => {
      const r = await PricingEngineService.calculateOrderPricing({
        subtotalAmount: SUBTOTAL,
        taxAmount: TaxationService.calculateTax(SUBTOTAL),
      });
      expect(r.taxAmount).toBe(120);
    });
  });

  describe('Marketplace commission base', () => {
    it('is the subtotal alone — never subtotal + shipping, VAT, or both', async () => {
      const r = await PricingEngineService.calculateOrderPricing({
        subtotalAmount: SUBTOTAL,
        shippingAmount: SHIPPING,
        taxAmount: TaxationService.calculateTax(SUBTOTAL),
      });

      // 2.00% of 1,000 — the seller agreement's base.
      expect(r.sellerMarketplaceCommission.amount).toBe(20);

      // The bases this must never silently become: 1,100 / 1,120 / 1,220.
      expect(r.sellerMarketplaceCommission.amount).not.toBe(22);
      expect(r.sellerMarketplaceCommission.amount).not.toBe(22.4);
      expect(r.sellerMarketplaceCommission.amount).not.toBe(24.4);
    });

    it('does not grow when only shipping grows', async () => {
      const base = await PricingEngineService.calculateOrderPricing({
        subtotalAmount: SUBTOTAL,
      });
      const shipped = await PricingEngineService.calculateOrderPricing({
        subtotalAmount: SUBTOTAL,
        shippingAmount: 500,
      });
      expect(shipped.sellerMarketplaceCommission.amount).toBe(
        base.sellerMarketplaceCommission.amount,
      );
    });

    it('does not grow when only VAT grows', async () => {
      const base = await PricingEngineService.calculateOrderPricing({
        subtotalAmount: SUBTOTAL,
      });
      const taxed = await PricingEngineService.calculateOrderPricing({
        subtotalAmount: SUBTOTAL,
        taxAmount: 120,
      });
      expect(taxed.sellerMarketplaceCommission.amount).toBe(
        base.sellerMarketplaceCommission.amount,
      );
    });
  });

  describe('Seller settlement', () => {
    it('excludes VAT — tax is remitted, not settled to the seller', async () => {
      const r = await PricingEngineService.calculateOrderPricing({
        subtotalAmount: SUBTOTAL,
        taxAmount: TaxationService.calculateTax(SUBTOTAL),
      });
      // 1,000 subtotal - 20 commission. The 120 VAT must not reach the seller.
      expect(r.sellerNetAmount).toBe(980);
    });

    it('includes shipping and subtracts a seller-funded discount', async () => {
      const r = await PricingEngineService.calculateOrderPricing({
        subtotalAmount: SUBTOTAL,
        shippingAmount: SHIPPING,
        discountAmount: 200,
      });
      // 1,000 - 200 + 100 - 20 commission
      expect(r.sellerNetAmount).toBe(880);
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

    it('leaves the buyer platform fee in place regardless of policy', async () => {
      for (const policy of ['BUYER', 'SELLER', 'PLATFORM'] as const) {
        const r = await PricingEngineService.calculateOrderPricing({
          ...input,
          paymentFeePayerPolicy: policy,
        });
        expect(r.buyerTransactionFee.platformHandlingFee).toBeGreaterThan(0);
      }
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
        shippingAmount: SHIPPING,
        discountAmount: 50,
        taxAmount: TaxationService.calculateTax(SUBTOTAL),
      });
      expect(r.orderAmount).toBe(SUBTOTAL - 50 + SHIPPING + 120);
      expect(r.buyerTotalAmount).toBe(
        Number((r.orderAmount + r.buyerTransactionFee.totalBuyerFeeAmount).toFixed(2)),
      );
    });
  });
});
