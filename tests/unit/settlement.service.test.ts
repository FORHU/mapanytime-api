import SettlementService, {
  SETTLEMENT_HOLD_DAYS,
} from '../../src/modules/settlements/settlement.service';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    settlements: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as unknown as {
  settlements: {
    findMany: jest.Mock;
    updateMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
};

/**
 * Nothing wrote `Settlements` at all before this service did, so the payout
 * path filtered on RELEASED rows that could never exist and no seller was ever
 * paid. These pin the ledger arithmetic and the guards around it.
 * See FLAGS.md LED-3/LED-4/LED-5.
 */
describe('SettlementService.createForCompletedOrder', () => {
  const COMPLETED_AT = new Date('2026-08-20T10:00:00Z');

  function buildTx(orderOverrides: Record<string, unknown> = {}, existing: unknown = null) {
    const create = jest.fn().mockImplementation(({ data }) => Promise.resolve(data));
    return {
      create,
      client: {
        orders: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'order-1',
            subtotalAmount: 1000,
            discountAmount: 0,
            shippingAmount: 0,
            sellerMarketplaceFeeAmount: 20,
            sellerNetAmount: 980,
            completedAt: COMPLETED_AT,
            store: { sellerId: 'seller-1' },
            payment: [{ paymentMethod: { type: 'E_WALLET' } }],
            ...orderOverrides,
          }),
        },
        settlements: {
          findUnique: jest.fn().mockResolvedValue(existing),
          create,
        },
      },
    };
  }

  it('books what the platform owes the seller for a completed order', async () => {
    const { client, create } = buildTx();

    await SettlementService.createForCompletedOrder(client as never, 'order-1');

    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data.sellerId).toBe('seller-1');
    expect(data.subtotalAmount).toBe(1000);
    expect(data.commissionAmount).toBe(20);
    expect(data.sellerNetAmount).toBe(980);
    expect(data.status).toBe('PENDING');
  });

  it('holds the money for the configured window before it is payable', async () => {
    const { client, create } = buildTx();

    await SettlementService.createForCompletedOrder(client as never, 'order-1');

    const { releaseEligibleAt } = create.mock.calls[0][0].data;
    const heldDays = (releaseEligibleAt.getTime() - COMPLETED_AT.getTime()) / (24 * 60 * 60 * 1000);
    expect(heldDays).toBe(SETTLEMENT_HOLD_DAYS);
  });

  it('settles on the discounted subtotal, not the gross', async () => {
    const { client, create } = buildTx({
      discountAmount: 200,
      sellerMarketplaceFeeAmount: 16, // 2% of the discounted 800
      sellerNetAmount: 784,
    });

    await SettlementService.createForCompletedOrder(client as never, 'order-1');

    expect(create.mock.calls[0][0].data.subtotalAmount).toBe(800);
  });

  it('books the seller half of the gateway cost under a SHARED policy', async () => {
    // 1,000 goods, 20 commission, 11.15 seller half of a 22.30 gateway fee.
    const { client, create } = buildTx({ sellerNetAmount: 968.85 });

    await SettlementService.createForCompletedOrder(client as never, 'order-1');

    expect(create.mock.calls[0][0].data.paymentFeeAmount).toBe(11.15);
  });

  it('is zero-fee under the BUYER policy, where the seller carries no gateway cost', async () => {
    const { client, create } = buildTx();

    await SettlementService.createForCompletedOrder(client as never, 'order-1');

    expect(create.mock.calls[0][0].data.paymentFeeAmount).toBe(0);
  });

  // A retried completion must not hand the seller a second payment.
  it('does not write a second settlement for the same order', async () => {
    const { client, create } = buildTx({}, { id: 'settlement-1' });

    const result = await SettlementService.createForCompletedOrder(client as never, 'order-1');

    expect(create).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'settlement-1' });
  });

  // Cash runs the other way round: the seller took the money directly, so what
  // exists is the commission they owe us. Booked negative so it nets off their
  // next gateway-funded payout. Settled 2026-08-20; see FIX-PLAN.md item 3.
  it('books a negative commission debit for cash settled at the stall', async () => {
    const { client, create } = buildTx({ payment: [{ paymentMethod: { type: 'CASH' } }] });

    await SettlementService.createForCompletedOrder(client as never, 'order-1');

    const data = create.mock.calls[0][0].data;
    expect(data.sellerNetAmount).toBe(-20);
    expect(data.commissionAmount).toBe(20);
    // No gateway ran, so there is no processing cost to carry.
    expect(data.paymentFeeAmount).toBe(0);
  });

  // Paying a cash order out as though the platform owed it would hand the
  // seller a second payment for a sale they were already paid for in full.
  it('never books a positive net for a cash order', async () => {
    const { client, create } = buildTx({ payment: [{ paymentMethod: { type: 'CASH' } }] });

    await SettlementService.createForCompletedOrder(client as never, 'order-1');

    expect(create.mock.calls[0][0].data.sellerNetAmount).toBeLessThanOrEqual(0);
  });
});

describe('SettlementService.releaseMaturedSettlements', () => {
  beforeEach(() => jest.clearAllMocks());

  it('releases only settlements whose hold has elapsed on a completed order', async () => {
    mockPrisma.settlements.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
    mockPrisma.settlements.updateMany.mockResolvedValue({ count: 2 });

    const released = await SettlementService.releaseMaturedSettlements();

    expect(released).toBe(2);
    const where = mockPrisma.settlements.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['PENDING', 'HELD'] });
    expect(where.order.status).toBe('COMPLETED');
  });

  // Releasing one of these would let the money be swept into a payout while
  // the buyer is still owed a refund.
  it('skips orders with a live return request', async () => {
    mockPrisma.settlements.findMany.mockResolvedValue([]);

    await SettlementService.releaseMaturedSettlements();

    const where = mockPrisma.settlements.findMany.mock.calls[0][0].where;
    expect(where.order.returnRequests).toEqual({
      none: { status: { in: ['PENDING', 'APPROVED', 'ITEM_RECEIVED'] } },
    });
  });

  it('does no work when nothing is due', async () => {
    mockPrisma.settlements.findMany.mockResolvedValue([]);

    expect(await SettlementService.releaseMaturedSettlements()).toBe(0);
    expect(mockPrisma.settlements.updateMany).not.toHaveBeenCalled();
  });
});

describe('SettlementService.updateSettlementStatus', () => {
  beforeEach(() => jest.clearAllMocks());

  // The money is already gone; walking the row back would leave the ledger
  // claiming the platform still owes what it has already sent.
  it('refuses to change a settlement that has been paid out', async () => {
    mockPrisma.settlements.findUnique.mockResolvedValue({
      id: 's1',
      payoutItem: { id: 'item-1' },
    });

    await expect(SettlementService.updateSettlementStatus('s1', 'PENDING')).rejects.toMatchObject({
      status: 409,
    });
    expect(mockPrisma.settlements.update).not.toHaveBeenCalled();
  });

  it('stamps settledAt when a settlement is released', async () => {
    mockPrisma.settlements.findUnique.mockResolvedValue({ id: 's1', payoutItem: null });
    mockPrisma.settlements.update.mockResolvedValue({ id: 's1' });

    await SettlementService.updateSettlementStatus('s1', 'RELEASED');

    expect(mockPrisma.settlements.update.mock.calls[0][0].data.settledAt).toBeInstanceOf(Date);
  });
});
