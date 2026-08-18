import { Orders, PAYMENTMETHOD } from '@prisma/client';
import { PaymentProvider } from './payment-provider.interface';

export class MockProvider implements PaymentProvider {
  async createPaymentIntent(
    order: Orders,
    amount: number,
    paymentMethod: PAYMENTMETHOD,
    description: string,
  ) {
    return {
      externalId: `mock_intent_${order.id}`,
      checkoutUrl: `/mock-checkout?orderId=${order.id}&amount=${amount}`,
    };
  }

  verifyWebhook(payload: any, signature: string): boolean {
    return true;
  }

  async handleWebhookEvent(event: any): Promise<void> {
    // Handled by existing mock controller
  }
}
