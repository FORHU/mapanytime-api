import { PaymentReconciliationJob } from '../../src/modules/payments/jobs/payment-reconciliation.job';
import { prisma } from '../../src/utils/prisma';
import InventoryStockRepository from '../../src/modules/inventory/inventoryStock.repository';
import { PAYMENTSTATUS, RESERVATIONSTATUS } from '@prisma/client';

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    paymentProviders: { findUnique: jest.fn() },
    payments: { findMany: jest.fn(), updateMany: jest.fn() },
    orders: { updateMany: jest.fn() },
  },
}));

jest.mock('../../src/modules/inventory/inventoryStock.repository', () => ({
  releaseOrderReservations: jest.fn(),
}));

describe('PaymentReconciliationJob', () => {
  let mockStripe: any;
  let job: PaymentReconciliationJob;
  const mockTx = {
    payments: { updateMany: jest.fn() },
    orders: { updateMany: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockStripe = {
      paymentIntents: {
        retrieve: jest.fn(),
      },
    };

    (prisma.$transaction as unknown as jest.Mock).mockImplementation((cb: any) => cb(mockTx));

    job = new PaymentReconciliationJob(mockStripe);
  });

  it('returns zeroes when stripe provider is not in database', async () => {
    (prisma.paymentProviders.findUnique as jest.Mock).mockResolvedValue(null);

    const result = await job.runReconciliation();

    expect(result).toEqual({ inspected: 0, completed: 0, failed: 0, skipped: 0 });
    expect(prisma.payments.findMany).not.toHaveBeenCalled();
  });

  it('returns zeroes when there are no stale pending payments', async () => {
    (prisma.paymentProviders.findUnique as jest.Mock).mockResolvedValue({
      id: 'prov-stripe-id',
      code: 'STRIPE',
    });
    (prisma.payments.findMany as jest.Mock).mockResolvedValue([]);

    const result = await job.runReconciliation();

    expect(result).toEqual({ inspected: 0, completed: 0, failed: 0, skipped: 0 });
    expect(mockStripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it('reconciles succeeded intent to COMPLETED payment and PROCESSING order', async () => {
    (prisma.paymentProviders.findUnique as jest.Mock).mockResolvedValue({
      id: 'prov-stripe-id',
      code: 'STRIPE',
    });

    const pendingPayment = {
      id: 'pay-1',
      orderId: 'ord-1',
      paymentIntentId: 'pi_succ_1',
      status: PAYMENTSTATUS.PENDING,
      createdAt: new Date(Date.now() - 15 * 60 * 1000),
    };

    (prisma.payments.findMany as jest.Mock).mockResolvedValue([pendingPayment]);
    mockStripe.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_succ_1',
      status: 'succeeded',
    });

    mockTx.payments.updateMany.mockResolvedValue({ count: 1 });
    mockTx.orders.updateMany.mockResolvedValue({ count: 1 });

    const result = await job.runReconciliation();

    expect(result.completed).toBe(1);
    expect(mockTx.payments.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'pay-1',
        status: PAYMENTSTATUS.PENDING,
      },
      data: expect.objectContaining({
        status: PAYMENTSTATUS.COMPLETED,
        providerReference: 'pi_succ_1',
      }),
    });
    expect(mockTx.orders.updateMany).toHaveBeenCalledWith({
      where: { id: 'ord-1', status: 'PENDING' },
      data: { status: 'PROCESSING' },
    });
  });

  it('reconciles canceled intent to FAILED and releases inventory hold', async () => {
    (prisma.paymentProviders.findUnique as jest.Mock).mockResolvedValue({
      id: 'prov-stripe-id',
      code: 'STRIPE',
    });

    const pendingPayment = {
      id: 'pay-2',
      orderId: 'ord-2',
      paymentIntentId: 'pi_canc_2',
      status: PAYMENTSTATUS.PENDING,
      createdAt: new Date(Date.now() - 15 * 60 * 1000),
    };

    (prisma.payments.findMany as jest.Mock).mockResolvedValue([pendingPayment]);
    mockStripe.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_canc_2',
      status: 'canceled',
    });

    mockTx.payments.updateMany.mockResolvedValue({ count: 1 });
    mockTx.orders.updateMany.mockResolvedValue({ count: 1 });

    const result = await job.runReconciliation();

    expect(result.failed).toBe(1);
    expect(mockTx.payments.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'pay-2',
        status: PAYMENTSTATUS.PENDING,
      },
      data: expect.objectContaining({
        status: PAYMENTSTATUS.FAILED,
      }),
    });
    expect(InventoryStockRepository.releaseOrderReservations).toHaveBeenCalledWith(
      mockTx,
      'ord-2',
      RESERVATIONSTATUS.RELEASED,
    );
  });

  it('expires requires_payment_method intent older than 30 minutes', async () => {
    (prisma.paymentProviders.findUnique as jest.Mock).mockResolvedValue({
      id: 'prov-stripe-id',
      code: 'STRIPE',
    });

    const pendingPayment = {
      id: 'pay-3',
      orderId: 'ord-3',
      paymentIntentId: 'pi_exp_3',
      status: PAYMENTSTATUS.PENDING,
      createdAt: new Date(Date.now() - 35 * 60 * 1000),
    };

    (prisma.payments.findMany as jest.Mock).mockResolvedValue([pendingPayment]);
    mockStripe.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_exp_3',
      status: 'requires_payment_method',
    });

    mockTx.payments.updateMany.mockResolvedValue({ count: 1 });
    mockTx.orders.updateMany.mockResolvedValue({ count: 1 });

    const result = await job.runReconciliation();

    expect(result.failed).toBe(1);
    expect(InventoryStockRepository.releaseOrderReservations).toHaveBeenCalledWith(
      mockTx,
      'ord-3',
      RESERVATIONSTATUS.RELEASED,
    );
  });

  it('safely skips without double-effect if another process already completed the payment', async () => {
    (prisma.paymentProviders.findUnique as jest.Mock).mockResolvedValue({
      id: 'prov-stripe-id',
      code: 'STRIPE',
    });

    const pendingPayment = {
      id: 'pay-race',
      orderId: 'ord-race',
      paymentIntentId: 'pi_race',
      status: PAYMENTSTATUS.PENDING,
      createdAt: new Date(Date.now() - 15 * 60 * 1000),
    };

    (prisma.payments.findMany as jest.Mock).mockResolvedValue([pendingPayment]);
    mockStripe.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_race',
      status: 'succeeded',
    });

    // Count is 0 because webhook already transitioned payment
    mockTx.payments.updateMany.mockResolvedValue({ count: 0 });

    const result = await job.runReconciliation();

    expect(result.skipped).toBe(1);
    expect(result.completed).toBe(0);
    expect(mockTx.orders.updateMany).not.toHaveBeenCalled();
  });
});
