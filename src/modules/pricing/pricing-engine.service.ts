import { prisma } from '../../utils/prisma';

export type PaymentFeePayerPolicy = 'BUYER' | 'SELLER' | 'PLATFORM' | 'SHARED';

export interface PricingCalculationInput {
  subtotalAmount: number;
  discountAmount?: number;
  shippingAmount?: number;
  taxAmount?: number;
  storeId?: string;
  sellerId?: string;
  sellerPlan?: string;
  categoryId?: string;
  providerId?: string;
  paymentMethodId?: string;
  paymentMethodCode?: string;
  paymentFeePayerPolicy?: PaymentFeePayerPolicy;
}

export interface PaymentProcessingCostBreakdown {
  providerId?: string;
  paymentMethodId?: string;
  componentName?: string;
  ratePercentage: number;
  fixedAmount: number;
  calculatedCost: number; // Actual gateway charge from PayMongo/Bank/Card
}

export interface BuyerPlatformFeeBreakdown {
  componentName?: string;
  ratePercentage: number;
  fixedAmount: number;
  amount: number; // Platform fee added to buyer (e.g. 0.23%)
}

export interface BuyerTransactionFeeBreakdown {
  payerPolicy: PaymentFeePayerPolicy;
  providerProcessingFee: number; // Provider cost passed to buyer (e.g. 2.00%)
  platformHandlingFee: number; // Platform handling fee (e.g. 0.23%)
  totalBuyerFeeAmount: number; // e.g. 2.23% total
  /**
   * Combined rate the buyer was actually charged, as a fraction of the order
   * amount. Varies with the payer policy, so it is not interchangeable with the
   * gateway rate — this is the number snapshotted onto Orders.
   */
  effectiveRatePercentage: number;
}

export interface SellerMarketplaceCommissionBreakdown {
  componentId?: string;
  label: string;
  rate: number;
  amount: number; // MapAnytime marketplace commission, charged on the goods subtotal
}

export interface OrderPricingResult {
  // 1. Order Core
  subtotalAmount: number;
  discountAmount: number;
  shippingAmount: number;
  taxAmount: number;
  orderAmount: number; // Subtotal - Discount + Shipping + Tax

  // 2. Gateway Processing Cost
  paymentProcessingCost: PaymentProcessingCostBreakdown;

  // 3. Buyer Platform Handling Fee
  buyerPlatformFee: BuyerPlatformFeeBreakdown;

  // 4. Combined Buyer Transaction Fee (Based on policy)
  buyerTransactionFee: BuyerTransactionFeeBreakdown;
  buyerTotalAmount: number; // Order Amount + Buyer Transaction Fee

  // 5. Seller Marketplace Commission & Settlement
  sellerMarketplaceCommission: SellerMarketplaceCommissionBreakdown;
  /**
   * Subtotal - Discount + Shipping - Commission (- gateway fee when the payer
   * policy is SELLER). Excludes tax, which is remitted rather than settled.
   */
  sellerNetAmount: number;

  // 6. Platform Financial Economics
  platformGrossRevenue: number; // Commission + Buyer Platform Fee + (Buyer absorbed gateway fee)
  platformPaymentCost: number; // Incurred gateway cost
  platformNetRevenue: number; // Platform Gross Revenue - Platform Payment Cost
}

const DEFAULT_SELLER_COMMISSION_RATE = 0.02; // 2.00% Seller Marketplace Fee
const DEFAULT_PAYMENT_GATEWAY_RATE = 0.02; // 2.00% Base Gateway Processing Cost
const DEFAULT_BUYER_PLATFORM_RATE = 0.0023; // 0.23% Buyer Platform Fee (Combined 2.23%)

export class PricingEngineService {
  /**
   * Versioned, configuration-driven pricing engine.
   * Resolves:
   *  1. Active PricingConfiguration container
   *  2. Payment Processing Cost (Gateway cost)
   *  3. Buyer Platform Fee
   *  4. Buyer Payment Fee Policy (BUYER / PLATFORM / SELLER / SHARED)
   *  5. Seller Marketplace Commission
   */
  static async calculateOrderPricing(input: PricingCalculationInput): Promise<OrderPricingResult> {
    const subtotal = Math.max(0, Number(input.subtotalAmount) || 0);
    const discount = Math.max(0, Number(input.discountAmount) || 0);
    const shipping = Math.max(0, Number(input.shippingAmount) || 0);
    const tax = Math.max(0, Number(input.taxAmount) || 0);

    // Eligible transaction base amount
    const orderAmount = Math.max(0, subtotal - discount + shipping + tax);

    // ── STEP 1: Resolve Active Pricing Configuration Container ────────
    const activePricingConfig = await this.getActivePricingConfiguration();

    // ── STEP 2: Resolve Payment Processing Gateway Cost ───────────────
    const paymentProcessingCost = await this.resolvePaymentProcessingCost(
      orderAmount,
      activePricingConfig?.id,
      input,
    );

    // ── STEP 3: Resolve Buyer Platform Handling Fee ───────────────────
    const buyerPlatformFee = await this.resolveBuyerPlatformFee(
      orderAmount,
      activePricingConfig?.id,
      input,
    );

    // ── STEP 4: Apply Payment Fee Payer Policy ────────────────────────
    const policy: PaymentFeePayerPolicy = input.paymentFeePayerPolicy || 'BUYER';
    let buyerProviderCostPortion = 0;
    let sellerPaymentDeduction = 0;

    switch (policy) {
      case 'BUYER':
        buyerProviderCostPortion = paymentProcessingCost.calculatedCost;
        break;
      case 'PLATFORM':
        buyerProviderCostPortion = 0;
        break;
      case 'SELLER':
        buyerProviderCostPortion = 0;
        sellerPaymentDeduction = paymentProcessingCost.calculatedCost;
        break;
      case 'SHARED':
        buyerProviderCostPortion = Number((paymentProcessingCost.calculatedCost / 2).toFixed(2));
        break;
    }

    const totalBuyerFeeAmount = Number(
      (buyerProviderCostPortion + buyerPlatformFee.amount).toFixed(2),
    );

    const buyerTransactionFee: BuyerTransactionFeeBreakdown = {
      payerPolicy: policy,
      providerProcessingFee: Number(buyerProviderCostPortion.toFixed(2)),
      platformHandlingFee: buyerPlatformFee.amount,
      totalBuyerFeeAmount,
      effectiveRatePercentage:
        orderAmount > 0 ? Number((totalBuyerFeeAmount / orderAmount).toFixed(5)) : 0,
    };

    // ── STEP 5: Resolve Seller Marketplace Commission ─────────────────
    // Charged on the goods subtotal only. Shipping is pass-through and tax is
    // remitted, so neither belongs in the commission base.
    const commission = await this.resolveSellerCommission(subtotal, activePricingConfig?.id, input);

    // ── STEP 6: Calculate Final Checkout Totals & Settlements ────────
    const buyerTotalAmount = Number((orderAmount + totalBuyerFeeAmount).toFixed(2));
    const sellerNetAmount = Number(
      Math.max(
        0,
        subtotal - discount + shipping - commission.amount - sellerPaymentDeduction,
      ).toFixed(2),
    );

    // ── STEP 7: Platform Economics ───────────────────────────────────
    const platformGrossRevenue = Number((commission.amount + totalBuyerFeeAmount).toFixed(2));
    // Only the portion nobody else covers lands on the platform: the buyer's
    // share arrives via totalBuyerFeeAmount and the seller's via sellerPaymentDeduction.
    const platformPaymentCost = Number(
      Math.max(0, paymentProcessingCost.calculatedCost - sellerPaymentDeduction).toFixed(2),
    );
    const platformNetRevenue = Number((platformGrossRevenue - platformPaymentCost).toFixed(2));

    return {
      subtotalAmount: Number(subtotal.toFixed(2)),
      discountAmount: Number(discount.toFixed(2)),
      shippingAmount: Number(shipping.toFixed(2)),
      taxAmount: Number(tax.toFixed(2)),
      orderAmount: Number(orderAmount.toFixed(2)),
      paymentProcessingCost,
      buyerPlatformFee,
      buyerTransactionFee,
      buyerTotalAmount,
      sellerMarketplaceCommission: commission,
      sellerNetAmount,
      platformGrossRevenue,
      platformPaymentCost,
      platformNetRevenue,
    };
  }

  private static async getActivePricingConfiguration() {
    try {
      const now = new Date();
      return await prisma.pricingConfigurations.findFirst({
        where: {
          status: 'ACTIVE',
          effectiveFrom: { lte: now },
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: now } }],
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      });
    } catch {
      return null;
    }
  }

  private static async resolvePaymentProcessingCost(
    amount: number,
    pricingId?: string,
    context?: PricingCalculationInput,
  ): Promise<PaymentProcessingCostBreakdown> {
    try {
      if (pricingId) {
        const component = await prisma.pricingComponents.findFirst({
          where: {
            pricingId,
            type: 'PAYMENT_PROCESSING_FEE',
            isActive: true,
            AND: [
              context?.providerId
                ? { OR: [{ providerId: context.providerId }, { providerId: null }] }
                : {},
              context?.paymentMethodId
                ? { OR: [{ paymentMethodId: context.paymentMethodId }, { paymentMethodId: null }] }
                : {},
            ],
          },
          orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        });

        if (component) {
          const rate = component.ratePercentage ? Number(component.ratePercentage) : 0;
          const fixed = component.fixedAmount ? Number(component.fixedAmount) : 0;
          let calculated = amount * rate + fixed;
          if (component.minFee && calculated < Number(component.minFee))
            calculated = Number(component.minFee);
          if (component.maxFee && calculated > Number(component.maxFee))
            calculated = Number(component.maxFee);

          return {
            providerId: context?.providerId,
            paymentMethodId: context?.paymentMethodId,
            componentName: 'Configured Payment Processing Fee',
            ratePercentage: rate,
            fixedAmount: fixed,
            calculatedCost: Number(calculated.toFixed(2)),
          };
        }
      }
    } catch {
      // Fallback
    }

    const isCash = context?.paymentMethodCode?.toUpperCase() === 'CASH';
    const rate = isCash ? 0 : DEFAULT_PAYMENT_GATEWAY_RATE;
    const cost = amount * rate;

    return {
      providerId: context?.providerId,
      paymentMethodId: context?.paymentMethodId,
      componentName: isCash ? 'In-Store Cash' : 'Default Gateway Processing Fee',
      ratePercentage: rate,
      fixedAmount: 0,
      calculatedCost: Number(cost.toFixed(2)),
    };
  }

  private static async resolveBuyerPlatformFee(
    amount: number,
    pricingId?: string,
    _context?: PricingCalculationInput,
  ): Promise<BuyerPlatformFeeBreakdown> {
    try {
      if (pricingId) {
        const component = await prisma.pricingComponents.findFirst({
          where: {
            pricingId,
            type: 'BUYER_TRANSACTION_FEE',
            isActive: true,
          },
          orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        });

        if (component) {
          const rate = component.ratePercentage ? Number(component.ratePercentage) : 0;
          const fixed = component.fixedAmount ? Number(component.fixedAmount) : 0;
          let calculated = amount * rate + fixed;
          if (component.minFee && calculated < Number(component.minFee))
            calculated = Number(component.minFee);
          if (component.maxFee && calculated > Number(component.maxFee))
            calculated = Number(component.maxFee);

          return {
            componentName: 'Buyer Platform Handling Fee',
            ratePercentage: rate,
            fixedAmount: fixed,
            amount: Number(calculated.toFixed(2)),
          };
        }
      }
    } catch {
      // Fallback
    }

    const rate = DEFAULT_BUYER_PLATFORM_RATE;
    const fee = amount * rate;
    return {
      componentName: 'Standard Buyer Platform Fee (0.23%)',
      ratePercentage: rate,
      fixedAmount: 0,
      amount: Number(fee.toFixed(2)),
    };
  }

  private static async resolveSellerCommission(
    amount: number,
    pricingId?: string,
    context?: PricingCalculationInput,
  ): Promise<SellerMarketplaceCommissionBreakdown> {
    try {
      if (pricingId) {
        const component = await prisma.pricingComponents.findFirst({
          where: {
            pricingId,
            type: 'SELLER_MARKETPLACE_FEE',
            isActive: true,
            AND: [
              context?.storeId ? { OR: [{ storeId: context.storeId }, { storeId: null }] } : {},
              context?.sellerPlan
                ? { OR: [{ sellerPlan: context.sellerPlan }, { sellerPlan: null }] }
                : {},
              context?.categoryId
                ? { OR: [{ categoryId: context.categoryId }, { categoryId: null }] }
                : {},
            ],
          },
          orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        });

        if (component) {
          const rate = component.ratePercentage
            ? Number(component.ratePercentage)
            : DEFAULT_SELLER_COMMISSION_RATE;
          const fee = amount * rate;
          return {
            componentId: component.id,
            label: 'Seller Marketplace Commission',
            rate,
            amount: Number(fee.toFixed(2)),
          };
        }
      }
    } catch {
      // Fallback
    }

    const commissionAmount = amount * DEFAULT_SELLER_COMMISSION_RATE;
    return {
      label: 'Seller Marketplace Fee (2.00%)',
      rate: DEFAULT_SELLER_COMMISSION_RATE,
      amount: Number(commissionAmount.toFixed(2)),
    };
  }
}

export default PricingEngineService;
