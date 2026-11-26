import Stripe from 'stripe';
import {
  CheckoutResult,
  CreateCheckoutInput,
  PaymentProvider,
  RefundResult,
  WebhookEvent,
} from './payment-provider.interface';
import { MAPANYTIME_WEB_APP_URL } from '../../../config';
import logger from '../../../utils/logger';

export class StripeProvider implements PaymentProvider {
  private stripe: Stripe;
  private webhookSecret: string;

  constructor(apiKey?: string, webhookSecret?: string) {
    const key = apiKey || process.env.STRIPE_SECRET_KEY || '';
    this.webhookSecret = webhookSecret || process.env.STRIPE_WEBHOOK_SECRET || '';
    this.stripe = new Stripe(key, {
      apiVersion: '2025-02-24.acacia' as Stripe.LatestApiVersion,
    });
  }

  async createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutResult> {
    const currency = (input.currency || 'PHP').toLowerCase();
    const idempotencyKey = `payment:order:${input.orderId}`;

    const formattedLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] =
      input.lineItems && input.lineItems.length > 0
        ? input.lineItems.map((item) => ({
            price_data: {
              currency: (item.currency || currency).toLowerCase(),
              product_data: {
                name: item.name,
              },
              unit_amount: Math.round(item.amount),
            },
            quantity: item.quantity,
          }))
        : [
            {
              price_data: {
                currency,
                product_data: {
                  name: input.description || `Order #${input.orderId}`,
                },
                unit_amount: Math.round(input.amountInCentavos),
              },
              quantity: 1,
            },
          ];

    const baseUrl = MAPANYTIME_WEB_APP_URL || 'http://localhost:3000';
    const successUrl = input.successUrl || `${baseUrl}/orders/${input.orderId}?status=success`;
    const cancelUrl = input.cancelUrl || `${baseUrl}/orders/${input.orderId}?status=cancelled`;

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      line_items: formattedLineItems,
      customer_email: input.customer?.email,
      client_reference_id: input.orderId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        orderId: input.orderId,
        ...(input.metadata || {}),
      },
    };

    const session = await this.stripe.checkout.sessions.create(sessionParams, {
      idempotencyKey,
    });

    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;

    return {
      checkoutSessionId: session.id,
      checkoutUrl: session.url,
      paymentIntentId,
      rawResponse: session,
    };
  }

  verifyWebhook(rawBody: string | Buffer, signatureHeader: string): boolean {
    if (!this.webhookSecret) {
      logger.warn('[StripeProvider] Webhook secret is not configured.');
      return false;
    }

    try {
      this.stripe.webhooks.constructEvent(rawBody, signatureHeader, this.webhookSecret);
      return true;
    } catch (err: unknown) {
      const error = err as Error;
      logger.warn(`[StripeProvider] Webhook signature verification failed: ${error.message}`);
      return false;
    }
  }

  parseWebhookEvent(payload: unknown): WebhookEvent {
    const event = payload as Stripe.Event;
    const eventId = event?.id || `evt_${Date.now()}`;
    const eventType = event?.type || 'unknown';

    let orderId: string | null = null;
    let providerReference: string | null = null;
    let isSuccess = false;
    let isFailure = false;
    let failureReason: string | null = null;

    if (eventType === 'checkout.session.completed') {
      const session = event.data?.object as Stripe.Checkout.Session;
      orderId = session?.metadata?.orderId || session?.client_reference_id || null;
      providerReference =
        (typeof session?.payment_intent === 'string'
          ? session.payment_intent
          : session?.payment_intent?.id) ||
        session?.id ||
        null;
      isSuccess = session?.payment_status === 'paid';
    } else if (eventType === 'payment_intent.succeeded') {
      const intent = event.data?.object as Stripe.PaymentIntent;
      orderId = intent?.metadata?.orderId || null;
      providerReference = intent?.id || null;
      isSuccess = true;
    } else if (eventType === 'payment_intent.payment_failed') {
      const intent = event.data?.object as Stripe.PaymentIntent;
      orderId = intent?.metadata?.orderId || null;
      providerReference = intent?.id || null;
      isFailure = true;
      failureReason = intent?.last_payment_error?.message || 'Payment intent failed';
    } else if (eventType === 'charge.refunded') {
      const charge = event.data?.object as Stripe.Charge;
      orderId = charge?.metadata?.orderId || null;
      providerReference = (charge?.payment_intent as string) || charge?.id || null;
      isSuccess = false;
    }

    return {
      eventId,
      eventType,
      orderId,
      isSuccess,
      isFailure,
      providerReference: providerReference || eventId,
      failureReason,
    };
  }

  async refundPayment(
    paymentReference: string,
    amountInCentavos?: number,
    reason?: string,
  ): Promise<RefundResult> {
    const idempotencyKey = `refund:order:${paymentReference}:${amountInCentavos || 'full'}`;

    const refundParams: Stripe.RefundCreateParams = {
      payment_intent: paymentReference,
      ...(amountInCentavos ? { amount: Math.round(amountInCentavos) } : {}),
    };

    if (reason === 'duplicate' || reason === 'fraudulent' || reason === 'requested_by_customer') {
      refundParams.reason = reason;
    }

    const refund = await this.stripe.refunds.create(refundParams, {
      idempotencyKey,
    });

    return {
      refundId: refund.id,
      amount: refund.amount,
      status: refund.status || 'succeeded',
      rawResponse: refund,
    };
  }
}
