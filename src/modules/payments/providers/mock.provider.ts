import {
  CreateCheckoutInput,
  CheckoutResult,
  PaymentProvider,
  RefundResult,
} from './payment-provider.interface';

export class MockProvider implements PaymentProvider {
  async createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutResult> {
    return {
      checkoutSessionId: `mock_cs_${input.orderId}`,
      checkoutUrl: `/mock-checkout?orderId=${input.orderId}&amount=${input.amountInCentavos / 100}`,
      paymentIntentId: `mock_pi_${input.orderId}`,
      rawResponse: { mock: true, orderId: input.orderId },
    };
  }

  /**
   * Accepts anything — that is the point of the mock, and also why it must never
   * be reachable in production. PaymentService.processProviderWebhook rejects
   * the MOCK provider there before reaching this; returning false is the second
   * layer, so a future caller that skips that check still fails closed.
   * See FLAGS.md.
   */
  verifyWebhook(_rawBody: string | Buffer, _signature: string): boolean {
    return process.env.NODE_ENV !== 'production';
  }

  async refundPayment(
    paymentReference: string,
    amountInCentavos?: number,
    _reason?: string,
  ): Promise<RefundResult> {
    return {
      refundId: `mock_ref_${Date.now()}`,
      amount: amountInCentavos || 0,
      status: 'succeeded',
      rawResponse: { mock: true, paymentReference },
    };
  }
}
