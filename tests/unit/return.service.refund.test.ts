import ReturnService, { RETURN_WINDOW_DAYS } from '../../src/modules/returns/return.service';
import ReturnRepository from '../../src/modules/returns/return.repository';
import PaymentService from '../../src/modules/payments/payment.service';
import SettlementService from '../../src/modules/settlements/settlement.service';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/modules/returns/return.repository');
jest.mock('../../src/infrastructure/socket', () => ({ emitNotificationToUser: jest.fn() }));
jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../src/modules/settlements/settlement.service', () => ({
  __esModule: true,
  default: {
    holdForOrder: jest.fn(),
    markRefundedForOrder: jest.fn(),
  },
}));
jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    users: { findUnique: jest.fn() },
    buyers: { findUnique: jest.fn() },
    sellers: { findUnique: jest.fn() },
    orders: { findUnique: jest.fn() },
    payments: { findFirst: jest.fn(), update: jest.fn() },
    settlements: { updateMany: jest.fn() },
    returnRequests: { update: jest.fn() },
    orderItems: { findMany: jest.fn() },
  },
}));

const mockRepo = ReturnRepository as jest.Mocked<typeof ReturnRepository>;
const mockPrisma = prisma as unknown as {
  $transaction: jest.Mock;
  users: { findUnique: jest.Mock };
  buyers: { findUnique: jest.Mock };
  orders: { findUnique: jest.Mock };
  payments: { findFirst: jest.Mock; update: jest.Mock };
  settlements: { updateMany: jest.Mock };
  returnRequests: { update: jest.Mock };
};

const SELLER_USER = 'user-seller';
const SELLER_ID = 'seller-1';

/**
 * `return.service.ts` computed a refundAmount and stopped — no provider was
 * ever called, so REFUNDED was a label on a row and the buyer's money never
 * moved. See FLAGS.md ORD-6 / PAY-7.
 */
describe('ReturnService — refund execution', () => {
  let refundPayment: jest.Mock;
  let tx: {
    payments: { update: jest.Mock };
    returnRequests: { update: jest.Mock };
    orderItems: { findMany: jest.Mock };
    inventory: { findFirst: jest.Mock; update: jest.Mock };
    products: { findUnique: jest.Mock; update: jest.Mock };
    inventoryMovements: { create: jest.Mock };
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // The seller the return is against, so authorization passes by default.
    mockPrisma.users.findUnique.mockResolvedValue({
      id: SELLER_USER,
      roles: [],
      seller: { id: SELLER_ID },
    });

    refundPayment = jest.fn().mockResolvedValue({
      refundId: 'ref_123',
      amount: 102230,
      status: 'succeeded',
    });
    jest.spyOn(PaymentService, 'getProviderAdapter').mockReturnValue({ refundPayment } as never);

    tx = {
      payments: { update: jest.fn() },
      returnRequests: { update: jest.fn().mockResolvedValue({ id: 'ret-1' }) },
      orderItems: { findMany: jest.fn().mockResolvedValue([]) },
      inventory: { findFirst: jest.fn(), update: jest.fn() },
      products: { findUnique: jest.fn(), update: jest.fn() },
      inventoryMovements: { create: jest.fn() },
    };
    mockPrisma.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
    mockPrisma.orders.findUnique.mockResolvedValue(null);
  });

  function givenReturn(overrides: Record<string, unknown> = {}) {
    mockRepo.findById.mockResolvedValue({
      id: 'ret-1',
      orderId: 'order-1',
      sellerId: SELLER_ID,
      status: 'ITEM_RECEIVED',
      refundAmount: 1022.3,
      ...overrides,
    } as never);
  }

  function givenPayment(overrides: Record<string, unknown> = {}) {
    mockPrisma.payments.findFirst.mockResolvedValue({
      id: 'pay-1',
      amount: 1022.3,
      refundedAmount: 0,
      status: 'COMPLETED',
      providerReference: 'pay_abc',
      provider: { code: 'PAYMONGO' },
      paymentMethod: { type: 'E_WALLET' },
      ...overrides,
    });
  }

  it('sends the money back through the provider that took it', async () => {
    givenReturn();
    givenPayment();

    await ReturnService.updateReturnStatus('ret-1', 'REFUNDED', SELLER_USER);

    expect(refundPayment).toHaveBeenCalledWith('pay_abc', 102230, 'requested_by_customer');
  });

  it('marks the settlement refunded so the seller is not paid for a returned sale', async () => {
    givenReturn();
    givenPayment();

    await ReturnService.updateReturnStatus('ret-1', 'REFUNDED', SELLER_USER);

    expect(SettlementService.markRefundedForOrder).toHaveBeenCalledWith(
      expect.anything(),
      'order-1',
    );
  });

  // A refund we recorded but never sent silently keeps the buyer's money.
  it('records nothing when the provider rejects the refund', async () => {
    givenReturn();
    givenPayment();
    refundPayment.mockRejectedValue(new Error('gateway down'));

    await expect(
      ReturnService.updateReturnStatus('ret-1', 'REFUNDED', SELLER_USER),
    ).rejects.toMatchObject({ status: 502 });

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(SettlementService.markRefundedForOrder).not.toHaveBeenCalled();
  });

  it('never refunds more than is left on the payment', async () => {
    givenReturn({ refundAmount: 1022.3 });
    givenPayment({ refundedAmount: 500, status: 'PARTIALLY_REFUNDED' });

    await expect(
      ReturnService.updateReturnStatus('ret-1', 'REFUNDED', SELLER_USER),
    ).rejects.toMatchObject({ status: 400 });

    expect(refundPayment).not.toHaveBeenCalled();
  });

  // Cash never passed through a gateway — there is nothing for us to send back.
  it('does not call a provider for cash settled at the stall', async () => {
    givenReturn();
    givenPayment({ paymentMethod: { type: 'CASH' }, providerReference: null });

    await ReturnService.updateReturnStatus('ret-1', 'REFUNDED', SELLER_USER);

    expect(refundPayment).not.toHaveBeenCalled();
    expect(SettlementService.markRefundedForOrder).toHaveBeenCalled();
  });

  it('refuses to refund a payment that was never completed', async () => {
    givenReturn();
    givenPayment({ status: 'PENDING' });

    await expect(
      ReturnService.updateReturnStatus('ret-1', 'REFUNDED', SELLER_USER),
    ).rejects.toMatchObject({ status: 400 });
  });

  /**
   * `completeOrder` decrements stock and increments `totalSold`; nothing reversed
   * either when the sale came back, so returned goods stayed unsellable. The
   * schema had carried `RETURN` in both inventory enums the whole time without a
   * single writer. See OPEN-FLAGS F87.
   */
  describe('ReturnService — restocking a refunded return', () => {
    function givenOrderItems(items: { productId: string; quantity: number }[]) {
      tx.orderItems.findMany.mockResolvedValue(items);
    }

    it('puts the returned units back on the shelf and logs the movement', async () => {
      givenReturn();
      givenPayment({ paymentMethod: { type: 'CASH' } });
      givenOrderItems([{ productId: 'prod-1', quantity: 3 }]);
      tx.inventory.findFirst.mockResolvedValue({
        id: 'inv-1',
        storeId: 'store-1',
        quantityOnHand: 10,
      });
      tx.products.findUnique.mockResolvedValue({ totalSold: 12 });

      await ReturnService.updateReturnStatus('ret-1', 'REFUNDED', SELLER_USER);

      expect(tx.inventory.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { quantityOnHand: { increment: 3 } },
      });
      expect(tx.inventoryMovements.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          movementType: 'RETURN',
          referenceType: 'RETURN',
          quantityDelta: 3,
          previousOnHand: 10,
          newOnHand: 13,
        }),
      });
    });

    it('winds back totalSold without letting it go negative', async () => {
      givenReturn();
      givenPayment({ paymentMethod: { type: 'CASH' } });
      givenOrderItems([{ productId: 'prod-1', quantity: 5 }]);
      tx.inventory.findFirst.mockResolvedValue({
        id: 'inv-1',
        storeId: 'store-1',
        quantityOnHand: 0,
      });
      tx.products.findUnique.mockResolvedValue({ totalSold: 2 });

      await ReturnService.updateReturnStatus('ret-1', 'REFUNDED', SELLER_USER);

      expect(tx.products.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { totalSold: 0 },
      });
    });

    // The money has already left the gateway by this point; a missing stock row
    // must not turn a completed refund into a failed request.
    it('still refunds when a product has no inventory row left', async () => {
      givenReturn();
      givenPayment({ paymentMethod: { type: 'CASH' } });
      givenOrderItems([{ productId: 'prod-gone', quantity: 1 }]);
      tx.inventory.findFirst.mockResolvedValue(null);

      await expect(
        ReturnService.updateReturnStatus('ret-1', 'REFUNDED', SELLER_USER),
      ).resolves.toBeDefined();

      expect(tx.inventory.update).not.toHaveBeenCalled();
      expect(tx.returnRequests.update).toHaveBeenCalled();
    });
  });
});

describe('ReturnService — status transitions and authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.users.findUnique.mockResolvedValue({
      id: SELLER_USER,
      roles: [],
      seller: { id: SELLER_ID },
    });
  });

  // The route was `authenticate` alone, so the buyer who filed the return could
  // approve it and drive it to REFUNDED themselves.
  it('refuses a decision from anyone but the seller or an admin', async () => {
    mockRepo.findById.mockResolvedValue({
      id: 'ret-1',
      orderId: 'order-1',
      sellerId: SELLER_ID,
      status: 'PENDING',
    } as never);
    mockPrisma.users.findUnique.mockResolvedValue({
      id: 'user-buyer',
      roles: [],
      seller: null,
    });

    await expect(
      ReturnService.updateReturnStatus('ret-1', 'APPROVED', 'user-buyer'),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses to jump straight from PENDING to REFUNDED', async () => {
    mockRepo.findById.mockResolvedValue({
      id: 'ret-1',
      orderId: 'order-1',
      sellerId: SELLER_ID,
      status: 'PENDING',
    } as never);

    await expect(
      ReturnService.updateReturnStatus('ret-1', 'REFUNDED', SELLER_USER),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses to reopen an already refunded return', async () => {
    mockRepo.findById.mockResolvedValue({
      id: 'ret-1',
      orderId: 'order-1',
      sellerId: SELLER_ID,
      status: 'REFUNDED',
    } as never);

    await expect(
      ReturnService.updateReturnStatus('ret-1', 'APPROVED', SELLER_USER),
    ).rejects.toMatchObject({ status: 400 });
  });

  // Otherwise the hold could elapse mid-return and the settlement be swept
  // into a payout, leaving the refund to come out of the platform's pocket.
  it('freezes the settlement when a return is approved', async () => {
    mockRepo.findById.mockResolvedValue({
      id: 'ret-1',
      orderId: 'order-1',
      sellerId: SELLER_ID,
      status: 'PENDING',
    } as never);
    mockRepo.updateStatus.mockResolvedValue({ id: 'ret-1' } as never);

    await ReturnService.updateReturnStatus('ret-1', 'APPROVED', SELLER_USER);

    expect(SettlementService.holdForOrder).toHaveBeenCalledWith(expect.anything(), 'order-1');
  });

  /**
   * The transition check used to sit inside `if (current !== requested)`, so a
   * second PATCH of REFUNDED skipped the terminal guard and re-entered
   * `executeRefund`. See OPEN-FLAGS F88.
   */
  it('treats a repeat of the current status as a retry, not a second refund', async () => {
    mockRepo.findById.mockResolvedValue({
      id: 'ret-1',
      orderId: 'order-1',
      sellerId: SELLER_ID,
      status: 'REFUNDED',
    } as never);

    await ReturnService.updateReturnStatus('ret-1', 'REFUNDED', SELLER_USER);

    expect(mockPrisma.payments.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(SettlementService.markRefundedForOrder).not.toHaveBeenCalled();
  });

  it('does not re-run a transition side effect when the status is unchanged', async () => {
    mockRepo.findById.mockResolvedValue({
      id: 'ret-1',
      orderId: 'order-1',
      sellerId: SELLER_ID,
      status: 'APPROVED',
    } as never);

    await ReturnService.updateReturnStatus('ret-1', 'APPROVED', SELLER_USER);

    expect(SettlementService.holdForOrder).not.toHaveBeenCalled();
    expect(mockRepo.updateStatus).not.toHaveBeenCalled();
  });

  it('lets a held settlement mature again when the return is rejected', async () => {
    mockRepo.findById.mockResolvedValue({
      id: 'ret-1',
      orderId: 'order-1',
      sellerId: SELLER_ID,
      status: 'PENDING',
    } as never);
    mockRepo.updateStatus.mockResolvedValue({ id: 'ret-1' } as never);

    await ReturnService.updateReturnStatus('ret-1', 'REJECTED', SELLER_USER);

    expect(mockPrisma.settlements.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'order-1', status: 'HELD' },
      data: { status: 'PENDING' },
    });
  });
});

/**
 * There was no window at all: any COMPLETED order was returnable forever, which
 * made a refund landing after the settlement hold had elapsed and the payout had
 * gone out the eventual default rather than an edge case (F84).
 * See OPEN-FLAGS F85.
 */
describe('ReturnService — the return window', () => {
  const BUYER_USER = 'user-buyer';
  const BUYER_ID = 'buyer-1';

  function givenCompletedOrder(completedAt: Date | null) {
    mockPrisma.buyers.findUnique.mockResolvedValue({ id: BUYER_ID });
    mockPrisma.orders.findUnique.mockResolvedValue({
      id: 'order-1',
      buyerId: BUYER_ID,
      status: 'COMPLETED',
      totalAmount: 1022.3,
      completedAt,
      store: { sellerId: SELLER_ID },
      returnRequests: [],
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockRepo.createReturnRequest.mockResolvedValue({ id: 'ret-1' } as never);
  });

  it('accepts a return opened inside the window', async () => {
    givenCompletedOrder(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));

    await expect(
      ReturnService.createReturnRequest({
        orderId: 'order-1',
        userId: BUYER_USER,
        reason: 'Damaged',
      }),
    ).resolves.toMatchObject({ id: 'ret-1' });
  });

  it('refuses a return opened after the window has closed', async () => {
    givenCompletedOrder(new Date(Date.now() - (RETURN_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000));

    await expect(
      ReturnService.createReturnRequest({
        orderId: 'order-1',
        userId: BUYER_USER,
        reason: 'Changed my mind',
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(mockRepo.createReturnRequest).not.toHaveBeenCalled();
  });

  // Open-ended is the one answer that cannot be right, so an order with no
  // completion date on record is refused rather than left returnable forever.
  it('refuses an order with no completion date rather than defaulting to open', async () => {
    givenCompletedOrder(null);

    await expect(
      ReturnService.createReturnRequest({
        orderId: 'order-1',
        userId: BUYER_USER,
        reason: 'Damaged',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
