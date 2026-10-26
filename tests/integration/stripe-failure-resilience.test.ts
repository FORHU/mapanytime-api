import Stripe from 'stripe';
import PaymentService from '../../src/modules/payments/payment.service';
import { PaymentReconciliationJob } from '../../src/modules/payments/jobs/payment-reconciliation.job';
import { StripeProvider } from '../../src/modules/payments/providers/stripe.provider';
import { prisma } from '../../src/utils/prisma';
import { emitNotificationToUser } from '../../src/infrastructure/socket';
import { PAYMENTSTATUS } from '@prisma/client';

jest.mock('stripe');

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    orders: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    payments: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    paymentProviders: { findMany: jest.fn(), findUnique: jest.fn() },
    paymentMethods: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
    paymentWebhookEvents: { findUnique: jest.fn(), upsert: jest.fn() },
    inventory: { updateMany: jest.fn() },
    inventoryReservations: { updateMany: jest.fn() },
  },
}));

jest.mock('../../src/infrastructure/socket', () => ({
  emitNotificationToUser: jest.fn(),
}));

jest.setTimeout(15000);

describe('Stripe Payment Failure & Resilience Integration Tests', () => {
  let mockStripeInstance: any;
  let reconciliationJob: PaymentReconciliationJob;
  const originalStripeKey = process.env.STRIPE_SECRET_KEY;
  const originalStripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  beforeAll(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_resilience_key';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
  });

  afterAll(() => {
    process.env.STRIPE_SECRET_KEY = originalStripeKey;
    process.env.STRIPE_WEBHOOK_SECRET = originalStripeWebhookSecret;
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockStripeInstance = {
      checkout: { sessions: { create: jest.fn() } },
      refunds: { create: jest.fn() },
      paymentIntents: { retrieve: jest.fn() },
      webhooks: { constructEvent: jest.fn() },
    };

    (Stripe as unknown as jest.Mock).mockImplementation(() => mockStripeInstance);
    reconciliationJob = new PaymentReconciliationJob(mockStripeInstance);
  });

  /**
   * Test 1: Duplicate Webhook Delivery
   * Scenario: Stripe delivers duplicate payment_intent.succeeded webhook events in parallel.
   * Invariant: Database transaction serializes execution; first call settles payment, second skips idempotently.
   */
  it('1. Duplicate Webhook: handles duplicate payment_intent.succeeded in parallel without double-processing', async () => {
    const orderId = 'order-dup-1';
    const eventId = 'evt_duplicate_test_1';
    const providerPaymentId = 'pi_duplicate_123';

    (prisma.paymentProviders.findUnique as jest.Mock).mockResolvedValue({
      id: 'prov-stripe-id',
      code: 'STRIPE',
      isActive: true,
    });

    const paymentRecord = {
      id: 'pay-dup-1',
      orderId,
      status: PAYMENTSTATUS.PENDING,
      amount: 1500,
      providerReference: providerPaymentId,
      buyer: { userId: 'buyer-user-1' },
      store: { storeName: 'Test Store', seller: { userId: 'seller-user-1' } },
    };

    let processedWebhookRecord: any = null;
    let paymentCompletedCount = 0;

    const mockTx = {
      paymentWebhookEvents: {
        upsert: jest.fn().mockImplementation(async () => {
          processedWebhookRecord = { eventId, processed: true };
          return processedWebhookRecord;
        }),
      },
      payments: {
        findFirst: jest.fn().mockImplementation(async () => {
          if (paymentCompletedCount > 0) {
            return { ...paymentRecord, status: PAYMENTSTATUS.COMPLETED };
          }
          return paymentRecord;
        }),
        update: jest.fn().mockImplementation(async () => {
          paymentCompletedCount++;
          return { ...paymentRecord, status: PAYMENTSTATUS.COMPLETED };
        }),
      },
      orders: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryReservations: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    // Serialize database transactions as Postgres does
    let txQueue = Promise.resolve();
    (prisma.$transaction as unknown as jest.Mock).mockImplementation((cb: any) => {
      const run = txQueue.then(() => cb(mockTx));
      txQueue = run.catch(() => {});
      return run;
    });

    (prisma.paymentWebhookEvents.findUnique as jest.Mock).mockImplementation(async () => {
      return processedWebhookRecord;
    });

    const stripeEvent = {
      id: eventId,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: providerPaymentId,
          metadata: { orderId },
        },
      },
    };

    mockStripeInstance.webhooks.constructEvent.mockReturnValue(stripeEvent);

    const rawPayload = JSON.stringify(stripeEvent);
    const signature = 't=123,v1=valid_sig';

    // Dispatch two identical webhooks in parallel
    const [res1, res2] = await Promise.all([
      PaymentService.processProviderWebhook('STRIPE', rawPayload, signature, stripeEvent),
      PaymentService.processProviderWebhook('STRIPE', rawPayload, signature, stripeEvent),
    ]);

    expect([res1.status, res2.status]).toContain('processed');
    expect(paymentCompletedCount).toBe(1);
    expect(mockTx.orders.updateMany).toHaveBeenCalledWith({
      where: { id: orderId, status: 'PENDING' },
      data: { status: 'PROCESSING' },
    });
  });

  /**
   * Test 2: Race Condition Between Webhook & Reconciliation Sweeper
   * Scenario: The webhook and reconciliation job attempt to settle the same order concurrently.
   * Invariant: Atomic preconditions (WHERE status = 'PENDING') prevent double-settlement.
   */
  it('2. Race Condition: resolves concurrent webhook and reconciliation without state collision', async () => {
    const orderId = 'order-race-1';
    const paymentId = 'pay-race-1';
    const providerIntentId = 'pi_race_123';

    (prisma.paymentProviders.findUnique as jest.Mock).mockResolvedValue({
      id: 'prov-stripe-id',
      code: 'STRIPE',
      isActive: true,
    });

    const pendingPayment = {
      id: paymentId,
      orderId,
      status: PAYMENTSTATUS.PENDING,
      amount: 2000,
      paymentIntentId: providerIntentId,
      providerReference: providerIntentId,
      createdAt: new Date(Date.now() - 15 * 60 * 1000),
      buyer: { userId: 'buyer-user-2' },
      store: { storeName: 'Test Store 2', seller: { userId: 'seller-user-2' } },
    };

    let paymentStatus: PAYMENTSTATUS = PAYMENTSTATUS.PENDING;
    let successfulTransitions = 0;

    const mockTx = {
      paymentWebhookEvents: {
        upsert: jest.fn().mockResolvedValue({ eventId: 'evt_race_1', processed: true }),
      },
      payments: {
        findFirst: jest.fn().mockImplementation(async () => {
          return { ...pendingPayment, status: paymentStatus };
        }),
        update: jest.fn().mockImplementation(async () => {
          if (paymentStatus === PAYMENTSTATUS.PENDING) {
            paymentStatus = PAYMENTSTATUS.COMPLETED;
            successfulTransitions++;
          }
          return { ...pendingPayment, status: paymentStatus };
        }),
        updateMany: jest.fn().mockImplementation(async (args: any) => {
          if (
            args.where?.status === PAYMENTSTATUS.PENDING &&
            paymentStatus === PAYMENTSTATUS.PENDING
          ) {
            paymentStatus = PAYMENTSTATUS.COMPLETED;
            successfulTransitions++;
            return { count: 1 };
          }
          return { count: 0 };
        }),
      },
      orders: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryReservations: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    // Serialize database transactions as Postgres does
    let txQueue = Promise.resolve();
    (prisma.$transaction as unknown as jest.Mock).mockImplementation((cb: any) => {
      const run = txQueue.then(() => cb(mockTx));
      txQueue = run.catch(() => {});
      return run;
    });

    (prisma.payments.findMany as jest.Mock).mockResolvedValue([pendingPayment]);

    mockStripeInstance.paymentIntents.retrieve.mockResolvedValue({
      id: providerIntentId,
      status: 'succeeded',
    });

    const stripeEvent = {
      id: 'evt_race_1',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: providerIntentId,
          metadata: { orderId },
        },
      },
    };
    mockStripeInstance.webhooks.constructEvent.mockReturnValue(stripeEvent);

    // Fire webhook and reconciliation concurrently
    await Promise.all([
      PaymentService.processProviderWebhook(
        'STRIPE',
        JSON.stringify(stripeEvent),
        'sig_race',
        stripeEvent,
      ),
      reconciliationJob.runReconciliation(),
    ]);

    expect(successfulTransitions).toBe(1);
    expect(paymentStatus).toBe(PAYMENTSTATUS.COMPLETED);
  });

  /**
   * Test 3: Lost Webhook Self-Healing Recovery
   * Scenario: Webhook was lost in transit; reconciliation sweeper identifies stale PENDING payment and recovers it.
   * Invariant: Payment transitions to COMPLETED, order transitions to PROCESSING.
   */
  it('3. Lost Webhook Recovery: sweeper reconciles stale pending payment whose webhook never arrived', async () => {
    const orderId = 'order-lost-hook-1';
    const paymentId = 'pay-lost-hook-1';
    const intentId = 'pi_lost_123';

    (prisma.paymentProviders.findUnique as jest.Mock).mockResolvedValue({
      id: 'prov-stripe-id',
      code: 'STRIPE',
    });

    const stalePayment = {
      id: paymentId,
      orderId,
      providerId: 'prov-stripe-id',
      status: PAYMENTSTATUS.PENDING,
      paymentIntentId: intentId,
      providerReference: intentId,
      createdAt: new Date(Date.now() - 20 * 60 * 1000), // 20 mins old
    };

    (prisma.payments.findMany as jest.Mock).mockResolvedValue([stalePayment]);

    mockStripeInstance.paymentIntents.retrieve.mockResolvedValue({
      id: intentId,
      status: 'succeeded',
    });

    const mockTx = {
      payments: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orders: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    (prisma.$transaction as unknown as jest.Mock).mockImplementation(async (cb: any) => cb(mockTx));

    const stats = await reconciliationJob.runReconciliation();

    expect(stats.inspected).toBe(1);
    expect(stats.completed).toBe(1);
    expect(mockStripeInstance.paymentIntents.retrieve).toHaveBeenCalledWith(intentId);
    expect(mockTx.payments.updateMany).toHaveBeenCalledWith({
      where: { id: paymentId, status: PAYMENTSTATUS.PENDING },
      data: {
        status: PAYMENTSTATUS.COMPLETED,
        providerReference: intentId,
        paidAt: expect.any(Date),
      },
    });
    expect(mockTx.orders.updateMany).toHaveBeenCalledWith({
      where: { id: orderId, status: 'PENDING' },
      data: { status: 'PROCESSING' },
    });
  });

  /**
   * Test 4: Duplicate Refund Idempotency
   * Scenario: Calling refund twice with same paymentReference uses deterministic idempotency key.
   * Invariant: Stripe SDK is called with deterministic idempotency key; duplicate call returns cached refund safely.
   */
  it('4. Duplicate Refund: idempotency key prevents duplicate refund charges for same return', async () => {
    const provider = new StripeProvider('sk_test_refund_key', 'whsec_refund');
    const paymentReference = 'pi_to_refund_123';
    const refundAmountInCentavos = 75000;

    const mockStripeRefund = {
      id: 're_123456789',
      amount: refundAmountInCentavos,
      status: 'succeeded',
    };

    mockStripeInstance.refunds.create.mockResolvedValue(mockStripeRefund);

    // Call refund twice
    const [result1, result2] = await Promise.all([
      provider.refundPayment(paymentReference, refundAmountInCentavos, 'requested_by_customer'),
      provider.refundPayment(paymentReference, refundAmountInCentavos, 'requested_by_customer'),
    ]);

    expect(mockStripeInstance.refunds.create).toHaveBeenCalledWith(
      {
        payment_intent: paymentReference,
        amount: refundAmountInCentavos,
        reason: 'requested_by_customer',
      },
      {
        idempotencyKey: `refund:order:${paymentReference}:${refundAmountInCentavos}`,
      },
    );

    expect(result1.refundId).toBe('re_123456789');
    expect(result2.refundId).toBe('re_123456789');
    expect(result1.status).toBe('succeeded');
    expect(result2.status).toBe('succeeded');
  });
});
