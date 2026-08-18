import axios from 'axios';
import { Orders, PAYMENTMETHOD } from '@prisma/client';
import { PaymentProvider } from './payment-provider.interface';
import crypto from 'crypto';

export class PayMongoProvider implements PaymentProvider {
  private secretKey = process.env.PAYMONGO_SECRET_KEY || '';
  private webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET_KEY || '';

  async createPaymentIntent(
    order: Orders,
    amount: number,
    paymentMethod: PAYMENTMETHOD,
    description: string,
  ) {
    const response = await axios.post(
      'https://api.paymongo.com/v1/links',
      {
        data: {
          attributes: {
            amount: Math.round(amount * 100), // convert to cents
            description,
            remarks: `Order ID: ${order.id}`,
            reference_number: order.id,
          },
        },
      },
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
      },
    );

    return {
      externalId: response.data.data.id,
      checkoutUrl: response.data.data.attributes.checkout_url,
    };
  }

  verifyWebhook(payload: any, signatureHeader: string): boolean {
    if (!signatureHeader) return false;

    const parts = signatureHeader.split(',');
    const timestamp = parts.find((p) => p.startsWith('t='))?.split('=')[1];
    const testSignature = parts.find((p) => p.startsWith('te='))?.split('=')[1];
    const liveSignature = parts.find((p) => p.startsWith('li='))?.split('=')[1];

    if (!timestamp) return false;

    const signatureToMatch = this.secretKey.startsWith('sk_test_') ? testSignature : liveSignature;

    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(`${timestamp}.${JSON.stringify(payload)}`)
      .digest('hex');

    return expectedSignature === signatureToMatch;
  }

  async handleWebhookEvent(event: any): Promise<void> {
    // The webhook payload structure depends on the event.
    // E.g. event.type === 'link.payment.paid'
    // This will be invoked by the webhook controller route.
  }
}
