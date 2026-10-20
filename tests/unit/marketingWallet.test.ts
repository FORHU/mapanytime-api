import MarketingWalletRepository from '../../src/modules/marketingWallet/marketingWallet.repository';
import MarketingWalletService from '../../src/modules/marketingWallet/marketingWallet.service';
import { prisma } from '../../src/utils/prisma';
import type { AuthUser } from '../../src/modules/auth/auth.repository';

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    marketingWallet: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    marketingWalletTransactions: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    sellers: {
      findUnique: jest.fn(),
    },
  },
}));

const mockWallet = prisma.marketingWallet as unknown as {
  findUnique: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
};

const mockTransactions = prisma.marketingWalletTransactions as unknown as {
  create: jest.Mock;
  findMany: jest.Mock;
  count: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('MarketingWalletRepository', () => {
  const sellerId = 'seller-123';

  it('getOrCreateWallet returns existing wallet if found', async () => {
    const existing = {
      id: 'wallet-1',
      sellerId,
      balance: 1000,
      lifetimeDeposited: 1000,
      lifetimeSpent: 0,
      currency: 'PHP',
    };
    mockWallet.findUnique.mockResolvedValueOnce(existing);

    const result = await MarketingWalletRepository.getOrCreateWallet(prisma, sellerId);
    expect(result).toEqual(existing);
    expect(mockWallet.create).not.toHaveBeenCalled();
  });

  it('getOrCreateWallet creates a new wallet if not found', async () => {
    mockWallet.findUnique.mockResolvedValueOnce(null);
    const created = {
      id: 'wallet-2',
      sellerId,
      balance: 0,
      lifetimeDeposited: 0,
      lifetimeSpent: 0,
      currency: 'PHP',
    };
    mockWallet.create.mockResolvedValueOnce(created);

    const result = await MarketingWalletRepository.getOrCreateWallet(prisma, sellerId);
    expect(result).toEqual(created);
    expect(mockWallet.create).toHaveBeenCalledWith({
      data: {
        sellerId,
        balance: 0,
        lifetimeDeposited: 0,
        lifetimeSpent: 0,
      },
    });
  });

  it('deposit increments balance and creates a DEPOSIT transaction', async () => {
    mockWallet.findUnique.mockResolvedValueOnce({
      id: 'wallet-1',
      sellerId,
      balance: 500,
    });
    mockWallet.update.mockResolvedValueOnce({
      id: 'wallet-1',
      sellerId,
      balance: 1500,
      lifetimeDeposited: 1500,
      lifetimeSpent: 0,
      currency: 'PHP',
    });
    mockTransactions.create.mockResolvedValueOnce({
      id: 'tx-1',
      walletId: 'wallet-1',
      type: 'DEPOSIT',
      amount: 1000,
      balanceAfter: 1500,
      referenceKey: 'REF-DEP-001',
      description: 'Test deposit',
    });

    const result = await MarketingWalletRepository.deposit(prisma, {
      sellerId,
      amount: 1000,
      referenceKey: 'REF-DEP-001',
      description: 'Test deposit',
    });

    expect(result.wallet.balance).toBe(1500);
    expect(result.transaction.type).toBe('DEPOSIT');
    expect(mockWallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet-1' },
      data: {
        balance: { increment: 1000 },
        lifetimeDeposited: { increment: 1000 },
      },
    });
  });

  it('deposit throws an error if amount is <= 0', async () => {
    await expect(
      MarketingWalletRepository.deposit(prisma, {
        sellerId,
        amount: 0,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('deductSpend decrements balance and creates an AD_SPEND transaction when funds are sufficient', async () => {
    mockWallet.findUnique.mockResolvedValueOnce({
      id: 'wallet-1',
      sellerId,
      balance: 100,
    });
    mockWallet.update.mockResolvedValueOnce({
      id: 'wallet-1',
      sellerId,
      balance: 90,
      lifetimeDeposited: 100,
      lifetimeSpent: 10,
      currency: 'PHP',
    });
    mockTransactions.create.mockResolvedValueOnce({
      id: 'tx-2',
      walletId: 'wallet-1',
      type: 'AD_SPEND',
      amount: 10,
      balanceAfter: 90,
      adId: 'ad-123',
    });

    const result = await MarketingWalletRepository.deductSpend(prisma, {
      sellerId,
      adId: 'ad-123',
      amount: 10,
      description: 'Ad click spend',
    });

    expect(result).toMatchObject({
      success: true,
      wallet: { balance: 90 },
      transaction: { amount: 10, type: 'AD_SPEND' },
    });
  });

  it('deductSpend returns insufficient funds when balance is less than amount', async () => {
    mockWallet.findUnique.mockResolvedValueOnce({
      id: 'wallet-1',
      sellerId,
      balance: 2,
    });

    const result = await MarketingWalletRepository.deductSpend(prisma, {
      sellerId,
      adId: 'ad-123',
      amount: 5,
    });

    expect(result).toEqual({
      success: false,
      reason: 'INSUFFICIENT_FUNDS',
      balance: 2,
    });
    expect(mockWallet.update).not.toHaveBeenCalled();
    expect(mockTransactions.create).not.toHaveBeenCalled();
  });

  it('getTransactions returns paginated list of transactions', async () => {
    const txList = [
      { id: 'tx-1', amount: 100, type: 'DEPOSIT', createdAt: new Date() },
      { id: 'tx-2', amount: 0.5, type: 'AD_SPEND', createdAt: new Date() },
    ];
    mockTransactions.findMany.mockResolvedValueOnce(txList);
    mockTransactions.count.mockResolvedValueOnce(2);

    const result = await MarketingWalletRepository.getTransactions(prisma, 'wallet-1', {
      page: 1,
      limit: 10,
    });

    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
  });
});

describe('MarketingWalletService', () => {
  const sellerId = 'seller-123';
  const user = {
    id: 'user-1',
    seller: { id: sellerId },
  } as unknown as AuthUser;

  it('getWallet returns formatted wallet overview', async () => {
    mockWallet.findUnique.mockResolvedValueOnce({
      id: 'wallet-1',
      sellerId,
      balance: '250.50',
      lifetimeDeposited: '500.00',
      lifetimeSpent: '249.50',
      currency: 'PHP',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await MarketingWalletService.getWallet(user);

    expect(result).toEqual(
      expect.objectContaining({
        id: 'wallet-1',
        sellerId,
        balance: 250.5,
        lifetimeDeposited: 500,
        lifetimeSpent: 249.5,
        currency: 'PHP',
      }),
    );
  });

  it('deposit formats wallet and transaction output', async () => {
    mockWallet.findUnique.mockResolvedValueOnce({
      id: 'wallet-1',
      sellerId,
      balance: 100,
    });
    mockWallet.update.mockResolvedValueOnce({
      id: 'wallet-1',
      sellerId,
      balance: '300.00',
      lifetimeDeposited: '300.00',
      lifetimeSpent: '0.00',
      currency: 'PHP',
    });
    mockTransactions.create.mockResolvedValueOnce({
      id: 'tx-1',
      walletId: 'wallet-1',
      type: 'DEPOSIT',
      amount: '200.00',
      balanceAfter: '300.00',
      referenceKey: 'REF-1',
      description: 'Deposit',
      createdAt: new Date(),
    });

    const result = await MarketingWalletService.deposit(user, 200, 'REF-1', 'Deposit');

    expect(result.wallet.balance).toBe(300);
    expect(result.transaction.amount).toBe(200);
    expect(result.transaction.balanceAfter).toBe(300);
  });

  it('throws 403 when user is not a seller', () => {
    const nonSellerUser = { id: 'user-no-seller' } as unknown as AuthUser;
    expect(() => MarketingWalletService.resolveSellerId(nonSellerUser)).toThrow();
  });
});
