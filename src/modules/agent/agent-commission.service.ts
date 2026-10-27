import {
  Prisma,
  PrismaClient,
  AGENTCOMMISSIONTYPE,
  COMMISSIONSTATUS,
  COMMISSIONBASE,
  PAYOUTSTATUS,
} from '@prisma/client';
import { prisma } from '../../utils/prisma';
import logger from '../../utils/logger';

type DbClient = Prisma.TransactionClient | PrismaClient;

export const DEFAULT_COMMISSION_RATE = 0.0005; // 0.05% GMV
export const DEFAULT_COMMISSION_BASE = COMMISSIONBASE.GMV;
export const DEFAULT_HOLD_DAYS = 7;
export const DEFAULT_PAYOUT_MINIMUM = 500.0;

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export interface UpdateCommissionConfigInput {
  commissionRate?: number;
  commissionBase?: COMMISSIONBASE;
  eligibilityHoldDays?: number;
  payoutMinimum?: number;
  isEnabled?: boolean;
  changeReason?: string;
}

export default class AgentCommissionService {
  /**
   * Fetches the currently active commission configuration or returns built-in defaults.
   */
  static async getActiveConfig(client: DbClient = prisma) {
    const config = await client.agentCommissionConfigurations.findFirst({
      where: { isActive: true },
      orderBy: { version: 'desc' },
    });

    return {
      commissionRate: config ? Number(config.commissionRate) : DEFAULT_COMMISSION_RATE,
      commissionBase: config ? config.commissionBase : DEFAULT_COMMISSION_BASE,
      eligibilityHoldDays: config ? config.eligibilityHoldDays : DEFAULT_HOLD_DAYS,
      payoutMinimum: config ? Number(config.payoutMinimum) : DEFAULT_PAYOUT_MINIMUM,
      isEnabled: config ? config.isEnabled : true,
      rawConfig: config,
    };
  }

  /**
   * Updates commission configuration (Admin only) by versioning the active row.
   */
  static async updateConfig(adminUserId: string, patch: UpdateCommissionConfigInput) {
    return prisma.$transaction(async (tx) => {
      const current = await tx.agentCommissionConfigurations.findFirst({
        where: { isActive: true },
        orderBy: { version: 'desc' },
      });

      if (current) {
        await tx.agentCommissionConfigurations.updateMany({
          where: { isActive: true },
          data: { isActive: false, effectiveTo: new Date() },
        });
      }

      const nextVersion = current ? current.version + 1 : 1;

      return tx.agentCommissionConfigurations.create({
        data: {
          version: nextVersion,
          isActive: true,
          commissionRate:
            patch.commissionRate != null
              ? new Prisma.Decimal(patch.commissionRate)
              : (current?.commissionRate ?? new Prisma.Decimal(DEFAULT_COMMISSION_RATE)),
          commissionBase:
            patch.commissionBase ?? current?.commissionBase ?? DEFAULT_COMMISSION_BASE,
          eligibilityHoldDays:
            patch.eligibilityHoldDays ?? current?.eligibilityHoldDays ?? DEFAULT_HOLD_DAYS,
          payoutMinimum:
            patch.payoutMinimum != null
              ? new Prisma.Decimal(patch.payoutMinimum)
              : (current?.payoutMinimum ?? new Prisma.Decimal(DEFAULT_PAYOUT_MINIMUM)),
          isEnabled: patch.isEnabled ?? current?.isEnabled ?? true,
          updatedById: adminUserId,
          changeReason: patch.changeReason || 'Commission configuration updated',
        },
      });
    });
  }

  /**
   * Retrieves or lazily creates an agent's commission account.
   */
  static async getOrCreateAccount(client: DbClient, agentId: string) {
    const existing = await client.agentCommissionAccount.findUnique({
      where: { agentId },
    });
    if (existing) return existing;

    return client.agentCommissionAccount.create({
      data: { agentId },
    });
  }

  /**
   * Retrieves account balance overview and metrics for an agent.
   */
  static async getAccountSummary(agentId: string) {
    const account = await this.getOrCreateAccount(prisma, agentId);
    const config = await this.getActiveConfig(prisma);

    return {
      accountId: account.id,
      agentId: account.agentId,
      availableBalance: Number(account.availableBalance),
      pendingBalance: Number(account.pendingBalance),
      totalBalance: Number(account.availableBalance) + Number(account.pendingBalance),
      lifetimeEarned: Number(account.lifetimeEarned),
      lifetimePaid: Number(account.lifetimePaid),
      payoutMinimum: config.payoutMinimum,
      canRequestPayout: Number(account.availableBalance) >= config.payoutMinimum,
      updatedAt: account.updatedAt,
    };
  }

  /**
   * List paginated commission transactions for an agent.
   */
  static async getTransactions(
    agentId: string,
    params: { page?: number; limit?: number; status?: COMMISSIONSTATUS },
  ) {
    const account = await this.getOrCreateAccount(prisma, agentId);
    const page = Math.max(1, params.page || 1);
    const limit = Math.max(1, Math.min(100, params.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.AgentCommissionTransactionsWhereInput = {
      accountId: account.id,
      ...(params.status ? { status: params.status } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.agentCommissionTransactions.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.agentCommissionTransactions.count({ where }),
    ]);

    return {
      items: items.map((t) => ({
        ...t,
        commissionRate: Number(t.commissionRate),
        baseAmount: Number(t.baseAmount),
        commissionAmount: Number(t.commissionAmount),
        balanceAfter: Number(t.balanceAfter),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * List paginated payout requests for an agent.
   */
  static async getPayouts(agentId: string, params: { page?: number; limit?: number }) {
    const account = await this.getOrCreateAccount(prisma, agentId);
    const page = Math.max(1, params.page || 1);
    const limit = Math.max(1, Math.min(100, params.limit || 20));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      prisma.agentPayouts.findMany({
        where: { accountId: account.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.agentPayouts.count({ where: { accountId: account.id } }),
    ]);

    return {
      items: items.map((p) => ({
        ...p,
        amount: Number(p.amount),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Agent requests a payout of available earnings.
   */
  static async requestPayout(
    agentId: string,
    amount: number,
    paymentMethod: string = 'BANK_TRANSFER',
    reference?: string,
  ) {
    const config = await this.getActiveConfig(prisma);
    if (amount < config.payoutMinimum) {
      throw {
        status: 400,
        message: `Payout amount ₱${amount.toFixed(2)} is below minimum ₱${config.payoutMinimum.toFixed(2)}.`,
      };
    }

    return prisma.$transaction(async (tx) => {
      const account = await this.getOrCreateAccount(tx, agentId);

      if (Number(account.availableBalance) < amount) {
        throw {
          status: 400,
          message: `Insufficient available balance (₱${Number(account.availableBalance).toFixed(2)}) for payout of ₱${amount.toFixed(2)}.`,
        };
      }

      // Deduct from available balance atomically
      await tx.agentCommissionAccount.update({
        where: { id: account.id },
        data: {
          availableBalance: { decrement: new Prisma.Decimal(amount) },
        },
      });

      const payout = await tx.agentPayouts.create({
        data: {
          agentId,
          accountId: account.id,
          amount: new Prisma.Decimal(amount),
          status: PAYOUTSTATUS.PENDING,
          paymentMethod,
          reference: reference || null,
        },
      });

      logger.info(
        `[AgentCommission] Payout requested: ${payout.id} by agent ${agentId} for ₱${amount}`,
      );

      return {
        ...payout,
        amount: Number(payout.amount),
      };
    });
  }

  /**
   * Approves/completes an agent payout (Admin only).
   */
  static async approvePayout(payoutId: string, reference?: string) {
    return prisma.$transaction(async (tx) => {
      const payout = await tx.agentPayouts.findUnique({
        where: { id: payoutId },
      });

      if (!payout) {
        throw { status: 404, message: 'Payout request not found.' };
      }
      if (payout.status !== PAYOUTSTATUS.PENDING && payout.status !== PAYOUTSTATUS.PROCESSING) {
        throw { status: 400, message: `Cannot approve payout in ${payout.status} state.` };
      }

      await tx.agentCommissionAccount.update({
        where: { id: payout.accountId },
        data: {
          lifetimePaid: { increment: payout.amount },
        },
      });

      const updated = await tx.agentPayouts.update({
        where: { id: payoutId },
        data: {
          status: PAYOUTSTATUS.COMPLETED,
          reference: reference || payout.reference,
          processedAt: new Date(),
        },
      });

      return {
        ...updated,
        amount: Number(updated.amount),
      };
    });
  }

  /**
   * Credits recruiter commission for an order.
   *
   * Idempotent and concurrency-safe. Call inside the order completion transaction.
   */
  static async creditOrderCommission(client: DbClient, orderId: string) {
    // 1. Idempotency check: don't double-credit for this order
    const existing = await client.agentCommissionTransactions.findFirst({
      where: { orderId, type: AGENTCOMMISSIONTYPE.SALE_COMMISSION },
    });
    if (existing) return existing;

    // 2. Fetch order and resolve seller's agent recruiter
    const order = await client.orders.findUnique({
      where: { id: orderId },
      include: {
        store: {
          select: {
            sellerId: true,
            seller: {
              select: {
                userId: true,
                users: {
                  select: { userReferralId: true },
                },
              },
            },
          },
        },
      },
    });

    if (!order) return null;

    const agentId = order.store?.seller?.users?.userReferralId;
    const sellerId = order.store?.sellerId;
    if (!agentId || !sellerId) {
      // Seller was not recruited by an agent — no recruiter commission
      return null;
    }

    // 3. Resolve active configuration
    const config = await this.getActiveConfig(client);
    if (!config.isEnabled) return null;

    // 4. Calculate commission base and amount
    const eligibleBase = Math.max(0, Number(order.subtotalAmount) - Number(order.discountAmount));
    if (eligibleBase <= 0) return null;

    const commissionAmount = Number((eligibleBase * config.commissionRate).toFixed(2));
    if (commissionAmount <= 0) return null;

    // 5. Account and hold window
    const account = await this.getOrCreateAccount(client, agentId);
    const maturesAt = addDays(new Date(), config.eligibilityHoldDays);

    // Atomically increment pendingBalance and lifetimeEarned
    const updatedAccount = await client.agentCommissionAccount.update({
      where: { id: account.id },
      data: {
        pendingBalance: { increment: new Prisma.Decimal(commissionAmount) },
        lifetimeEarned: { increment: new Prisma.Decimal(commissionAmount) },
      },
    });

    // 6. Record commission transaction
    const transaction = await client.agentCommissionTransactions.create({
      data: {
        accountId: account.id,
        agentId,
        sellerId,
        orderId,
        type: AGENTCOMMISSIONTYPE.SALE_COMMISSION,
        status: COMMISSIONSTATUS.PENDING,
        commissionRate: new Prisma.Decimal(config.commissionRate),
        commissionBase: config.commissionBase,
        baseAmount: new Prisma.Decimal(eligibleBase),
        commissionAmount: new Prisma.Decimal(commissionAmount),
        balanceAfter: updatedAccount.pendingBalance,
        referenceKey: `AGENT:COMMISSION:ORDER:${orderId}`,
        description: `Recruiter commission for order #${orderId}`,
        maturesAt,
      },
    });

    logger.info(
      `[AgentCommission] Credited ₱${commissionAmount} commission (pending, matures ${maturesAt.toISOString()}) to agent ${agentId} for order ${orderId}`,
    );

    return transaction;
  }

  /**
   * Reverses an order commission when an order is cancelled or refunded.
   */
  static async reverseOrderCommission(client: DbClient, orderId: string, reason?: string) {
    const original = await client.agentCommissionTransactions.findFirst({
      where: { orderId, type: AGENTCOMMISSIONTYPE.SALE_COMMISSION },
    });

    if (!original) return null;

    const existingReversal = await client.agentCommissionTransactions.findFirst({
      where: { orderId, type: AGENTCOMMISSIONTYPE.COMMISSION_REVERSAL },
    });
    if (existingReversal) return existingReversal;

    const account = await client.agentCommissionAccount.findUnique({
      where: { id: original.accountId },
    });
    if (!account) return null;

    const amount = Number(original.commissionAmount);

    if (original.status === COMMISSIONSTATUS.PENDING) {
      // Deduct from pending balance
      await client.agentCommissionAccount.update({
        where: { id: account.id },
        data: {
          pendingBalance: { decrement: new Prisma.Decimal(amount) },
          lifetimeEarned: { decrement: new Prisma.Decimal(amount) },
        },
      });
    } else if (original.status === COMMISSIONSTATUS.MATURED) {
      // Deduct from available balance
      await client.agentCommissionAccount.update({
        where: { id: account.id },
        data: {
          availableBalance: { decrement: new Prisma.Decimal(amount) },
          lifetimeEarned: { decrement: new Prisma.Decimal(amount) },
        },
      });
    }

    // Mark original transaction cancelled
    await client.agentCommissionTransactions.update({
      where: { id: original.id },
      data: { status: COMMISSIONSTATUS.CANCELLED },
    });

    // Record reversal transaction
    const reversal = await client.agentCommissionTransactions.create({
      data: {
        accountId: account.id,
        agentId: original.agentId,
        sellerId: original.sellerId,
        orderId,
        type: AGENTCOMMISSIONTYPE.COMMISSION_REVERSAL,
        status: COMMISSIONSTATUS.CANCELLED,
        commissionRate: original.commissionRate,
        commissionBase: original.commissionBase,
        baseAmount: original.baseAmount,
        commissionAmount: new Prisma.Decimal(-amount),
        balanceAfter: account.availableBalance,
        referenceKey: `AGENT:REVERSAL:ORDER:${orderId}`,
        description: reason || `Commission reversal for refunded order #${orderId}`,
      },
    });

    logger.info(
      `[AgentCommission] Reversed ₱${amount} commission for order ${orderId} (agent ${original.agentId})`,
    );

    return reversal;
  }

  /**
   * Scheduled maturation sweeper: moves mature PENDING transactions to MATURED
   * and shifts funds from pendingBalance to availableBalance.
   */
  static async maturePendingCommissions(client: DbClient = prisma) {
    const now = new Date();

    const dueTransactions = await client.agentCommissionTransactions.findMany({
      where: {
        status: COMMISSIONSTATUS.PENDING,
        maturesAt: { lte: now },
      },
    });

    let maturedCount = 0;
    for (const txItem of dueTransactions) {
      try {
        await prisma.$transaction(async (tx) => {
          const current = await tx.agentCommissionTransactions.findUnique({
            where: { id: txItem.id },
          });
          if (!current || current.status !== COMMISSIONSTATUS.PENDING) return;

          const amount = Number(current.commissionAmount);

          await tx.agentCommissionAccount.update({
            where: { id: current.accountId },
            data: {
              pendingBalance: { decrement: new Prisma.Decimal(amount) },
              availableBalance: { increment: new Prisma.Decimal(amount) },
            },
          });

          await tx.agentCommissionTransactions.update({
            where: { id: current.id },
            data: { status: COMMISSIONSTATUS.MATURED },
          });

          maturedCount++;
        });
      } catch (err) {
        logger.error(
          `[AgentCommission] Failed to mature transaction ${txItem.id}: ${(err as Error).message}`,
        );
      }
    }

    if (maturedCount > 0) {
      logger.info(`[AgentCommission] Matured ${maturedCount} commission transactions.`);
    }

    return maturedCount;
  }
}
