export interface CreateCheckoutInput {
  orderId: string;
  amountInCentavos: number;
  currency: string;
  description: string;
  lineItems: Array<{
    name: string;
    quantity: number;
    amount: number; // in centavos
    currency: string;
  }>;
  customer?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  successUrl?: string;
  cancelUrl?: string;
  metadata?: Record<string, string>;
  /**
   * The `PaymentMethods.code` the buyer selected. Providers restrict the
   * session to this one method so the rate the order was priced at is the rate
   * that actually gets billed.
   */
  paymentMethodCode?: string;
}

export interface CheckoutResult {
  checkoutSessionId: string;
  checkoutUrl: string;
  paymentIntentId?: string;
  rawResponse?: unknown;
}

export interface RefundResult {
  refundId: string;
  amount: number;
  status: string;
  rawResponse?: unknown;
}

export interface PaymentProvider {
  createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutResult>;
  verifyWebhook(rawBody: string | Buffer, signatureHeader: string): boolean;
  refundPayment?(
    paymentReference: string,
    amountInCentavos?: number,
    reason?: string,
  ): Promise<RefundResult>;
}
