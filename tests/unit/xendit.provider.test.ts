import { XenditProvider } from '../../src/modules/payments/providers/xendit.provider';

describe('XenditProvider.verifyWebhook', () => {
  const previousToken = process.env.XENDIT_WEBHOOK_TOKEN;

  beforeEach(() => {
    process.env.XENDIT_WEBHOOK_TOKEN = 'correct-verification-token';
  });

  afterAll(() => {
    process.env.XENDIT_WEBHOOK_TOKEN = previousToken;
  });

  it('accepts the correct token', () => {
    const provider = new XenditProvider();
    expect(provider.verifyWebhook('{}', 'correct-verification-token')).toBe(true);
  });

  it('rejects a wrong token of the same length', () => {
    const provider = new XenditProvider();
    expect(provider.verifyWebhook('{}', 'wrong-verification-token')).toBe(false);
  });

  it('rejects a wrong-length token without throwing', () => {
    const provider = new XenditProvider();
    expect(provider.verifyWebhook('{}', 'short')).toBe(false);
  });

  it('rejects an empty signature', () => {
    const provider = new XenditProvider();
    expect(provider.verifyWebhook('{}', '')).toBe(false);
  });

  it('rejects any signature when no token is configured', () => {
    delete process.env.XENDIT_WEBHOOK_TOKEN;
    const provider = new XenditProvider();
    expect(provider.verifyWebhook('{}', 'anything')).toBe(false);
  });
});

describe('XenditProvider.parseWebhookEvent', () => {
  const provider = new XenditProvider();

  it('parses a completed payment session as a success', () => {
    const payload = {
      event: 'payment_session.completed',
      business_id: '661f87c614802d6c402cd82d',
      created: '2026-12-31T23:59:59Z',
      data: {
        payment_session_id: 'ps-661f87c614802d6c402cd82d',
        reference_id: 'order_12345_PAY',
        status: 'COMPLETED',
        amount: '10000',
        currency: 'PHP',
      },
    };

    const result = provider.parseWebhookEvent(payload);

    expect(result.isSuccess).toBe(true);
    expect(result.isFailure).toBe(false);
    expect(result.orderId).toBe('order_12345_PAY');
    expect(result.providerReference).toBe('ps-661f87c614802d6c402cd82d');
    expect(result.failureReason).toBeNull();
  });

  // #139: the payment request is what Xendit's Refunds API takes.
  it('stores the payment request id as the reference when the webhook carries one', () => {
    const result = provider.parseWebhookEvent({
      event: 'payment_session.completed',
      data: {
        payment_session_id: 'ps-abc',
        payment_request_id: 'pr-abc',
        reference_id: 'order_1',
        status: 'COMPLETED',
      },
    });

    expect(result.providerReference).toBe('pr-abc');
  });

  it('parses an expired payment session as a failure', () => {
    const payload = {
      event: 'payment_session.expired',
      data: {
        payment_session_id: 'ps-abc123',
        reference_id: 'order_67890_PAY',
        status: 'EXPIRED',
      },
    };

    const result = provider.parseWebhookEvent(payload);

    expect(result.isSuccess).toBe(false);
    expect(result.isFailure).toBe(true);
    expect(result.orderId).toBe('order_67890_PAY');
    expect(result.failureReason).toContain('EXPIRED');
  });

  it('treats an unrecognized shape as neither success nor failure, with no orderId', () => {
    const result = provider.parseWebhookEvent({ nonsense: true });

    expect(result.isSuccess).toBe(false);
    expect(result.isFailure).toBe(false);
    expect(result.orderId).toBeNull();
  });
});

describe('XenditProvider.refundPayment', () => {
  const provider = new XenditProvider();

  it('posts a refund to Xendit API and returns normalized RefundResult', async () => {
    const axios = require('axios');
    jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: {
        id: 'ref-12345',
        amount: 50.0,
        status: 'SUCCEEDED',
      },
    });

    const result = await provider.refundPayment('pr-session-999', 5000, 'requested_by_customer');

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/refunds'),
      expect.objectContaining({
        payment_request_id: 'pr-session-999',
        amount: 50,
        // Xendit's reasons are upper case (#139).
        reason: 'REQUESTED_BY_CUSTOMER',
        currency: 'PHP',
      }),
      expect.any(Object),
    );

    expect(result.refundId).toBe('ref-12345');
    expect(result.amount).toBe(5000);
    expect(result.status).toBe('SUCCEEDED');
  });

  it('uses payment_id for a Xendit payment id (py-)', async () => {
    const axios = require('axios');
    jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: { id: 'ref-67890', amount: 25.5, status: 'PENDING' },
    });

    const result = await provider.refundPayment('py-payment-123', 2550);

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/refunds'),
      expect.objectContaining({
        payment_id: 'py-payment-123',
        amount: 25.5,
        reason: 'REQUESTED_BY_CUSTOMER',
      }),
      expect.any(Object),
    );
    expect(result.refundId).toBe('ref-67890');
    expect(result.amount).toBe(2550);
  });

  /**
   * Payments stored before #139 hold the session id, which the Refunds API does
   * not accept. The adapter looks up the payment request the session produced.
   */
  it('refunds the payment request behind a session id stored before #139', async () => {
    const axios = require('axios');
    const get = jest
      .spyOn(axios, 'get')
      .mockResolvedValueOnce({ data: { payment_request_id: 'pr-from-session' } });
    const post = jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: { id: 'ref-legacy', amount: 25.5, status: 'SUCCEEDED' },
    });

    await provider.refundPayment('ps-session-123', 2550);

    expect(get).toHaveBeenCalledWith(
      expect.stringContaining('/sessions/ps-session-123'),
      expect.any(Object),
    );
    const body = post.mock.lastCall?.[1] as Record<string, unknown>;
    expect(body.payment_request_id).toBe('pr-from-session');
    expect(body.payment_id).toBeUndefined();
  });

  it('refuses to refund a session that produced no payment request', async () => {
    const axios = require('axios');
    jest.spyOn(axios, 'get').mockResolvedValueOnce({ data: { payment_request_id: null } });
    const post = jest.spyOn(axios, 'post');
    post.mockClear();

    await expect(provider.refundPayment('ps-never-paid', 2550)).rejects.toThrow(
      'no payment request',
    );
    expect(post).not.toHaveBeenCalled();
  });
});

describe('XenditProvider.createCheckoutSession', () => {
  const previousBase = process.env.MAPANYTIME_API_PUBLIC_URL;
  beforeAll(() => {
    process.env.MAPANYTIME_API_PUBLIC_URL = 'https://api.example.com';
  });
  afterAll(() => {
    process.env.MAPANYTIME_API_PUBLIC_URL = previousBase;
  });

  /**
   * F109: the sweeper cancels an unpaid order after 15 minutes, and Xendit's
   * default session lasts 30, so a buyer could pay for an order that was gone.
   * The session now closes first. Xendit refuses less than 10 minutes.
   */
  it('closes the session before the stale-order sweeper cancels the order', async () => {
    const axios = require('axios');
    const post = jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: { payment_session_id: 'ps-new', payment_link_url: 'https://pay.example/ps-new' },
    });
    const before = Date.now();

    await new XenditProvider().createCheckoutSession({
      orderId: 'order-1',
      amountInCentavos: 102230,
    } as never);

    const body = post.mock.lastCall?.[1] as { expires_at?: string };
    const minutes = (Date.parse(body.expires_at ?? '') - before) / 60_000;
    expect(minutes).toBeGreaterThanOrEqual(10);
    expect(minutes).toBeLessThan(15);
  });
});
