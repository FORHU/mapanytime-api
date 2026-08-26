import RewardService from '../../src/modules/rewards/reward.service';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

function buildMockClient() {
  return {
    orders: { findUnique: jest.fn() },
    rewardWallet: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    rewardTransactions: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    rewardConfigurations: { findFirst: jest.fn().mockResolvedValue(null) },
    rewardVouchers: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    userVouchers: { findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  };
}

jest.mock('../../src/utils/prisma', () => ({ prisma: {} }));

/**
 * Points are only ever awarded at ORDERSTATUS.COMPLETED, on the eligible net
 * goods subtotal (subtotalAmount - discountAmount) — same base the platform's
 * other ledgers use. Idempotent per orderId: a retried completion transaction
 * must not double-credit. See OPEN-FLAGS.md F47/F54.
 */
describe('RewardService.awardPointsForCompletedOrder', () => {
  it('credits points at the default rate (₱100 = 1 point) with no configured rate', async () => {
    const client = buildMockClient();
    client.orders.findUnique.mockResolvedValue({
      id: 'order-1',
      buyerId: 'buyer-1',
      subtotalAmount: 1000,
      discountAmount: 0,
    });
    client.rewardTransactions.findFirst.mockResolvedValue(null);
    client.rewardWallet.findUnique.mockResolvedValue(null);
    client.rewardWallet.create.mockResolvedValue({ id: 'wallet-1', balance: 0 });
    client.rewardWallet.update.mockResolvedValue({ id: 'wallet-1', balance: 10 });
    client.rewardTransactions.create.mockImplementation(({ data }) => Promise.resolve(data));

    const result = await RewardService.awardPointsForCompletedOrder(client as never, 'order-1');

    expect(client.rewardWallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet-1' },
      data: { balance: { increment: 10 }, lifetimeEarned: { increment: 10 } },
    });
    expect(result).toMatchObject({
      type: 'EARN',
      amount: 10,
      balanceAfter: 10,
      orderId: 'order-1',
      referenceKey: 'EARN:ORDER:order-1',
    });
  });

  it('earns on the discounted subtotal, not the gross', async () => {
    const client = buildMockClient();
    client.orders.findUnique.mockResolvedValue({
      id: 'order-1',
      buyerId: 'buyer-1',
      subtotalAmount: 1000,
      discountAmount: 200,
    });
    client.rewardTransactions.findFirst.mockResolvedValue(null);
    client.rewardWallet.findUnique.mockResolvedValue({ id: 'wallet-1', balance: 0 });
    client.rewardWallet.update.mockResolvedValue({ id: 'wallet-1', balance: 8 });
    client.rewardTransactions.create.mockImplementation(({ data }) => Promise.resolve(data));

    await RewardService.awardPointsForCompletedOrder(client as never, 'order-1');

    // (1000 - 200) / 100 = 8 points.
    expect(client.rewardWallet.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { balance: { increment: 8 }, lifetimeEarned: { increment: 8 } } }),
    );
  });

  it('does not double-credit a retried completion', async () => {
    const client = buildMockClient();
    client.rewardTransactions.findFirst.mockResolvedValue({ id: 'txn-1', type: 'EARN' });

    const result = await RewardService.awardPointsForCompletedOrder(client as never, 'order-1');

    expect(client.orders.findUnique).not.toHaveBeenCalled();
    expect(client.rewardWallet.update).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'txn-1', type: 'EARN' });
  });

  it('awards nothing for an order under the earn threshold', async () => {
    const client = buildMockClient();
    client.orders.findUnique.mockResolvedValue({
      id: 'order-1',
      buyerId: 'buyer-1',
      subtotalAmount: 50,
      discountAmount: 0,
    });
    client.rewardTransactions.findFirst.mockResolvedValue(null);

    const result = await RewardService.awardPointsForCompletedOrder(client as never, 'order-1');

    expect(client.rewardWallet.update).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});

describe('RewardService.claimVoucher', () => {
  it('decrements the wallet atomically and creates an ACTIVE claim', async () => {
    const client = buildMockClient();
    client.$transaction.mockImplementation((cb) => cb(client));
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = client.$transaction;
    client.rewardVouchers.findUnique.mockResolvedValue({
      id: 'voucher-1',
      isActive: true,
      totalStock: null,
      claimedCount: 0,
      pointCost: 300,
      title: '₱50 off',
      validityDays: 30,
    });
    client.rewardWallet.findUnique.mockResolvedValue({ id: 'wallet-1', balance: 500 });
    client.rewardWallet.updateMany.mockResolvedValue({ count: 1 });
    client.rewardWallet.findUniqueOrThrow.mockResolvedValue({ id: 'wallet-1', balance: 200 });
    client.userVouchers.create.mockResolvedValue({ id: 'claim-1', status: 'ACTIVE' });

    const result = await RewardService.claimVoucher('buyer-1', 'voucher-1');

    expect(client.rewardWallet.updateMany).toHaveBeenCalledWith({
      where: { id: 'wallet-1', balance: { gte: 300 } },
      data: { balance: { decrement: 300 }, lifetimeSpent: { increment: 300 } },
    });
    expect(result).toMatchObject({ id: 'claim-1', status: 'ACTIVE' });
  });

  // The WHERE balance >= cost predicate is what makes this safe: only one of
  // two concurrent claims against a wallet that can afford just one matches
  // the row. See OPEN-FLAGS.md F49.
  it('rejects the claim when the conditional decrement matches no row', async () => {
    const client = buildMockClient();
    client.$transaction.mockImplementation((cb) => cb(client));
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = client.$transaction;
    client.rewardVouchers.findUnique.mockResolvedValue({
      id: 'voucher-1',
      isActive: true,
      totalStock: null,
      claimedCount: 0,
      pointCost: 300,
    });
    client.rewardWallet.findUnique.mockResolvedValue({ id: 'wallet-1', balance: 100 });
    client.rewardWallet.updateMany.mockResolvedValue({ count: 0 });

    await expect(RewardService.claimVoucher('buyer-1', 'voucher-1')).rejects.toMatchObject({
      status: 400,
    });
    expect(client.userVouchers.create).not.toHaveBeenCalled();
  });

  it('refuses an out-of-stock voucher', async () => {
    const client = buildMockClient();
    client.$transaction.mockImplementation((cb) => cb(client));
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = client.$transaction;
    client.rewardVouchers.findUnique.mockResolvedValue({
      id: 'voucher-1',
      isActive: true,
      totalStock: 10,
      claimedCount: 10,
      pointCost: 300,
    });

    await expect(RewardService.claimVoucher('buyer-1', 'voucher-1')).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('RewardService.validateVoucherForOrder', () => {
  function buildClaim(overrides: Record<string, unknown> = {}) {
    return {
      id: 'claim-1',
      buyerId: 'buyer-1',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 86400000),
      voucher: {
        discountType: 'FIXED',
        discountValue: 50,
        minOrderAmount: null,
        maxDiscountAmount: null,
      },
      ...overrides,
    };
  }

  it('resolves a FIXED discount', async () => {
    const client = buildMockClient();
    client.userVouchers.findUnique.mockResolvedValue(buildClaim());

    const result = await RewardService.validateVoucherForOrder(client as never, 'buyer-1', 'claim-1', 1000);

    expect(result.discountAmount).toBe(50);
  });

  it('caps a PERCENTAGE discount by maxDiscountAmount', async () => {
    const client = buildMockClient();
    client.userVouchers.findUnique.mockResolvedValue(
      buildClaim({
        voucher: { discountType: 'PERCENTAGE', discountValue: 20, minOrderAmount: null, maxDiscountAmount: 30 },
      }),
    );

    // 20% of 1,000 = 200, capped at 30.
    const result = await RewardService.validateVoucherForOrder(client as never, 'buyer-1', 'claim-1', 1000);

    expect(result.discountAmount).toBe(30);
  });

  it('rejects a voucher belonging to another buyer', async () => {
    const client = buildMockClient();
    client.userVouchers.findUnique.mockResolvedValue(buildClaim({ buyerId: 'someone-else' }));

    await expect(
      RewardService.validateVoucherForOrder(client as never, 'buyer-1', 'claim-1', 1000),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects an already-used voucher', async () => {
    const client = buildMockClient();
    client.userVouchers.findUnique.mockResolvedValue(buildClaim({ status: 'USED' }));

    await expect(
      RewardService.validateVoucherForOrder(client as never, 'buyer-1', 'claim-1', 1000),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects an expired voucher', async () => {
    const client = buildMockClient();
    client.userVouchers.findUnique.mockResolvedValue(
      buildClaim({ expiresAt: new Date(Date.now() - 1000) }),
    );

    await expect(
      RewardService.validateVoucherForOrder(client as never, 'buyer-1', 'claim-1', 1000),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects an order below the minimum spend', async () => {
    const client = buildMockClient();
    client.userVouchers.findUnique.mockResolvedValue(
      buildClaim({
        voucher: { discountType: 'FIXED', discountValue: 50, minOrderAmount: 500, maxDiscountAmount: null },
      }),
    );

    await expect(
      RewardService.validateVoucherForOrder(client as never, 'buyer-1', 'claim-1', 100),
    ).rejects.toMatchObject({ status: 400 });
  });
});

// A buyer opening two checkout tabs and applying the same claimed voucher to
// two orders must not have both succeed.
describe('RewardService.markVoucherUsed', () => {
  it('flips ACTIVE to USED', async () => {
    const client = buildMockClient();
    client.userVouchers.updateMany.mockResolvedValue({ count: 1 });

    await RewardService.markVoucherUsed(client as never, 'claim-1', 'order-1');

    expect(client.userVouchers.updateMany).toHaveBeenCalledWith({
      where: { id: 'claim-1', status: 'ACTIVE' },
      data: expect.objectContaining({ status: 'USED', orderId: 'order-1' }),
    });
  });

  it('409s when the voucher is no longer ACTIVE (already applied elsewhere)', async () => {
    const client = buildMockClient();
    client.userVouchers.updateMany.mockResolvedValue({ count: 0 });

    await expect(RewardService.markVoucherUsed(client as never, 'claim-1', 'order-1')).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe('RewardService.expireOldPoints', () => {
  it('decrements the wallet by the lot amount, capped at the current balance, and writes an EXPIRED row', async () => {
    const rewardTransactions = {
      findMany: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'earn-1', walletId: 'wallet-1', amount: 10 }])
        .mockResolvedValueOnce([]),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
    };
    const rewardWallet = {
      findUnique: jest.fn().mockResolvedValue({ id: 'wallet-1', balance: 4 }),
      update: jest.fn().mockResolvedValue({ id: 'wallet-1', balance: 0 }),
    };
    const tx = { rewardTransactions, rewardWallet };
    Object.assign(prisma, { rewardTransactions, rewardWallet, $transaction: jest.fn((cb) => cb(tx)) });

    const count = await RewardService.expireOldPoints();

    expect(count).toBe(1);
    // Balance was only 4, so the lot of 10 expires capped at 4, never negative.
    expect(rewardWallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet-1' },
      data: { balance: { decrement: 4 } },
    });
    expect(rewardTransactions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'EXPIRED', amount: -4, referenceKey: 'EXPIRE:EARN:earn-1' }),
      }),
    );
  });

  it('skips a lot already offset by its own EXPIRED row', async () => {
    const rewardTransactions = {
      findMany: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'earn-1', walletId: 'wallet-1', amount: 10 }])
        .mockResolvedValueOnce([{ referenceKey: 'EXPIRE:EARN:earn-1' }]),
      create: jest.fn(),
    };
    const rewardWallet = { findUnique: jest.fn(), update: jest.fn() };
    const tx = { rewardTransactions, rewardWallet };
    Object.assign(prisma, { rewardTransactions, rewardWallet, $transaction: jest.fn((cb) => cb(tx)) });

    const count = await RewardService.expireOldPoints();

    expect(count).toBe(0);
    expect(rewardWallet.findUnique).not.toHaveBeenCalled();
  });
});

describe('RewardService.expireStaleVouchers', () => {
  it('flips overdue ACTIVE claims to EXPIRED', async () => {
    (prisma as unknown as { userVouchers: { updateMany: jest.Mock } }).userVouchers = {
      updateMany: jest.fn().mockResolvedValue({ count: 3 }),
    };

    const count = await RewardService.expireStaleVouchers();

    expect(count).toBe(3);
  });
});
