import { Prisma, PrismaClient, PAYOUTSTATUS } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import logger from '../../utils/logger';
import AuditService from './audit.service';

type DbClient = Prisma.TransactionClient | PrismaClient;

export interface RewardWalletDiscrepancy {
  walletId: string;
  buyerId: string;
  field: 'balance' | 'lifetimeEarned' | 'lifetimeSpent';
  walletValue: number;
  ledgerValue: number;
  delta: number;
}

export interface RewardWalletAuditResult {
  auditedCount: number;
  discrepanciesCount: number;
  discrepancies: RewardWalletDiscrepancy[];
}

export interface CommissionAccountDiscrepancy {
  accountId: string;
  agentId: string;
  field: 'pendingBalance' | 'availableBalance' | 'lifetimeEarned' | 'lifetimePaid';
  accountValue: number;
  ledgerValue: number;
  delta: number;
}

export interface AgentCommissionAuditResult {
  auditedCount: number;
  discrepanciesCount: number;
  discrepancies: CommissionAccountDiscrepancy[];
}

export interface FullAuditReport {
  timestamp: Date;
  rewardWallets: RewardWalletAuditResult;
  agentCommissionAccounts: AgentCommissionAuditResult;
  totalDiscrepancies: number;
}

export default class WalletLedgerAuditService {
  /**
   * Audits all RewardWallet records against RewardTransactions.
   *
   * Invariants:
   * 1. wallet.balance == SUM(transactions.amount)
   * 2. wallet.lifetimeEarned == SUM(transactions.amount WHERE amount > 0)
   * 3. wallet.lifetimeSpent == ABS(SUM(transactions.amount WHERE type = 'SPEND'))
   */
  static async auditRewardWallets(client: DbClient = prisma): Promise<RewardWalletAuditResult> {
    const wallets = await client.rewardWallet.findMany({
      include: {
        transactions: {
          select: {
            amount: true,
            type: true,
          },
        },
      },
    });

    const discrepancies: RewardWalletDiscrepancy[] = [];

    for (const wallet of wallets) {
      let sumBalance = 0;
      let sumEarned = 0;
      let sumSpent = 0;

      for (const tx of wallet.transactions) {
        sumBalance += tx.amount;
        if (tx.amount > 0) {
          sumEarned += tx.amount;
        }
        if (tx.type === 'SPEND') {
          sumSpent += Math.abs(tx.amount);
        }
      }

      // Check balance
      if (wallet.balance !== sumBalance) {
        discrepancies.push({
          walletId: wallet.id,
          buyerId: wallet.buyerId,
          field: 'balance',
          walletValue: wallet.balance,
          ledgerValue: sumBalance,
          delta: wallet.balance - sumBalance,
        });
      }

      // Check lifetimeEarned
      if (wallet.lifetimeEarned !== sumEarned) {
        discrepancies.push({
          walletId: wallet.id,
          buyerId: wallet.buyerId,
          field: 'lifetimeEarned',
          walletValue: wallet.lifetimeEarned,
          ledgerValue: sumEarned,
          delta: wallet.lifetimeEarned - sumEarned,
        });
      }

      // Check lifetimeSpent
      if (wallet.lifetimeSpent !== sumSpent) {
        discrepancies.push({
          walletId: wallet.id,
          buyerId: wallet.buyerId,
          field: 'lifetimeSpent',
          walletValue: wallet.lifetimeSpent,
          ledgerValue: sumSpent,
          delta: wallet.lifetimeSpent - sumSpent,
        });
      }
    }

    // Record discrepancies to AuditLog
    for (const d of discrepancies) {
      logger.error(
        `[Audit:ECO-11] RewardWallet discrepancy on ${d.walletId} (${d.field}): wallet=${d.walletValue}, ledger=${d.ledgerValue}, delta=${d.delta}`,
      );

      await AuditService.record({
        performedById: 'SYSTEM_AUDIT_CRON',
        action: 'FINANCIAL_AUDIT_DISCREPANCY',
        entityType: 'RewardWallet',
        entityId: d.walletId,
        metadata: {
          buyerId: d.buyerId,
          field: d.field,
          walletValue: d.walletValue,
          ledgerValue: d.ledgerValue,
          delta: d.delta,
          severity: 'HIGH',
        },
      });
    }

    return {
      auditedCount: wallets.length,
      discrepanciesCount: discrepancies.length,
      discrepancies,
    };
  }

  /**
   * Audits all AgentCommissionAccount records against AgentCommissionTransactions and AgentPayouts.
   *
   * Invariants:
   * 1. account.pendingBalance == SUM(transactions.commissionAmount WHERE status = 'PENDING')
   * 2. account.lifetimeEarned == SUM(transactions.commissionAmount WHERE status = 'MATURED')
   * 3. account.lifetimePaid == SUM(payouts.amount WHERE status = 'COMPLETED')
   * 4. account.availableBalance == lifetimeEarned - SUM(payouts.amount WHERE status != 'REJECTED')
   */
  static async auditAgentCommissionAccounts(
    client: DbClient = prisma,
  ): Promise<AgentCommissionAuditResult> {
    const accounts = await client.agentCommissionAccount.findMany({
      include: {
        transactions: {
          select: {
            commissionAmount: true,
            status: true,
          },
        },
        payouts: {
          select: {
            amount: true,
            status: true,
          },
        },
      },
    });

    const discrepancies: CommissionAccountDiscrepancy[] = [];

    for (const account of accounts) {
      let pendingSum = 0;
      let maturedSum = 0;

      for (const tx of account.transactions) {
        const amt = Number(tx.commissionAmount);
        if (tx.status === 'PENDING') {
          pendingSum += amt;
        } else if (tx.status === 'MATURED') {
          maturedSum += amt;
        }
      }

      let lifetimePaidSum = 0;
      let totalDeductedPayouts = 0;

      const payouts = account.payouts ?? [];
      for (const p of payouts) {
        const amt = Number(p.amount);
        if (p.status === PAYOUTSTATUS.COMPLETED) {
          lifetimePaidSum += amt;
        }
        if (p.status !== PAYOUTSTATUS.FAILED) {
          totalDeductedPayouts += amt;
        }
      }

      const expectedAvailable = maturedSum - totalDeductedPayouts;

      const pendingBal = Number(account.pendingBalance);
      const availBal = Number(account.availableBalance);
      const earned = Number(account.lifetimeEarned);
      const paid = Number(account.lifetimePaid);

      const EPSILON = 0.005; // Guard against sub-cent floating-point precision

      if (Math.abs(pendingBal - pendingSum) > EPSILON) {
        discrepancies.push({
          accountId: account.id,
          agentId: account.agentId,
          field: 'pendingBalance',
          accountValue: pendingBal,
          ledgerValue: pendingSum,
          delta: Number((pendingBal - pendingSum).toFixed(2)),
        });
      }

      if (Math.abs(earned - maturedSum) > EPSILON) {
        discrepancies.push({
          accountId: account.id,
          agentId: account.agentId,
          field: 'lifetimeEarned',
          accountValue: earned,
          ledgerValue: maturedSum,
          delta: Number((earned - maturedSum).toFixed(2)),
        });
      }

      if (Math.abs(paid - lifetimePaidSum) > EPSILON) {
        discrepancies.push({
          accountId: account.id,
          agentId: account.agentId,
          field: 'lifetimePaid',
          accountValue: paid,
          ledgerValue: lifetimePaidSum,
          delta: Number((paid - lifetimePaidSum).toFixed(2)),
        });
      }

      if (Math.abs(availBal - expectedAvailable) > EPSILON) {
        discrepancies.push({
          accountId: account.id,
          agentId: account.agentId,
          field: 'availableBalance',
          accountValue: availBal,
          ledgerValue: expectedAvailable,
          delta: Number((availBal - expectedAvailable).toFixed(2)),
        });
      }
    }

    // Record discrepancies to AuditLog
    for (const d of discrepancies) {
      logger.error(
        `[Audit:ECO-11] AgentCommissionAccount discrepancy on ${d.accountId} (${d.field}): account=${d.accountValue}, ledger=${d.ledgerValue}, delta=${d.delta}`,
      );

      await AuditService.record({
        performedById: 'SYSTEM_AUDIT_CRON',
        action: 'FINANCIAL_AUDIT_DISCREPANCY',
        entityType: 'AgentCommissionAccount',
        entityId: d.accountId,
        metadata: {
          agentId: d.agentId,
          field: d.field,
          accountValue: d.accountValue,
          ledgerValue: d.ledgerValue,
          delta: d.delta,
          severity: 'HIGH',
        },
      });
    }

    return {
      auditedCount: accounts.length,
      discrepanciesCount: discrepancies.length,
      discrepancies,
    };
  }

  /**
   * Executes a full audit pass across both Reward Wallets and Agent Commission Accounts.
   */
  static async runFullAudit(client: DbClient = prisma): Promise<FullAuditReport> {
    const [rewardWallets, agentCommissionAccounts] = await Promise.all([
      this.auditRewardWallets(client),
      this.auditAgentCommissionAccounts(client),
    ]);

    const totalDiscrepancies =
      rewardWallets.discrepanciesCount + agentCommissionAccounts.discrepanciesCount;

    return {
      timestamp: new Date(),
      rewardWallets,
      agentCommissionAccounts,
      totalDiscrepancies,
    };
  }
}
