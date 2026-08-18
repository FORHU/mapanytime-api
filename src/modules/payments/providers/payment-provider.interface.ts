import { Orders, PAYMENTMETHOD } from '@prisma/client';

export interface PaymentProvider {
  createPaymentIntent(
    order: Orders,
    amount: number,
    paymentMethod: PAYMENTMETHOD,
    description: string,
  ): Promise<{ externalId: string; checkoutUrl: string }>;

  verifyWebhook(payload: any, signature: string): boolean;

  handleWebhookEvent(event: any): Promise<void>;
}
