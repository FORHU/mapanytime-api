import {
  CreateCheckoutInput,
  CheckoutResult,
  PaymentProvider,
  RefundResult,
  WebhookEvent,
} from './payment-provider.interface';
import { parsePayMongoShapedWebhookEvent } from './paymongo.provider';

export class MockProvider implements PaymentProvider {
  async createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutResult> {
    return {
      checkoutSessionId: `mock_cs_${input.orderId}`,
      // No real checkout page exists in mock mode — a fabricated relative
      // URL like `/mock-checkout?...` isn't launchable by url_launcher (no
      // scheme/host for Android to resolve an Activity against), and threw
      // ACTIVITY_NOT_FOUND on every mock checkout. null tells the client
      // there's nothing to redirect to, so it goes straight to confirmation.
      checkoutUrl: null,
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

  // The /mock-webhook route (payment.controller.ts) fabricates PayMongo-shaped
  // payloads rather than a shape of its own, so reuse that parser.
  parseWebhookEvent(payload: unknown): WebhookEvent {
    return parsePayMongoShapedWebhookEvent(payload);
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
