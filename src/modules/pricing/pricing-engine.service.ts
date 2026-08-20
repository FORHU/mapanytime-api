import { prisma } from '../../utils/prisma';
import logger from '../../utils/logger';

export type PaymentFeePayerPolicy = 'BUYER' | 'SELLER' | 'PLATFORM' | 'SHARED';

export interface PricingCalculationInput {
  subtotalAmount: number;
  discountAmount?: number;
  shippingAmount?: number;
  storeId?: string;
  sellerId?: string;
  sellerPlan?: string;
  categoryId?: string;
  providerId?: string;
  paymentMethodId?: string;
  paymentMethodCode?: string;
  /**
   * The method's `PAYMENTMETHODTYPE`. Cash is zero-rated off this rather than
   * off `paymentMethodCode`: the seeded cash method's code is `COD`, so a code
   * comparison against 'CASH' never matched a real order and every
   * pay-at-the-stall buyer was charged a gateway fee for a gateway that never
   * ran. See FLAGS.md F31.
   */
  paymentMethodType?: string;
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
  orderAmount: number; // Subtotal - Discount + Shipping

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
   * policy is SELLER).
   */
  sellerNetAmount: number;

  // 6. Platform Financial Economics
  platformGrossRevenue: number; // Commission + Buyer Platform Fee + (Buyer absorbed gateway fee)
  platformPaymentCost: number; // Incurred gateway cost
  platformNetRevenue: number; // Platform Gross Revenue - Platform Payment Cost
}

const DEFAULT_SELLER_COMMISSION_RATE = 0.02; // 2.00% Seller Marketplace Fee

/**
 * Fallback gateway rate, used only when no `PricingConfigurations` row matches.
 * It understates every real PayMongo rate (GCash 2.23%, Maya 1.79%, domestic
 * card 3.125% + P13.39), so any order priced off it undercharges the buyer and
 * the platform absorbs the difference. Seed a configuration — see FLAGS.md F2.
 */
const DEFAULT_PAYMENT_GATEWAY_RATE = 0.02;

/**
 * Platform handling margin on top of the gateway's own cost.
 *
 * Zero by decision (2026-08-20): the previous 0.23% was not margin at all. It
 * was the remainder of GCash's 2.23% after someone split that single rate into
 * a fictional "2% cost + 0.23% margin", so the platform booked revenue it had
 * already remitted to PayMongo. Platform revenue is the commission alone.
 * Raise this only to charge a real, deliberate markup. See FLAGS.md.
 */
const DEFAULT_BUYER_PLATFORM_RATE = 0;

/**
 * Fraction of the gateway cost that is added to what the buyer pays, per payer
 * policy. This drives the gross-up: only the part added on top enlarges the
 * amount the gateway bills against.
 */
const BUYER_COST_SHARE: Record<PaymentFeePayerPolicy, number> = {
  BUYER: 1,
  SHARED: 0.5,
  SELLER: 0,
  PLATFORM: 0,
};

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

    // Eligible transaction base amount. No tax term: the platform is a
    // marketplace intermediary and collects no VAT on the seller's goods.
    // See FLAGS.md.
    const orderAmount = Math.max(0, subtotal - discount + shipping);

    // ── STEP 1: Resolve Active Pricing Configuration Container ────────
    const activePricingConfig = await this.getActivePricingConfiguration();

    // The policy is resolved before the gateway cost because it decides how
    // much of that cost is added to the buyer's total — which is the amount
    // the gateway then bills against. See `grossUp`.
    const policy: PaymentFeePayerPolicy = input.paymentFeePayerPolicy || 'BUYER';
    const buyerCostShare = BUYER_COST_SHARE[policy];

    // ── STEP 2: Resolve Payment Processing Gateway Cost ───────────────
    const paymentProcessingCost = await this.resolvePaymentProcessingCost(
      orderAmount,
      activePricingConfig?.id,
      input,
      buyerCostShare,
    );

    // ── STEP 3: Resolve Buyer Platform Handling Fee ───────────────────
    const buyerPlatformFee = await this.resolveBuyerPlatformFee(
      orderAmount,
      activePricingConfig?.id,
      input,
    );

    // ── STEP 4: Apply Payment Fee Payer Policy ────────────────────────
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
        // Buyer half, seller half. The seller's half was previously left
        // unassigned, so the platform silently absorbed it and SHARED behaved
        // as "buyer half / platform half". See FLAGS.md F29.
        buyerProviderCostPortion = Number((paymentProcessingCost.calculatedCost / 2).toFixed(2));
        sellerPaymentDeduction = Number(
          (paymentProcessingCost.calculatedCost - buyerProviderCostPortion).toFixed(2),
        );
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
    // Charged on the goods subtotal only. Shipping is pass-through, so it does
    // not belong in the commission base.
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
      const config = await prisma.pricingConfigurations.findFirst({
        where: {
          status: 'ACTIVE',
          effectiveFrom: { lte: now },
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: now } }],
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      });

      if (!config) this.warnNoConfiguration();
      return config;
    } catch {
      this.warnNoConfiguration();
      return null;
    }
  }

  /**
   * A missing configuration used to be indistinguishable from a correct one —
   * the engine silently priced every order off its fallback constants. Warn
   * once per process so the state is visible without flooding the log on every
   * order. See FLAGS.md F2.
   */
  private static warnedNoConfiguration = false;
  private static warnNoConfiguration() {
    if (this.warnedNoConfiguration) return;
    this.warnedNoConfiguration = true;
    logger.warn(
      '[Pricing] No ACTIVE PricingConfigurations row matched. Every order is ' +
        'pricing off built-in fallback rates, which understate the real ' +
        'PayMongo rates — the platform absorbs the difference. See FLAGS.md F2.',
    );
  }

  /**
   * Gross up a gateway fee so it survives being charged on the captured total.
   *
   * PayMongo bills its rate against the amount actually captured. Under `BUYER`
   * the fee is added on top of the order, so the gateway bills against
   * `order + fee` and a plain `amount * rate + fixed` leaves the platform short
   * by `fee * rate`. Under `SELLER` or `PLATFORM` nothing is added — the buyer
   * pays the order amount and the fee is recovered afterwards — so the captured
   * total is the order alone and there is nothing to gross up. `SHARED` adds
   * half.
   *
   * Solving `captured = amount + cost * buyerShare` against
   * `cost = captured * rate + fixed` gives the divisor below. See FLAGS.md F30.
   */
  private static grossUp(amount: number, rate: number, fixed: number, buyerShare = 1): number {
    if (rate <= 0 && fixed <= 0) return 0;
    const divisor = 1 - rate * buyerShare;
    if (divisor <= 0) return amount * rate + fixed; // nonsensical rate; never divide by <= 0
    return (amount * rate + fixed) / divisor;
  }

  private static async resolvePaymentProcessingCost(
    amount: number,
    pricingId?: string,
    context?: PricingCalculationInput,
    buyerShare = 1,
  ): Promise<PaymentProcessingCostBreakdown> {
    // Cash never touches a gateway, so there is nothing to charge for. Keyed on
    // the method TYPE: the seeded cash method's code is `COD`, so the old
    // comparison against the string 'CASH' never matched and every
    // pay-at-the-stall order carried a phantom gateway fee. See FLAGS.md F31.
    if (this.isCashPayment(context)) {
      return {
        providerId: context?.providerId,
        paymentMethodId: context?.paymentMethodId,
        componentName: 'In-Store Cash',
        ratePercentage: 0,
        fixedAmount: 0,
        calculatedCost: 0,
      };
    }

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
          let calculated = this.grossUp(amount, rate, fixed, buyerShare);
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

    // No configured component matched. This is the state every environment is
    // in until a PricingConfigurations row exists, and it understates every
    // real rate — see FLAGS.md F2.
    const rate = DEFAULT_PAYMENT_GATEWAY_RATE;
    const cost = this.grossUp(amount, rate, 0, buyerShare);

    return {
      providerId: context?.providerId,
      paymentMethodId: context?.paymentMethodId,
      componentName: 'Default Gateway Processing Fee',
      ratePercentage: rate,
      fixedAmount: 0,
      calculatedCost: Number(cost.toFixed(2)),
    };
  }

  /**
   * True when the buyer settles in cash at the stall. Matches on
   * `PAYMENTMETHODTYPE.CASH`, falling back to the legacy code spellings so an
   * older client that still sends `CASH_ON_DELIVERY` is not charged a gateway
   * fee either.
   */
  private static isCashPayment(context?: PricingCalculationInput): boolean {
    if (context?.paymentMethodType?.toUpperCase() === 'CASH') return true;
    const code = context?.paymentMethodCode?.toUpperCase();
    return code === 'CASH' || code === 'COD' || code === 'CASH_ON_DELIVERY';
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
