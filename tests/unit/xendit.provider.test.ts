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
        reason: 'requested_by_customer',
        currency: 'PHP',
      }),
      expect.any(Object),
    );

    expect(result.refundId).toBe('ref-12345');
    expect(result.amount).toBe(5000);
    expect(result.status).toBe('SUCCEEDED');
  });

  it('uses payment_id when reference is not a payment_request_id (no pr- prefix)', async () => {
    const axios = require('axios');
    jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: {
        id: 'ref-67890',
        amount: 25.5,
        status: 'PENDING',
      },
    });

    const result = await provider.refundPayment('ps-session-123', 2550);

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/refunds'),
      expect.objectContaining({
        payment_id: 'ps-session-123',
        amount: 25.5,
        reason: 'REQUESTED_BY_CUSTOMER',
      }),
      expect.any(Object),
    );

    expect(result.refundId).toBe('ref-67890');
    expect(result.amount).toBe(2550);
  });
});
