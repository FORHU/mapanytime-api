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
  // null when the provider has no external checkout page to redirect to
  // (e.g. MockProvider) — the client skips the redirect step in that case.
  checkoutUrl: string | null;
  paymentIntentId?: string;
  rawResponse?: unknown;
}

export interface RefundResult {
  refundId: string;
  amount: number;
  status: string;
  rawResponse?: unknown;
}

export interface WebhookEvent {
  eventId: string;
  eventType: string;
  orderId: string | null;
  isSuccess: boolean;
  isFailure: boolean;
  // Gateway-side reference for the successful charge, stored on
  // Payments.providerReference. Falls back to eventId at the call site if
  // a provider has nothing more specific.
  providerReference: string | null;
  // Only meaningful when isFailure is true.
  failureReason: string | null;
}

export interface PaymentProvider {
  createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutResult>;
  verifyWebhook(rawBody: string | Buffer, signatureHeader: string): boolean;
  /**
   * Normalizes a provider's own webhook payload shape into the generic
   * event shape `PaymentService.processProviderWebhook` consumes — each
   * gateway's payload is structurally different (PayMongo's deeply nested
   * envelope vs. Xendit's flat `{event, data}`), so this is where that
   * difference is contained instead of leaking into the shared processor.
   */
  parseWebhookEvent(payload: unknown): WebhookEvent;
  refundPayment?(
    paymentReference: string,
    amountInCentavos?: number,
    reason?: string,
  ): Promise<RefundResult>;
}
