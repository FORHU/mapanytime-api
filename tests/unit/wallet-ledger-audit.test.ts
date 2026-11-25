jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    rewardWallet: {
      findMany: jest.fn(),
    },
    agentCommissionAccount: {
      findMany: jest.fn(),
    },
    auditLogs: {
      create: jest.fn(),
    },
  },
}));

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { prisma } from '../../src/utils/prisma';
import WalletLedgerAuditService from '../../src/modules/audit/wallet-ledger-audit.service';
import AuditService from '../../src/modules/audit/audit.service';

const mockPrisma = prisma as unknown as {
  rewardWallet: {
    findMany: jest.Mock;
  };
  agentCommissionAccount: {
    findMany: jest.Mock;
  };
  auditLogs: {
    create: jest.Mock;
  };
};

describe('WalletLedgerAuditService (ECO-11)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('auditRewardWallets', () => {
    it('returns clean audit when all wallets match ledger transactions', async () => {
      mockPrisma.rewardWallet.findMany.mockResolvedValueOnce([
        {
          id: 'wallet_1',
          buyerId: 'buyer_1',
          balance: 300,
          lifetimeEarned: 500,
          lifetimeSpent: 200,
          transactions: [
            { amount: 500, type: 'EARN' },
            { amount: -200, type: 'SPEND' },
          ],
        },
        {
          id: 'wallet_2',
          buyerId: 'buyer_2',
          balance: 0,
          lifetimeEarned: 0,
          lifetimeSpent: 0,
          transactions: [],
        },
      ]);

      const result = await WalletLedgerAuditService.auditRewardWallets();

      expect(result.auditedCount).toBe(2);
      expect(result.discrepanciesCount).toBe(0);
      expect(result.discrepancies).toHaveLength(0);
      expect(mockPrisma.auditLogs.create).not.toHaveBeenCalled();
    });

    it('detects and logs discrepancy when wallet balance drifts from ledger', async () => {
      const recordSpy = jest.spyOn(AuditService, 'record');

      mockPrisma.rewardWallet.findMany.mockResolvedValueOnce([
        {
          id: 'wallet_drift',
          buyerId: 'buyer_drift',
          balance: 450, // Should be 300 based on transactions!
          lifetimeEarned: 500,
          lifetimeSpent: 200,
          transactions: [
            { amount: 500, type: 'EARN' },
            { amount: -200, type: 'SPEND' },
          ],
        },
      ]);

      const result = await WalletLedgerAuditService.auditRewardWallets();

      expect(result.auditedCount).toBe(1);
      expect(result.discrepanciesCount).toBe(1);
      expect(result.discrepancies[0]).toEqual({
        walletId: 'wallet_drift',
        buyerId: 'buyer_drift',
        field: 'balance',
        walletValue: 450,
        ledgerValue: 300,
        delta: 150,
      });

      expect(recordSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          performedById: 'SYSTEM_AUDIT_CRON',
          action: 'FINANCIAL_AUDIT_DISCREPANCY',
          entityType: 'RewardWallet',
          entityId: 'wallet_drift',
          metadata: expect.objectContaining({
            delta: 150,
            field: 'balance',
          }),
        }),
      );
    });

    it('detects lifetimeEarned and lifetimeSpent discrepancies', async () => {
      mockPrisma.rewardWallet.findMany.mockResolvedValueOnce([
        {
          id: 'wallet_meta_drift',
          buyerId: 'buyer_3',
          balance: 300,
          lifetimeEarned: 400, // Should be 500
          lifetimeSpent: 100, // Should be 200
          transactions: [
            { amount: 500, type: 'EARN' },
            { amount: -200, type: 'SPEND' },
          ],
        },
      ]);

      const result = await WalletLedgerAuditService.auditRewardWallets();

      expect(result.discrepanciesCount).toBe(2);
      expect(result.discrepancies.map((d) => d.field)).toEqual(['lifetimeEarned', 'lifetimeSpent']);
    });
  });

  describe('auditAgentCommissionAccounts', () => {
    it('returns clean audit when agent commission accounts match transactions and payouts', async () => {
      mockPrisma.agentCommissionAccount.findMany.mockResolvedValueOnce([
        {
          id: 'acc_1',
          agentId: 'agent_1',
          pendingBalance: '50.00',
          availableBalance: '700.00',
          lifetimeEarned: '1000.00',
          lifetimePaid: '300.00',
          transactions: [
            { commissionAmount: '50.00', status: 'PENDING' },
            { commissionAmount: '1000.00', status: 'MATURED' },
          ],
          payouts: [
            { amount: '300.00', status: 'COMPLETED' },
            { amount: '100.00', status: 'FAILED' }, // Failed/rejected does not reduce availableBalance
          ],
        },
      ]);

      const result = await WalletLedgerAuditService.auditAgentCommissionAccounts();

      expect(result.auditedCount).toBe(1);
      expect(result.discrepanciesCount).toBe(0);
      expect(result.discrepancies).toHaveLength(0);
      expect(mockPrisma.auditLogs.create).not.toHaveBeenCalled();
    });

    it('detects discrepancy in availableBalance or pendingBalance and writes audit log', async () => {
      const recordSpy = jest.spyOn(AuditService, 'record');

      mockPrisma.agentCommissionAccount.findMany.mockResolvedValueOnce([
        {
          id: 'acc_drift',
          agentId: 'agent_drift',
          pendingBalance: '100.00', // Should be 50.00!
          availableBalance: '500.00', // Should be 700.00!
          lifetimeEarned: '1000.00',
          lifetimePaid: '300.00',
          transactions: [
            { commissionAmount: '50.00', status: 'PENDING' },
            { commissionAmount: '1000.00', status: 'MATURED' },
          ],
          payouts: [{ amount: '300.00', status: 'COMPLETED' }],
        },
      ]);

      const result = await WalletLedgerAuditService.auditAgentCommissionAccounts();

      expect(result.auditedCount).toBe(1);
      expect(result.discrepanciesCount).toBe(2);
      expect(result.discrepancies.map((d) => d.field)).toEqual([
        'pendingBalance',
        'availableBalance',
      ]);

      expect(recordSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'FINANCIAL_AUDIT_DISCREPANCY',
          entityType: 'AgentCommissionAccount',
          entityId: 'acc_drift',
        }),
      );
    });
  });

  describe('runFullAudit', () => {
    it('executes both audits and combines discrepancy counts', async () => {
      mockPrisma.rewardWallet.findMany.mockResolvedValueOnce([]);
      mockPrisma.agentCommissionAccount.findMany.mockResolvedValueOnce([]);

      const report = await WalletLedgerAuditService.runFullAudit();

      expect(report.totalDiscrepancies).toBe(0);
      expect(report.rewardWallets.auditedCount).toBe(0);
      expect(report.agentCommissionAccounts.auditedCount).toBe(0);
      expect(report.timestamp).toBeInstanceOf(Date);
    });
  });
});
