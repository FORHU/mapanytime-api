import OrderService from '../../src/modules/orders/order.service';
import PaymentService from '../../src/modules/payments/payment.service';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    buyers: { findUnique: jest.fn() },
    orders: { findUnique: jest.fn() },
    payments: { findFirst: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('../../src/modules/inventory/inventoryStock.repository', () => ({
  releaseOrderReservations: jest.fn(),
}));
jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockPrisma = prisma as unknown as {
  buyers: { findUnique: jest.Mock };
  orders: { findUnique: jest.Mock };
  payments: { findFirst: jest.Mock; update: jest.Mock };
  $transaction: jest.Mock;
};

/**
 * Cancelling a paid order sends the money back through the gateway. The gateway
 * keeps its fee, and the platform absorbs it on the ledger (F86, #118), the same
 * as a refunded return.
 */
describe('OrderService.cancelOrder — refunding a paid order', () => {
  let refundPayment: jest.Mock;
  let tx: {
    orders: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
    payments: { update: jest.Mock };
    orderCharges: { findMany: jest.Mock; create: jest.Mock };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.buyers.findUnique.mockResolvedValue({ id: 'buyer-1' });
    mockPrisma.orders.findUnique.mockResolvedValue({
      id: 'order-1',
      buyerId: 'buyer-1',
      status: 'PROCESSING',
      orderitems: [],
    });

    refundPayment = jest.fn().mockResolvedValue({ refundId: 'ref_9', status: 'succeeded' });
    jest.spyOn(PaymentService, 'getProviderAdapter').mockReturnValue({ refundPayment } as never);

    tx = {
      orders: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'order-1', status: 'PROCESSING' }),
        update: jest.fn().mockResolvedValue({ id: 'order-1', status: 'CANCELLED' }),
      },
      payments: { update: jest.fn() },
      orderCharges: {
        findMany: jest.fn(({ where }: { where: { type: string } }) =>
          Promise.resolve(where.type === 'PAYMENT_PROCESSING_FEE' ? [{ amount: 22.3 }] : []),
        ),
        create: jest.fn(),
      },
    };
    mockPrisma.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
  });

  const givenPayment = (overrides: Record<string, unknown> = {}) =>
    mockPrisma.payments.findFirst.mockResolvedValue({
      id: 'pay-1',
      amount: 1022.3,
      status: 'COMPLETED',
      providerReference: 'pay_abc',
      provider: { code: 'XENDIT' },
      paymentMethod: { type: 'E_WALLET' },
      ...overrides,
    });

  it('refunds the whole payment and records the gateway fee the platform absorbs', async () => {
    givenPayment();

    await OrderService.cancelOrder('user-1', 'order-1');

    expect(refundPayment).toHaveBeenCalledWith('pay_abc', 102230, 'requested_by_customer');
    expect(tx.orderCharges.create).toHaveBeenCalledTimes(1);
    const { data } = tx.orderCharges.create.mock.calls[0][0];
    expect(data).toMatchObject({
      orderId: 'order-1',
      type: 'REFUND',
      payer: 'PLATFORM',
      beneficiary: 'PAYMENT_PROVIDER',
    });
    expect(String(data.amount)).toBe('22.3');
    expect(String(data.description)).toContain('ref_9');
  });

  it('records no fee when the provider rejects the refund', async () => {
    givenPayment();
    refundPayment.mockRejectedValue(new Error('gateway down'));

    await expect(OrderService.cancelOrder('user-1', 'order-1')).rejects.toMatchObject({
      status: 502,
    });
    expect(tx.orderCharges.create).not.toHaveBeenCalled();
  });

  it('records no fee for cash, which never went through a gateway', async () => {
    givenPayment({ paymentMethod: { type: 'CASH' }, providerReference: null });

    await expect(OrderService.cancelOrder('user-1', 'order-1')).resolves.toMatchObject({
      status: 'CANCELLED',
    });

    expect(refundPayment).not.toHaveBeenCalled();
    expect(tx.orderCharges.create).not.toHaveBeenCalled();
  });
});
