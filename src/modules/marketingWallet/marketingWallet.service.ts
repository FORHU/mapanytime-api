import { MARKETINGTRANSACTIONTYPE, Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import MarketingWalletRepository from './marketingWallet.repository';
import { resolveOrgContext } from '../organization/orgContext';
import type { AuthUser } from '../auth/auth.repository';

export default class MarketingWalletService {
  /**
   * Resolves the seller/organization ID for the authenticated user.
   */
  static resolveSellerId(user: AuthUser): string {
    const orgContext = resolveOrgContext(user);
    const sellerId = orgContext.organizationId || user.seller?.id;
    if (!sellerId) {
      throw { status: 403, message: 'Only sellers can access marketing wallet.' };
    }
    return sellerId;
  }

  /**
   * Get marketing wallet overview and balance.
   */
  static async getWallet(user: AuthUser) {
    const sellerId = this.resolveSellerId(user);
    const wallet = await MarketingWalletRepository.getWalletBySellerId(prisma, sellerId);
    return {
      id: wallet.id,
      sellerId: wallet.sellerId,
      balance: Number(wallet.balance),
      lifetimeDeposited: Number(wallet.lifetimeDeposited),
      lifetimeSpent: Number(wallet.lifetimeSpent),
      currency: wallet.currency,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    };
  }

  /**
   * Deposit marketing funds into the wallet.
   */
  static async deposit(
    user: AuthUser,
    amount: number,
    referenceKey?: string,
    description?: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    const sellerId = this.resolveSellerId(user);
    const result = await MarketingWalletRepository.deposit(prisma, {
      sellerId,
      amount,
      referenceKey,
      description,
      metadata,
    });

    return {
      wallet: {
        id: result.wallet.id,
        sellerId: result.wallet.sellerId,
        balance: Number(result.wallet.balance),
        lifetimeDeposited: Number(result.wallet.lifetimeDeposited),
        lifetimeSpent: Number(result.wallet.lifetimeSpent),
        currency: result.wallet.currency,
      },
      transaction: {
        id: result.transaction.id,
        type: result.transaction.type,
        amount: Number(result.transaction.amount),
        balanceAfter: Number(result.transaction.balanceAfter),
        referenceKey: result.transaction.referenceKey,
        description: result.transaction.description,
        createdAt: result.transaction.createdAt,
      },
    };
  }

  /**
   * Deduct ad spend for an ad event.
   * Can be called directly or within an ongoing transaction.
   */
  static async deductAdSpend(
    sellerId: string,
    adId: string,
    amount: number,
    description?: string,
    metadata?: Prisma.InputJsonValue,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || prisma;
    return MarketingWalletRepository.deductSpend(client, {
      sellerId,
      adId,
      amount,
      description,
      metadata,
    });
  }

  /**
   * Get transaction history for the seller's marketing wallet.
   */
  static async getTransactions(
    user: AuthUser,
    params: { page?: number; limit?: number; type?: MARKETINGTRANSACTIONTYPE },
  ) {
    const sellerId = this.resolveSellerId(user);
    const wallet = await MarketingWalletRepository.getWalletBySellerId(prisma, sellerId);
    return MarketingWalletRepository.getTransactions(prisma, wallet.id, params);
  }
}
