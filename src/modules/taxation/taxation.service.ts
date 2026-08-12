import TaxationRepository from './taxation.repository';

export interface FinancialBreakdown {
  subtotalAmount: number;
  shippingAmount: number;
  discountAmount: number;
  taxAmount: number;
  marketplaceFeeAmount: number;
  paymentFeeAmount: number;
  sellerNetAmount: number;
  totalAmount: number;
}

export default class TaxationService {
  /**
   * Calculate Sales Tax / VAT (default 12% standard rate if unspecified).
   */
  static calculateTax(amount: number, taxRate: number = 0.12): number {
    if (amount <= 0 || taxRate <= 0) return 0;
    return Math.round(amount * taxRate * 100) / 100;
  }

  /**
   * Calculate Marketplace Fee / Commission based on Category rules or default global rate (5%).
   */
  static async calculateCommission(subtotal: number, categoryId?: string): Promise<number> {
    if (subtotal <= 0) return 0;

    const rule = await TaxationRepository.getCommissionRuleForCategory(categoryId);
    const rate = rule ? Number(rule.commissionRate) : 0.05; // 5% fallback
    const fixedFee = rule ? Number(rule.fixedFee) : 0;

    const commission = subtotal * rate + fixedFee;
    return Math.round(commission * 100) / 100;
  }

  /**
   * Calculate complete order financial breakdown (tax, commission, net seller payout).
   */
  static async calculateOrderFinancials(params: {
    subtotalAmount: number;
    shippingAmount?: number;
    discountAmount?: number;
    paymentFeeAmount?: number;
    categoryId?: string;
    taxRate?: number;
  }): Promise<FinancialBreakdown> {
    const subtotal = Math.max(0, params.subtotalAmount);
    const shipping = Math.max(0, params.shippingAmount ?? 0);
    const discount = Math.max(0, params.discountAmount ?? 0);
    const paymentFee = Math.max(0, params.paymentFeeAmount ?? 0);

    const taxAmount = this.calculateTax(subtotal, params.taxRate);
    const marketplaceFeeAmount = await this.calculateCommission(subtotal, params.categoryId);

    // Total cost to buyer = subtotal + shipping + tax - discount
    const totalAmount = Math.round((subtotal + shipping + taxAmount - discount) * 100) / 100;

    // Seller Net = subtotal - marketplaceFee - paymentFee - discount + shipping
    const sellerNetAmount = Math.max(
      0,
      Math.round((subtotal + shipping - discount - marketplaceFeeAmount - paymentFee) * 100) / 100,
    );

    return {
      subtotalAmount: subtotal,
      shippingAmount: shipping,
      discountAmount: discount,
      taxAmount,
      marketplaceFeeAmount,
      paymentFeeAmount: paymentFee,
      sellerNetAmount,
      totalAmount,
    };
  }
}
