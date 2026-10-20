import { Prisma, PrismaClient, MARKETINGTRANSACTIONTYPE } from '@prisma/client';
import { buildPage } from '../../helpers/pagination.helper';

type DbClient = Prisma.TransactionClient | PrismaClient;

export interface DepositWalletInput {
  sellerId: string;
  amount: number;
  referenceKey?: string;
  description?: string;
  metadata?: Prisma.InputJsonValue;
}

export interface DeductSpendInput {
  sellerId: string;
  adId: string;
  amount: number;
  description?: string;
  metadata?: Prisma.InputJsonValue;
}

export default class MarketingWalletRepository {
  static async getOrCreateWallet(client: DbClient, sellerId: string) {
    const existing = await client.marketingWallet.findUnique({
      where: { sellerId },
    });
    if (existing) return existing;

    return client.marketingWallet.create({
      data: {
        sellerId,
        balance: 0,
        lifetimeDeposited: 0,
        lifetimeSpent: 0,
      },
    });
  }

  static async getWalletBySellerId(client: DbClient, sellerId: string) {
    return this.getOrCreateWallet(client, sellerId);
  }

  static async deposit(client: DbClient, input: DepositWalletInput) {
    const { sellerId, amount, referenceKey, description, metadata } = input;
    if (amount <= 0) {
      throw { status: 400, message: 'Deposit amount must be greater than zero.' };
    }

    const wallet = await this.getOrCreateWallet(client, sellerId);

    const updated = await client.marketingWallet.update({
      where: { id: wallet.id },
      data: {
        balance: { increment: amount },
        lifetimeDeposited: { increment: amount },
      },
    });

    const transaction = await client.marketingWalletTransactions.create({
      data: {
        walletId: wallet.id,
        type: MARKETINGTRANSACTIONTYPE.DEPOSIT,
        amount,
        balanceAfter: updated.balance,
        referenceKey: referenceKey || undefined,
        description: description || 'Marketing wallet deposit',
        metadata: metadata ?? undefined,
      },
    });

    return { wallet: updated, transaction };
  }

  static async deductSpend(client: DbClient, input: DeductSpendInput) {
    const { sellerId, adId, amount, description, metadata } = input;
    if (amount <= 0) {
      return null;
    }

    const wallet = await this.getOrCreateWallet(client, sellerId);
    if (Number(wallet.balance) < amount) {
      return { success: false, reason: 'INSUFFICIENT_FUNDS', balance: Number(wallet.balance) };
    }

    const updated = await client.marketingWallet.update({
      where: { id: wallet.id },
      data: {
        balance: { decrement: amount },
        lifetimeSpent: { increment: amount },
      },
    });

    const transaction = await client.marketingWalletTransactions.create({
      data: {
        walletId: wallet.id,
        type: MARKETINGTRANSACTIONTYPE.AD_SPEND,
        amount,
        balanceAfter: updated.balance,
        adId,
        description: description || 'Ad impression / click spend',
        metadata: metadata ?? undefined,
      },
    });

    return { success: true, wallet: updated, transaction };
  }

  static async getTransactions(
    client: DbClient,
    walletId: string,
    params: { page?: number; limit?: number; type?: MARKETINGTRANSACTIONTYPE },
  ) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.MarketingWalletTransactionsWhereInput = {
      walletId,
      ...(params.type ? { type: params.type } : {}),
    };

    const [items, total] = await Promise.all([
      client.marketingWalletTransactions.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          ad: {
            select: {
              id: true,
              title: true,
              kind: true,
            },
          },
        },
      }),
      client.marketingWalletTransactions.count({ where }),
    ]);

    return buildPage(items, total, { page, limit });
  }
}
