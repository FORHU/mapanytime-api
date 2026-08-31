import axios from 'axios';
import crypto from 'crypto';
import { MAPANYTIME_WEB_APP_URL } from '../../../config';
import {
  CreateCheckoutInput,
  CheckoutResult,
  PaymentProvider,
  RefundResult,
  WebhookEvent,
} from './payment-provider.interface';

interface PayMongoEventData {
  id?: string;
  attributes?: {
    reference_number?: string;
    remarks?: string;
    failure_reason?: string;
    metadata?: Record<string, string>;
  };
}

/**
 * PayMongo's webhook envelope — deeply nested, unlike Xendit's flat shape.
 * The inner event's payload data can show up nested under `attributes.data`
 * or directly as a sibling `data` depending on event type, hence both.
 */
interface PayMongoWebhookPayload {
  data?: {
    id?: string;
    type?: string;
    attributes?: {
      type?: string;
      data?: PayMongoEventData;
    };
    data?: PayMongoEventData;
  };
}

/**
 * Standalone so `MockProvider` can reuse it — its `/mock-webhook` route
 * fabricates PayMongo-shaped payloads rather than a shape of its own.
 */
export function parsePayMongoShapedWebhookEvent(payload: unknown): WebhookEvent {
  const p = payload as PayMongoWebhookPayload;
  const event = p?.data;
  const eventId = event?.id || `evt_${Date.now()}`;
  const eventType = event?.attributes?.type || event?.type || 'unknown';

  const eventData = event?.attributes?.data || event?.data;
  const attributes = eventData?.attributes || {};
  const orderId =
    attributes.reference_number ||
    attributes.remarks?.replace('Order ID: ', '') ||
    attributes.metadata?.orderId ||
    null;

  const isSuccess =
    eventType === 'checkout_session.payment.paid' ||
    eventType === 'link.payment.paid' ||
    eventType === 'payment.paid';
  const isFailure =
    eventType === 'payment.failed' || eventType === 'checkout_session.payment.failed';

  return {
    eventId,
    eventType,
    orderId,
    isSuccess,
    isFailure,
    providerReference: eventData?.id || eventId,
    failureReason: attributes.failure_reason || null,
  };
}

/** Our `PaymentMethods.code` to PayMongo's `payment_method_types` values. */
const PAYMONGO_METHOD_TYPES: Record<string, string> = {
  GCASH: 'gcash',
  MAYA: 'paymaya',
  CARD: 'card',
  QRPH: 'qrph',
  GRAB_PAY: 'grab_pay',
  DOB: 'dob',
};

const ALL_PAYMONGO_METHOD_TYPES = ['card', 'gcash', 'paymaya', 'grab_pay', 'dob', 'qrph'];

/**
 * Restrict the session to the single method the buyer already chose.
 *
 * Offering the full list here would let PayMongo's hosted page decide the
 * method *after* we priced the order — and each method bills a different rate
 * (GCash 2.23%, Maya 1.79%, card 3.125% + P13.39). The buyer would then be
 * charged one method's fee while PayMongo billed another's, and the platform
 * would absorb the difference. Falls back to the full list only when no method
 * is known, so an older caller still works.
 */
function resolvePaymentMethodTypes(methodCode?: string): string[] {
  if (!methodCode) return ALL_PAYMONGO_METHOD_TYPES;
  const mapped = PAYMONGO_METHOD_TYPES[methodCode.toUpperCase()];
  return mapped ? [mapped] : ALL_PAYMONGO_METHOD_TYPES;
}

export class PayMongoProvider implements PaymentProvider {
  private secretKey = process.env.PAYMONGO_SECRET_KEY || '';
  private webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET_KEY || '';
  private apiUrl = process.env.PAYMONGO_API_URL || 'https://api.paymongo.com/v1';

  private get authHeader() {
    return `Basic ${Buffer.from(`${this.secretKey}:`).toString('base64')}`;
  }

  async createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutResult> {
    const formattedLineItems =
      input.lineItems && input.lineItems.length > 0
        ? input.lineItems.map((item) => ({
            name: item.name,
            quantity: item.quantity,
            amount: Math.round(item.amount), // in centavos
            currency: item.currency || 'PHP',
          }))
        : [
            {
              name: input.description || `Order #${input.orderId}`,
              quantity: 1,
              amount: Math.round(input.amountInCentavos),
              currency: input.currency || 'PHP',
            },
          ];

    const payload = {
      data: {
        attributes: {
          billing: input.customer
            ? {
                name: input.customer.name,
                email: input.customer.email,
                phone: input.customer.phone,
              }
            : undefined,
          send_email_receipt: true,
          show_description: true,
          show_line_items: true,
          description: input.description,
          line_items: formattedLineItems,
          payment_method_types: resolvePaymentMethodTypes(input.paymentMethodCode),
          reference_number: input.orderId,
          // Read from config rather than the environment so the configured
          // name is the one that reaches here. Unlike Xendit, PayMongo accepts
          // a plain-HTTP localhost URL, so this keeps the raw value and its
          // localhost default instead of the strict https-only base.
          success_url:
            input.successUrl ||
            `${MAPANYTIME_WEB_APP_URL || 'http://localhost:3000'}/orders/${input.orderId}?status=success`,
          cancel_url:
            input.cancelUrl ||
            `${MAPANYTIME_WEB_APP_URL || 'http://localhost:3000'}/orders/${input.orderId}?status=cancelled`,
          metadata: {
            orderId: input.orderId,
            ...(input.metadata || {}),
          },
        },
      },
    };

    const response = await axios.post(`${this.apiUrl}/checkout_sessions`, payload, {
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
    });

    const sessionData = response.data?.data;

    return {
      checkoutSessionId: sessionData.id,
      checkoutUrl: sessionData.attributes.checkout_url,
      paymentIntentId: sessionData.attributes.payment_intent?.id,
      rawResponse: sessionData,
    };
  }

  verifyWebhook(rawBody: string | Buffer, signatureHeader: string): boolean {
    if (!signatureHeader) return false;

    const parts = signatureHeader.split(',');
    const timestamp = parts.find((p) => p.trim().startsWith('t='))?.split('=')[1];
    const testSignature = parts.find((p) => p.trim().startsWith('te='))?.split('=')[1];
    const liveSignature = parts.find((p) => p.trim().startsWith('li='))?.split('=')[1];

    if (!timestamp) return false;

    const signatureToMatch = this.secretKey.startsWith('sk_test_') ? testSignature : liveSignature;

    const bodyString = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);

    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(`${timestamp}.${bodyString}`)
      .digest('hex');

    return expectedSignature === signatureToMatch;
  }

  parseWebhookEvent(payload: unknown): WebhookEvent {
    return parsePayMongoShapedWebhookEvent(payload);
  }

  async refundPayment(
    paymentReference: string,
    amountInCentavos?: number,
    reason?: string,
  ): Promise<RefundResult> {
    const payload: {
      data: {
        attributes: {
          payment_id: string;
          reason: string;
          amount?: number;
        };
      };
    } = {
      data: {
        attributes: {
          payment_id: paymentReference,
          reason: reason || 'others',
        },
      },
    };

    if (amountInCentavos) {
      payload.data.attributes.amount = Math.round(amountInCentavos);
    }

    const response = await axios.post(`${this.apiUrl}/refunds`, payload, {
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
    });

    const refundData = response.data?.data;
    return {
      refundId: refundData.id,
      amount: refundData.attributes.amount,
      status: refundData.attributes.status,
      rawResponse: refundData,
    };
  }
}
