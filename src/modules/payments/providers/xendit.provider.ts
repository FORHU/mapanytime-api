import axios from 'axios';
import crypto from 'crypto';
import {
  CreateCheckoutInput,
  CheckoutResult,
  PaymentProvider,
  RefundResult,
  WebhookEvent,
} from './payment-provider.interface';

/**
 * Our `PaymentMethods.code` to Xendit's Payment Sessions `allowed_payment_channels`
 * values. Only these two are confirmed against Xendit's docs — deliberately not
 * guessing Cards/QRPH/GrabPay's channel codes here: under-restricting (omitting
 * the field, letting the buyer pick any channel on Xendit's page) is safe, a
 * wrong channel string is not.
 */
const XENDIT_CHANNEL_CODES: Record<string, string> = {
  GCASH: 'GCASH',
  MAYA: 'PAYMAYA',
};

function resolveXenditChannels(methodCode?: string): string[] | undefined {
  if (!methodCode) return undefined;
  const mapped = XENDIT_CHANNEL_CODES[methodCode.toUpperCase()];
  return mapped ? [mapped] : undefined;
}

interface XenditWebhookPayload {
  event?: string;
  data?: {
    payment_session_id?: string;
    reference_id?: string;
    status?: string;
  };
}

export class XenditProvider implements PaymentProvider {
  private secretKey = process.env.XENDIT_SECRET_KEY || '';
  private apiUrl = process.env.XENDIT_API_URL || 'https://api.xendit.co';

  private get authHeader() {
    return `Basic ${Buffer.from(`${this.secretKey}:`).toString('base64')}`;
  }

  async createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutResult> {
    // Xendit's customer object has its own required-if-present sub-fields
    // (type, etc.) — omit it entirely rather than send a partially-filled
    // shape that might 400, since it's only used to pre-fill Xendit's
    // hosted page and isn't load-bearing for the payment itself.
    const customer =
      input.customer?.email || input.customer?.phone
        ? {
            reference_id: input.orderId,
            type: 'INDIVIDUAL',
            email: input.customer.email,
            mobile_number: input.customer.phone,
            individual_detail: input.customer.name
              ? { given_names: input.customer.name }
              : undefined,
          }
        : undefined;

    const allowedChannels = resolveXenditChannels(input.paymentMethodCode);

    const payload = {
      session_type: 'PAY',
      mode: 'PAYMENT_LINK',
      currency: input.currency || 'PHP',
      // Xendit's `amount` is a decimal peso value, unlike PayMongo's centavos.
      amount: Math.round(input.amountInCentavos) / 100,
      reference_id: input.orderId,
      country: 'PH',
      customer,
      success_return_url:
        input.successUrl ||
        `${process.env.FRONTEND_URL || 'http://localhost:3000'}/orders/${input.orderId}?status=success`,
      cancel_return_url:
        input.cancelUrl ||
        `${process.env.FRONTEND_URL || 'http://localhost:3000'}/orders/${input.orderId}?status=cancelled`,
      ...(allowedChannels ? { allowed_payment_channels: allowedChannels } : {}),
    };

    const response = await axios.post(`${this.apiUrl}/sessions`, payload, {
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
    });

    const data = response.data;

    return {
      checkoutSessionId: data.payment_session_id,
      checkoutUrl: data.payment_link_url,
      rawResponse: data,
    };
  }

  /**
   * Xendit doesn't HMAC-sign like PayMongo — `x-callback-token` is a static
   * token, compared as-is against the Dashboard's Verification Token. A
   * static-token check still deserves a timing-safe compare, not `===`.
   */
  verifyWebhook(_rawBody: string | Buffer, signatureHeader: string): boolean {
    const token = process.env.XENDIT_WEBHOOK_TOKEN || '';
    if (!signatureHeader || !token) return false;

    const received = Buffer.from(signatureHeader);
    const expected = Buffer.from(token);
    if (received.length !== expected.length) return false;

    return crypto.timingSafeEqual(received, expected);
  }

  parseWebhookEvent(payload: unknown): WebhookEvent {
    const p = payload as XenditWebhookPayload;
    const eventType = p?.event || 'unknown';
    const status = p?.data?.status;
    const eventId = p?.data?.payment_session_id || `evt_${Date.now()}`;
    const orderId = p?.data?.reference_id || null;

    const isSuccess = eventType === 'payment_session.completed' || status === 'COMPLETED';
    const isFailure =
      eventType === 'payment_session.expired' || status === 'EXPIRED' || status === 'CANCELED';

    return {
      eventId,
      eventType,
      orderId,
      isSuccess,
      isFailure,
      providerReference: p?.data?.payment_session_id || null,
      failureReason: isFailure ? `Xendit payment session ${status || eventType}` : null,
    };
  }

  // No refundPayment — optional on the interface, not needed to unblock
  // sandbox checkout testing. Add once refunds are actually exercised
  // against Xendit rather than guess its Refunds API shape now.
}
