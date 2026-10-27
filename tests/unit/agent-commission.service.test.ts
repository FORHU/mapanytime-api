import {
  Prisma,
  AGENTCOMMISSIONTYPE,
  COMMISSIONSTATUS,
  COMMISSIONBASE,
  PAYOUTSTATUS,
} from '@prisma/client';
import AgentCommissionService, {
  DEFAULT_COMMISSION_RATE,
  DEFAULT_PAYOUT_MINIMUM,
} from '../../src/modules/agent/agent-commission.service';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    agentCommissionAccount: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    agentCommissionTransactions: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    agentCommissionConfigurations: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    agentPayouts: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    orders: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(prisma)),
  },
}));

const mockPrisma = prisma as unknown as {
  agentCommissionAccount: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  agentCommissionTransactions: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  agentCommissionConfigurations: {
    findFirst: jest.Mock;
    updateMany: jest.Mock;
    create: jest.Mock;
  };
  agentPayouts: {
    create: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
  };
  orders: {
    findUnique: jest.Mock;
  };
};

describe('AgentCommissionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getActiveConfig', () => {
    it('returns default config if no row is in DB', async () => {
      mockPrisma.agentCommissionConfigurations.findFirst.mockResolvedValue(null);
      const config = await AgentCommissionService.getActiveConfig();

      expect(config.commissionRate).toBe(DEFAULT_COMMISSION_RATE);
      expect(config.payoutMinimum).toBe(DEFAULT_PAYOUT_MINIMUM);
      expect(config.commissionBase).toBe(COMMISSIONBASE.GMV);
      expect(config.isEnabled).toBe(true);
    });

    it('returns custom config if active row exists', async () => {
      mockPrisma.agentCommissionConfigurations.findFirst.mockResolvedValue({
        commissionRate: new Prisma.Decimal(0.001),
        commissionBase: COMMISSIONBASE.GMV,
        eligibilityHoldDays: 14,
        payoutMinimum: new Prisma.Decimal(1000),
        isEnabled: true,
      });

      const config = await AgentCommissionService.getActiveConfig();
      expect(config.commissionRate).toBe(0.001);
      expect(config.eligibilityHoldDays).toBe(14);
      expect(config.payoutMinimum).toBe(1000);
    });
  });

  describe('getOrCreateAccount & getAccountSummary', () => {
    it('creates new account when none exists', async () => {
      mockPrisma.agentCommissionAccount.findUnique.mockResolvedValue(null);
      mockPrisma.agentCommissionAccount.create.mockResolvedValue({
        id: 'acc-1',
        agentId: 'agent-123',
        availableBalance: new Prisma.Decimal(0),
        pendingBalance: new Prisma.Decimal(0),
        lifetimeEarned: new Prisma.Decimal(0),
        lifetimePaid: new Prisma.Decimal(0),
        updatedAt: new Date(),
      });

      const acc = await AgentCommissionService.getOrCreateAccount(prisma, 'agent-123');
      expect(acc.id).toBe('acc-1');
      expect(mockPrisma.agentCommissionAccount.create).toHaveBeenCalledWith({
        data: { agentId: 'agent-123' },
      });
    });

    it('returns summary with canRequestPayout flag', async () => {
      mockPrisma.agentCommissionAccount.findUnique.mockResolvedValue({
        id: 'acc-1',
        agentId: 'agent-123',
        availableBalance: new Prisma.Decimal(600),
        pendingBalance: new Prisma.Decimal(100),
        lifetimeEarned: new Prisma.Decimal(700),
        lifetimePaid: new Prisma.Decimal(0),
        updatedAt: new Date(),
      });
      mockPrisma.agentCommissionConfigurations.findFirst.mockResolvedValue(null);

      const summary = await AgentCommissionService.getAccountSummary('agent-123');
      expect(summary.availableBalance).toBe(600);
      expect(summary.pendingBalance).toBe(100);
      expect(summary.totalBalance).toBe(700);
      expect(summary.canRequestPayout).toBe(true);
    });
  });

  describe('creditOrderCommission', () => {
    it('skips when seller has no agent recruiter', async () => {
      mockPrisma.agentCommissionTransactions.findFirst.mockResolvedValue(null);
      mockPrisma.orders.findUnique.mockResolvedValue({
        id: 'ord-1',
        store: {
          sellerId: 'seller-1',
          seller: { users: { userReferralId: null } },
        },
      });

      const result = await AgentCommissionService.creditOrderCommission(prisma, 'ord-1');
      expect(result).toBeNull();
      expect(mockPrisma.agentCommissionAccount.update).not.toHaveBeenCalled();
    });

    it('credits commission to pending balance when recruiter exists', async () => {
      mockPrisma.agentCommissionTransactions.findFirst.mockResolvedValue(null);
      mockPrisma.orders.findUnique.mockResolvedValue({
        id: 'ord-1',
        subtotalAmount: new Prisma.Decimal(2000),
        discountAmount: new Prisma.Decimal(0),
        store: {
          sellerId: 'seller-1',
          seller: { users: { userReferralId: 'agent-456' } },
        },
      });

      mockPrisma.agentCommissionConfigurations.findFirst.mockResolvedValue(null);
      mockPrisma.agentCommissionAccount.findUnique.mockResolvedValue({
        id: 'acc-456',
        agentId: 'agent-456',
        pendingBalance: new Prisma.Decimal(0),
      });

      mockPrisma.agentCommissionAccount.update.mockResolvedValue({
        id: 'acc-456',
        pendingBalance: new Prisma.Decimal(1.0),
        lifetimeEarned: new Prisma.Decimal(1.0),
      });

      mockPrisma.agentCommissionTransactions.create.mockResolvedValue({
        id: 'tx-1',
        orderId: 'ord-1',
        commissionAmount: new Prisma.Decimal(1.0),
        status: COMMISSIONSTATUS.PENDING,
      });

      const result = await AgentCommissionService.creditOrderCommission(prisma, 'ord-1');
      expect(result).toBeDefined();

      // ₱2000 * 0.0005 = ₱1.00
      expect(mockPrisma.agentCommissionAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-456' },
        data: {
          pendingBalance: { increment: new Prisma.Decimal(1.0) },
          lifetimeEarned: { increment: new Prisma.Decimal(1.0) },
        },
      });
      expect(mockPrisma.agentCommissionTransactions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: 'ord-1',
            commissionAmount: new Prisma.Decimal(1.0),
            status: COMMISSIONSTATUS.PENDING,
          }),
        }),
      );
    });

    it('returns existing transaction on idempotency check', async () => {
      mockPrisma.agentCommissionTransactions.findFirst.mockResolvedValue({
        id: 'tx-existing',
        orderId: 'ord-1',
      });

      const result = await AgentCommissionService.creditOrderCommission(prisma, 'ord-1');
      expect(result).toEqual({ id: 'tx-existing', orderId: 'ord-1' });
      expect(mockPrisma.orders.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('requestPayout & approvePayout', () => {
    it('rejects payout if requested amount is below minimum (₱500)', async () => {
      mockPrisma.agentCommissionConfigurations.findFirst.mockResolvedValue(null);

      await expect(AgentCommissionService.requestPayout('agent-1', 200)).rejects.toMatchObject({
        status: 400,
      });
    });

    it('rejects payout if available balance is insufficient', async () => {
      mockPrisma.agentCommissionConfigurations.findFirst.mockResolvedValue(null);
      mockPrisma.agentCommissionAccount.findUnique.mockResolvedValue({
        id: 'acc-1',
        agentId: 'agent-1',
        availableBalance: new Prisma.Decimal(400),
      });

      await expect(AgentCommissionService.requestPayout('agent-1', 500)).rejects.toMatchObject({
        status: 400,
      });
    });

    it('deducts available balance and creates payout request', async () => {
      mockPrisma.agentCommissionConfigurations.findFirst.mockResolvedValue(null);
      mockPrisma.agentCommissionAccount.findUnique.mockResolvedValue({
        id: 'acc-1',
        agentId: 'agent-1',
        availableBalance: new Prisma.Decimal(1000),
      });

      mockPrisma.agentPayouts.create.mockResolvedValue({
        id: 'payout-1',
        agentId: 'agent-1',
        accountId: 'acc-1',
        amount: new Prisma.Decimal(500),
        status: PAYOUTSTATUS.PENDING,
      });

      const res = await AgentCommissionService.requestPayout('agent-1', 500, 'BANK_TRANSFER');
      expect(res.id).toBe('payout-1');
      expect(res.amount).toBe(500);
      expect(mockPrisma.agentCommissionAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: {
          availableBalance: { decrement: new Prisma.Decimal(500) },
        },
      });
    });

    it('approves payout and increments lifetimePaid', async () => {
      mockPrisma.agentPayouts.findUnique.mockResolvedValue({
        id: 'payout-1',
        accountId: 'acc-1',
        amount: new Prisma.Decimal(500),
        status: PAYOUTSTATUS.PENDING,
      });

      mockPrisma.agentPayouts.update.mockResolvedValue({
        id: 'payout-1',
        amount: new Prisma.Decimal(500),
        status: PAYOUTSTATUS.COMPLETED,
      });

      const res = await AgentCommissionService.approvePayout('payout-1', 'BANK-REF-999');
      expect(res.status).toBe(PAYOUTSTATUS.COMPLETED);
      expect(mockPrisma.agentCommissionAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: {
          lifetimePaid: { increment: new Prisma.Decimal(500) },
        },
      });
    });
  });

  describe('reverseOrderCommission', () => {
    it('deducts pending balance and cancels transaction on refund', async () => {
      mockPrisma.agentCommissionTransactions.findFirst
        .mockResolvedValueOnce({
          id: 'tx-1',
          accountId: 'acc-1',
          agentId: 'agent-1',
          sellerId: 'seller-1',
          orderId: 'ord-1',
          commissionAmount: new Prisma.Decimal(10),
          status: COMMISSIONSTATUS.PENDING,
          commissionRate: new Prisma.Decimal(0.0005),
          commissionBase: COMMISSIONBASE.GMV,
          baseAmount: new Prisma.Decimal(20000),
        })
        .mockResolvedValueOnce(null); // existingReversal check

      mockPrisma.agentCommissionAccount.findUnique.mockResolvedValue({
        id: 'acc-1',
        availableBalance: new Prisma.Decimal(0),
        pendingBalance: new Prisma.Decimal(50),
      });

      mockPrisma.agentCommissionTransactions.create.mockResolvedValue({
        id: 'tx-rev-1',
        type: AGENTCOMMISSIONTYPE.COMMISSION_REVERSAL,
      });

      const res = await AgentCommissionService.reverseOrderCommission(prisma, 'ord-1');
      expect(res).toBeDefined();
      expect(mockPrisma.agentCommissionAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: {
          pendingBalance: { decrement: new Prisma.Decimal(10) },
          lifetimeEarned: { decrement: new Prisma.Decimal(10) },
        },
      });
      expect(mockPrisma.agentCommissionTransactions.update).toHaveBeenCalledWith({
        where: { id: 'tx-1' },
        data: { status: COMMISSIONSTATUS.CANCELLED },
      });
    });
  });

  describe('maturePendingCommissions', () => {
    it('shifts funds from pending to available when matured', async () => {
      mockPrisma.agentCommissionTransactions.findMany.mockResolvedValue([
        {
          id: 'tx-mature-1',
          accountId: 'acc-1',
          commissionAmount: new Prisma.Decimal(25),
        },
      ]);

      mockPrisma.agentCommissionTransactions.findUnique.mockResolvedValue({
        id: 'tx-mature-1',
        accountId: 'acc-1',
        commissionAmount: new Prisma.Decimal(25),
        status: COMMISSIONSTATUS.PENDING,
      });

      const count = await AgentCommissionService.maturePendingCommissions();
      expect(count).toBe(1);
      expect(mockPrisma.agentCommissionAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: {
          pendingBalance: { decrement: new Prisma.Decimal(25) },
          availableBalance: { increment: new Prisma.Decimal(25) },
        },
      });
      expect(mockPrisma.agentCommissionTransactions.update).toHaveBeenCalledWith({
        where: { id: 'tx-mature-1' },
        data: { status: COMMISSIONSTATUS.MATURED },
      });
    });
  });
});
