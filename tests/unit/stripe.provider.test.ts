import { StripeProvider } from '../../src/modules/payments/providers/stripe.provider';
import Stripe from 'stripe';

jest.mock('stripe');

describe('StripeProvider', () => {
  let provider: StripeProvider;
  let mockStripeInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockStripeInstance = {
      checkout: {
        sessions: {
          create: jest.fn(),
        },
      },
      refunds: {
        create: jest.fn(),
      },
      webhooks: {
        constructEvent: jest.fn(),
      },
    };

    (Stripe as unknown as jest.Mock).mockImplementation(() => mockStripeInstance);
    provider = new StripeProvider('sk_test_mock_key', 'whsec_mock_secret');
  });

  describe('createCheckoutSession', () => {
    const input = {
      orderId: 'ord-123',
      amountInCentavos: 150000,
      currency: 'PHP',
      description: 'Order #ord-123',
      lineItems: [
        {
          name: 'Item 1',
          quantity: 2,
          amount: 50000,
          currency: 'PHP',
        },
      ],
      customer: {
        email: 'buyer@example.com',
      },
      metadata: {
        storeId: 'store-1',
      },
    };

    it('creates checkout session with idempotency key and returns CheckoutResult', async () => {
      mockStripeInstance.checkout.sessions.create.mockResolvedValue({
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/c/pay/cs_test_123',
        payment_intent: 'pi_test_456',
      });

      const result = await provider.createCheckoutSession(input);

      expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'payment',
          client_reference_id: 'ord-123',
          customer_email: 'buyer@example.com',
          metadata: {
            orderId: 'ord-123',
            storeId: 'store-1',
          },
        }),
        {
          idempotencyKey: 'payment:order:ord-123',
        },
      );

      expect(result).toEqual({
        checkoutSessionId: 'cs_test_123',
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_123',
        paymentIntentId: 'pi_test_456',
        rawResponse: expect.any(Object),
      });
    });

    it('falls back to single description line item when lineItems is empty', async () => {
      mockStripeInstance.checkout.sessions.create.mockResolvedValue({
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/pay',
        payment_intent: { id: 'pi_test_456' },
      });

      const singleInput = {
        ...input,
        lineItems: [],
      };

      const result = await provider.createCheckoutSession(singleInput);

      expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: [
            {
              price_data: {
                currency: 'php',
                product_data: {
                  name: 'Order #ord-123',
                },
                unit_amount: 150000,
              },
              quantity: 1,
            },
          ],
        }),
        {
          idempotencyKey: 'payment:order:ord-123',
        },
      );
      expect(result.paymentIntentId).toBe('pi_test_456');
    });
  });

  describe('verifyWebhook', () => {
    it('returns true when signature is valid', () => {
      mockStripeInstance.webhooks.constructEvent.mockReturnValue({
        id: 'evt_1',
        type: 'payment_intent.succeeded',
      });

      const valid = provider.verifyWebhook('{"id":"evt_1"}', 'valid_sig');

      expect(valid).toBe(true);
      expect(mockStripeInstance.webhooks.constructEvent).toHaveBeenCalledWith(
        '{"id":"evt_1"}',
        'valid_sig',
        'whsec_mock_secret',
      );
    });

    it('returns false when signature check throws', () => {
      mockStripeInstance.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('Bad signature');
      });

      const valid = provider.verifyWebhook('{"id":"evt_1"}', 'bad_sig');

      expect(valid).toBe(false);
    });

    it('returns false when webhook secret is not configured', () => {
      const providerWithoutSecret = new StripeProvider('sk_test_key', '');
      const valid = providerWithoutSecret.verifyWebhook('body', 'sig');
      expect(valid).toBe(false);
    });
  });

  describe('parseWebhookEvent', () => {
    it('parses checkout.session.completed', () => {
      const payload = {
        id: 'evt_session',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_123',
            client_reference_id: 'ord-123',
            payment_intent: 'pi_123',
            payment_status: 'paid',
            metadata: { orderId: 'ord-123' },
          },
        },
      };

      const parsed = provider.parseWebhookEvent(payload);

      expect(parsed).toEqual({
        eventId: 'evt_session',
        eventType: 'checkout.session.completed',
        orderId: 'ord-123',
        isSuccess: true,
        isFailure: false,
        providerReference: 'pi_123',
        failureReason: null,
      });
    });

    it('parses payment_intent.succeeded', () => {
      const payload = {
        id: 'evt_pi_succ',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_succ',
            metadata: { orderId: 'ord-456' },
          },
        },
      };

      const parsed = provider.parseWebhookEvent(payload);

      expect(parsed.isSuccess).toBe(true);
      expect(parsed.orderId).toBe('ord-456');
      expect(parsed.providerReference).toBe('pi_succ');
    });

    it('parses payment_intent.payment_failed', () => {
      const payload = {
        id: 'evt_pi_fail',
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_fail',
            metadata: { orderId: 'ord-789' },
            last_payment_error: { message: 'Card declined' },
          },
        },
      };

      const parsed = provider.parseWebhookEvent(payload);

      expect(parsed.isFailure).toBe(true);
      expect(parsed.isSuccess).toBe(false);
      expect(parsed.orderId).toBe('ord-789');
      expect(parsed.failureReason).toBe('Card declined');
    });

    it('parses charge.refunded', () => {
      const payload = {
        id: 'evt_refund',
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_123',
            payment_intent: 'pi_123',
            metadata: { orderId: 'ord-100' },
          },
        },
      };

      const parsed = provider.parseWebhookEvent(payload);

      expect(parsed.orderId).toBe('ord-100');
      expect(parsed.providerReference).toBe('pi_123');
      expect(parsed.isSuccess).toBe(false);
    });
  });

  describe('refundPayment', () => {
    it('creates refund with idempotency key and returns RefundResult', async () => {
      mockStripeInstance.refunds.create.mockResolvedValue({
        id: 're_123',
        amount: 50000,
        status: 'succeeded',
      });

      const result = await provider.refundPayment('pi_123', 50000, 'requested_by_customer');

      expect(mockStripeInstance.refunds.create).toHaveBeenCalledWith(
        {
          payment_intent: 'pi_123',
          amount: 50000,
          reason: 'requested_by_customer',
        },
        {
          idempotencyKey: 'refund:order:pi_123:50000',
        },
      );

      expect(result).toEqual({
        refundId: 're_123',
        amount: 50000,
        status: 'succeeded',
        rawResponse: expect.any(Object),
      });
    });
  });
});
