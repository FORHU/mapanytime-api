import axios from 'axios';
import crypto from 'crypto';
import {
  CreateCheckoutInput,
  CheckoutResult,
  PaymentProvider,
  RefundResult,
} from './payment-provider.interface';

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
          payment_method_types: ['card', 'gcash', 'paymaya', 'grab_pay', 'dob', 'qrph'],
          reference_number: input.orderId,
          success_url:
            input.successUrl ||
            `${process.env.FRONTEND_URL || 'http://localhost:3000'}/orders/${input.orderId}?status=success`,
          cancel_url:
            input.cancelUrl ||
            `${process.env.FRONTEND_URL || 'http://localhost:3000'}/orders/${input.orderId}?status=cancelled`,
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
