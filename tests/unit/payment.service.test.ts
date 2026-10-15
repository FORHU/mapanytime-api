import PaymentService from '../../src/modules/payments/payment.service';
import { prisma } from '../../src/utils/prisma';
import { emitNotificationToUser } from '../../src/infrastructure/socket';
import logger from '../../src/utils/logger';
import { MockProvider } from '../../src/modules/payments/providers/mock.provider';

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    orders: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    payments: {
      findFirst: jest.fn(),
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

const mockTransaction = prisma.$transaction as unknown as jest.Mock;
const mockOrdersFindUnique = prisma.orders.findUnique as unknown as jest.Mock;
const mockPaymentProvidersFindUnique = prisma.paymentProviders.findUnique as unknown as jest.Mock;
const mockPaymentWebhookEventsFindUnique = prisma.paymentWebhookEvents
  .findUnique as unknown as jest.Mock;
const mockEmit = emitNotificationToUser as jest.Mock;

const ORDER_ID = 'order-1';

const makeTx = () => ({
  payments: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
  orders: {
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  inventory: { updateMany: jest.fn(), update: jest.fn() },
  inventoryReservations: { updateMany: jest.fn() },
  paymentWebhookEvents: { upsert: jest.fn() },
  // No gateway fee recorded, so a refund writes no fee row unless a test sets one.
  orderCharges: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
  // Ending a hold is an UPDATE ... RETURNING of the rows still RESERVED.
  // Default: nothing left to claim.
  $queryRaw: jest.fn().mockResolvedValue([]),
  $executeRaw: jest.fn().mockResolvedValue(1),
});

let tx: ReturnType<typeof makeTx>;

beforeEach(() => {
  jest.clearAllMocks();
  tx = makeTx();
  mockTransaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));
  mockOrdersFindUnique.mockResolvedValue(null);
});

describe('PaymentService — Dynamic Payment Architecture', () => {
  describe('getActivePaymentMethods', () => {
    const paymongoRow = {
      id: 'prov-1',
      code: 'PAYMONGO',
      name: 'PayMongo',
      description: 'Gateway',
      methods: [
        { id: 'meth-1', code: 'GCASH', name: 'GCash', type: 'E_WALLET', description: null },
      ],
    };

    const cashRow = {
      id: 'prov-cash',
      code: 'CASH',
      name: 'Cash',
      description: 'Physical cash paid on pickup',
      methods: [
        { id: 'meth-cod', code: 'COD', name: 'Pay on Pickup', type: 'CASH', description: null },
      ],
    };

    const previousKey = process.env.PAYMONGO_SECRET_KEY;
    afterEach(() => {
      if (previousKey === undefined) delete process.env.PAYMONGO_SECRET_KEY;
      else process.env.PAYMONGO_SECRET_KEY = previousKey;
    });

    it('returns active providers and their active methods', async () => {
      process.env.PAYMONGO_SECRET_KEY = 'sk_test_configured';
      (prisma.paymentProviders.findMany as jest.Mock).mockResolvedValue([paymongoRow]);

      const result = await PaymentService.getActivePaymentMethods();
      expect(result).toHaveLength(1);
      expect(result[0].code).toBe('PAYMONGO');
      expect(result[0].methods).toHaveLength(1);
      expect(result[0].methods[0].code).toBe('GCASH');
    });

    /**
     * Without a secret key `getProviderAdapter` hands back MockProvider, whose
     * checkoutUrl is null. Offering the method anyway let a buyer pick GCash,
     * create an order and a PENDING payment, and then have no way to pay it —
     * worse than offering nothing, because they have already committed.
     * See FLAGS.md F83.
     */
    it('hides a gateway whose secret key is not configured', async () => {
      delete process.env.PAYMONGO_SECRET_KEY;
      (prisma.paymentProviders.findMany as jest.Mock).mockResolvedValue([paymongoRow]);

      await expect(PaymentService.getActivePaymentMethods()).resolves.toEqual([]);
    });

    /**
     * Cash reaches no gateway, so it has no adapter to judge. `getProviderAdapter`
     * has no CASH case and falls through to MockProvider — testing it the same
     * way as a gateway would delete Pay on Pickup from the picker.
     */
    it('still offers cash on pickup, which needs no gateway at all', async () => {
      delete process.env.PAYMONGO_SECRET_KEY;
      (prisma.paymentProviders.findMany as jest.Mock).mockResolvedValue([paymongoRow, cashRow]);

      const result = await PaymentService.getActivePaymentMethods();
      expect(result.map((p) => p.code)).toEqual(['CASH']);
      expect(result[0].methods[0].code).toBe('COD');
    });
  });

  describe('processProviderWebhook', () => {
    const provider = { id: 'prov-1', code: 'MOCK', name: 'Mock Gateway', isActive: true };

    beforeEach(() => {
      mockPaymentProvidersFindUnique.mockResolvedValue(provider);
      mockPaymentWebhookEventsFindUnique.mockResolvedValue(null);
    });

    it('refuses the MOCK provider in production, whatever route reached it', async () => {
      // MockProvider.verifyWebhook accepts any signature, so /webhook/mock was
      // still an unauthenticated "mark any order paid" endpoint even after the
      // /mock-webhook route was gated. See docs/payments-rework-review.md §2.
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        await expect(
          PaymentService.processProviderWebhook('MOCK', '{}', 'sig', {
            data: { id: 'evt-prod', type: 'payment.paid' },
          }),
        ).rejects.toMatchObject({ status: 403 });
        expect(mockTransaction).not.toHaveBeenCalled();
      } finally {
        process.env.NODE_ENV = previous;
      }
    });

    it('rejects an unknown provider', async () => {
      mockPaymentProvidersFindUnique.mockResolvedValue(null);

      await expect(
        PaymentService.processProviderWebhook('UNKNOWN', '{}', 'sig', {}),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('idempotently skips already processed webhook events', async () => {
      mockPaymentWebhookEventsFindUnique.mockResolvedValue({
        id: 'evt-rec-1',
        processed: true,
      });

      const result = await PaymentService.processProviderWebhook('MOCK', '{}', 'sig', {
        data: { id: 'evt-dup-1', type: 'payment.paid' },
      });

      expect(result.status).toBe('already_processed');
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('successfully processes payment confirmation and consumes inventory reservations', async () => {
      const pendingPayment = { id: 'pay-1', orderId: ORDER_ID, status: 'PENDING', amount: 500 };
      tx.payments.findFirst.mockResolvedValue(pendingPayment);
      tx.payments.update.mockResolvedValue({ ...pendingPayment, status: 'COMPLETED' });

      mockOrdersFindUnique.mockResolvedValue({
        id: ORDER_ID,
        buyer: { userId: 'buyer-user' },
        store: { storeName: 'Flagship Store', seller: { userId: 'seller-user' } },
      });

      const payload = {
        data: {
          id: 'evt-123',
          type: 'payment.paid',
          attributes: {
            data: {
              id: 'pay_ref_123',
              attributes: {
                reference_number: ORDER_ID,
              },
            },
          },
        },
      };

      const result = await PaymentService.processProviderWebhook(
        'MOCK',
        JSON.stringify(payload),
        'sig',
        payload,
      );

      expect(result.status).toBe('processed');
      expect(tx.paymentWebhookEvents.upsert).toHaveBeenCalled();
      expect(tx.payments.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
      expect(tx.orders.updateMany).toHaveBeenCalledWith({
        where: { id: ORDER_ID, status: 'PENDING' },
        data: { status: 'PROCESSING' },
      });
      // Payment succeeding moves no goods — they stay on the shelf, held for
      // this buyer, until pickup. completeOrder is what consumes the hold, in
      // the same claim that takes the stock down (F43).
      expect(tx.inventoryReservations.updateMany).not.toHaveBeenCalled();
      expect(mockEmit).toHaveBeenCalledTimes(2);
    });

    /**
     * F109 (#117). The stale-order sweeper cancels an unpaid order after 15 minutes. A
     * payment that still lands afterwards is recorded (the money did move), refunded
     * automatically through the provider, and must not tell the seller to prepare a
     * cancelled order.
     */
    describe('a payment that lands on an already-cancelled order', () => {
      const latePayment = {
        id: 'pay-late',
        orderId: ORDER_ID,
        status: 'FAILED',
        amount: 500,
        providerReference: 'pay_ref_late',
      };
      const payload = {
        data: {
          id: 'evt-late',
          type: 'payment.paid',
          attributes: {
            data: { id: 'pay_ref_late', attributes: { reference_number: ORDER_ID } },
          },
        },
      };
      let refundPayment: jest.SpyInstance;

      beforeEach(() => {
        tx.payments.findFirst.mockResolvedValue(latePayment);
        tx.payments.update.mockResolvedValue({ ...latePayment, status: 'COMPLETED' });
        tx.orders.updateMany.mockResolvedValue({ count: 0 });
        tx.orders.findUnique.mockResolvedValue({ status: 'CANCELLED' });
        mockOrdersFindUnique.mockResolvedValue({
          id: ORDER_ID,
          status: 'CANCELLED',
          buyer: { userId: 'buyer-user' },
          store: { storeName: 'Flagship Store', seller: { userId: 'seller-user' } },
        });
        (prisma.payments.findUnique as jest.Mock).mockResolvedValue({
          ...latePayment,
          status: 'COMPLETED',
        });
        (prisma.payments.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
        refundPayment = jest
          .spyOn(MockProvider.prototype, 'refundPayment')
          .mockResolvedValue({ refundId: 'ref_late', amount: 50000, status: 'succeeded' } as never);
      });

      afterEach(() => refundPayment.mockRestore());

      const deliver = () =>
        PaymentService.processProviderWebhook('MOCK', JSON.stringify(payload), 'sig', payload);

      it('records the payment, refunds it, and tells only the buyer', async () => {
        const result = await deliver();

        expect(result.status).toBe('processed');
        expect(tx.payments.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
        );
        expect(prisma.payments.updateMany).toHaveBeenCalledWith({
          where: { id: 'pay-late', status: 'COMPLETED' },
          data: { status: 'REFUND_PENDING' },
        });
        expect(refundPayment).toHaveBeenCalledWith('pay_ref_late', 50000, 'requested_by_customer');
        expect(tx.payments.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: 'REFUNDED', refundReference: 'ref_late' }),
          }),
        );
        // No "Payment Confirmed" or "New Paid Order"; one refund notice to the buyer.
        expect(mockEmit).toHaveBeenCalledTimes(1);
        expect(mockEmit).toHaveBeenCalledWith(
          'buyer-user',
          expect.objectContaining({ title: 'Payment refunded' }),
        );
      });

      it('records the gateway fee the platform absorbs on the refund', async () => {
        tx.orderCharges.findMany.mockImplementation(({ where }: { where: { type: string } }) =>
          Promise.resolve(where.type === 'PAYMENT_PROCESSING_FEE' ? [{ amount: 11.15 }] : []),
        );

        await deliver();

        expect(tx.orderCharges.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ type: 'REFUND', payer: 'PLATFORM' }),
          }),
        );
      });

      it('falls back to REFUND OWED, without failing the webhook, when the refund fails', async () => {
        refundPayment.mockRejectedValue(new Error('gateway down'));
        const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);

        try {
          await expect(deliver()).resolves.toMatchObject({ status: 'processed' });
          expect(prisma.payments.update).toHaveBeenCalledWith({
            where: { id: 'pay-late' },
            data: { status: 'COMPLETED' },
          });
          expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('REFUND OWED'),
            expect.objectContaining({ orderId: ORDER_ID, paymentId: 'pay-late' }),
          );
          expect(mockEmit).not.toHaveBeenCalled();
        } finally {
          errorSpy.mockRestore();
        }
      });

      it('does not refund twice when another caller already claimed the payment', async () => {
        (prisma.payments.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

        await deliver();

        expect(refundPayment).not.toHaveBeenCalled();
      });
    });

    it('handles payment failure by releasing inventory reservations', async () => {
      const pendingPayment = { id: 'pay-1', orderId: ORDER_ID, status: 'PENDING', amount: 500 };
      tx.payments.findFirst.mockResolvedValue(pendingPayment);
      tx.payments.update.mockResolvedValue({ ...pendingPayment, status: 'FAILED' });
      tx.orders.findUnique.mockResolvedValue({ id: ORDER_ID, status: 'PENDING' });
      tx.$queryRaw.mockResolvedValue([{ inventoryId: 'inv-1', quantity: 2 }]);

      const payload = {
        data: {
          id: 'evt-fail-1',
          type: 'payment.failed',
          attributes: {
            data: {
              attributes: {
                reference_number: ORDER_ID,
                failure_reason: 'Insufficient funds',
              },
            },
          },
        },
      };

      const result = await PaymentService.processProviderWebhook(
        'MOCK',
        JSON.stringify(payload),
        'sig',
        payload,
      );

      expect(result.status).toBe('processed');
      expect(tx.payments.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED' }),
        }),
      );
      // The hold is given back by claiming the rows still RESERVED and
      // decrementing what that claim returned — never by walking the order's
      // items, which handed the stock back a second time when the TTL sweeper
      // had already released it (F43).
      const claim = tx.$queryRaw.mock.calls[0];
      expect((claim[0] as string[]).join('?')).toContain(`"status" = 'RESERVED'`);
      expect(claim.slice(1)).toEqual(['RELEASED', ORDER_ID]);
      expect(tx.inventory.updateMany).not.toHaveBeenCalled();
    });
  });
  describe('COMPLETED is terminal', () => {
    // Regression for docs/payments-rework-review.md §5. The pre-rework code had
    // one guard covering every status; the rework moved it inside the success
    // branch, so a late payment.failed could walk a settled payment backwards.
    const completed = {
      id: 'pay-1',
      orderId: ORDER_ID,
      status: 'COMPLETED',
      amount: 500,
    };

    const failedPayload = {
      data: {
        id: 'evt-late-fail',
        type: 'payment.failed',
        attributes: { data: { attributes: { reference_number: ORDER_ID } } },
      },
    };

    beforeEach(() => {
      mockPaymentProvidersFindUnique.mockResolvedValue({
        id: 'prov-1',
        code: 'MOCK',
        name: 'Mock Gateway',
        isActive: true,
      });
      mockPaymentWebhookEventsFindUnique.mockResolvedValue(null);
      tx.payments.findFirst.mockResolvedValue(completed);
    });

    it('does not move a COMPLETED payment to FAILED', async () => {
      await PaymentService.processProviderWebhook(
        'MOCK',
        JSON.stringify(failedPayload),
        'sig',
        failedPayload,
      );

      expect(tx.payments.update).not.toHaveBeenCalled();
    });

    it('does not release inventory for a payment that already settled', async () => {
      await PaymentService.processProviderWebhook(
        'MOCK',
        JSON.stringify(failedPayload),
        'sig',
        failedPayload,
      );

      expect(tx.inventoryReservations.updateMany).not.toHaveBeenCalled();
      expect(tx.inventory.updateMany).not.toHaveBeenCalled();
    });

    it('does not re-notify on a repeat success', async () => {
      const paidPayload = {
        data: {
          id: 'evt-dup-paid',
          type: 'payment.paid',
          attributes: { data: { attributes: { reference_number: ORDER_ID } } },
        },
      };

      await PaymentService.processProviderWebhook(
        'MOCK',
        JSON.stringify(paidPayload),
        'sig',
        paidPayload,
      );

      expect(tx.payments.update).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe('resolvePaymentMethod', () => {
    // Regression for docs/payments-rework-review.md §1 — the arbitrary
    // "any active method" fallback resolved a buyer's cash choice to whichever
    // row Postgres returned first.
    const client = { paymentMethods: prisma.paymentMethods } as never;

    it('aliases the legacy CASH_ON_DELIVERY onto the seeded COD code', async () => {
      const cod = {
        id: 'meth-cod',
        code: 'COD',
        isActive: true,
        provider: { code: 'CASH', isActive: true },
      };
      (prisma.paymentMethods.findFirst as jest.Mock).mockResolvedValue(cod);

      const result = await PaymentService.resolvePaymentMethod(client, {
        paymentMethod: 'CASH_ON_DELIVERY',
      });

      expect(result).toBe(cod);
      expect(prisma.paymentMethods.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ code: 'COD' }) }),
      );
    });

    it('rejects an unknown method instead of substituting one', async () => {
      (prisma.paymentMethods.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        PaymentService.resolvePaymentMethod(client, { paymentMethod: 'DOGECOIN' }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('rejects an inactive method addressed by id', async () => {
      (prisma.paymentMethods.findUnique as jest.Mock).mockResolvedValue({
        id: 'meth-off',
        isActive: false,
        provider: { isActive: true },
      });

      await expect(
        PaymentService.resolvePaymentMethod(client, { paymentMethodId: 'meth-off' }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });
});
