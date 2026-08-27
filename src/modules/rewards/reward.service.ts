import {
  Prisma,
  PrismaClient,
  REWARDTRANSACTIONTYPE,
  REWARDDISCOUNTTYPE,
  USERVOUCHERSTATUS,
} from '@prisma/client';
import { prisma } from '../../utils/prisma';
import logger from '../../utils/logger';
import { buildPage, PaginationParams } from '../../helpers/pagination.helper';

type DbClient = Prisma.TransactionClient | PrismaClient;

export const DEFAULT_EARN_PERCENTAGE = 0.001;
export const DEFAULT_POINT_VALUE_PHP = 0.1;
const DEFAULT_EXPIRATION_MONTHS = 12;

function addMonths(date: Date, months: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export interface UpdateRewardConfigInput {
  earnPercentage?: number;
  pointValueInPhp?: number;
  expirationMonths?: number;
  isEarningActive?: boolean;
  changeReason?: string;
}

export interface CreateVoucherInput {
  title: string;
  description?: string;
  pointCost: number;
  discountType: REWARDDISCOUNTTYPE;
  discountValue: number;
  minOrderAmount?: number;
  maxDiscountAmount?: number;
  validityDays?: number;
  totalStock?: number;
  isActive?: boolean;
}

/**
 * MapPoints — buyer loyalty points and voucher catalog. See
 * docs/specs/MAP_POINTS_FEATURE_SPEC.md and docs/specs/OPEN-FLAGS.md
 * (F39-F54) for the design history behind the choices here.
 */
export default class RewardService {
  private static warnedNoConfiguration = false;
  private static warnNoConfiguration() {
    if (this.warnedNoConfiguration) return;
    this.warnedNoConfiguration = true;
    logger.warn(
      '[Rewards] No active RewardConfigurations row. Falling back to built-in defaults: ' +
        '0.1% earn rate, 1 point = ₱0.10, 12-month expiry.',
    );
  }

  static async getActiveConfig(client: DbClient = prisma) {
    const config = await client.rewardConfigurations.findFirst({
      where: { isActive: true },
      orderBy: { version: 'desc' },
    });
    if (!config) this.warnNoConfiguration();
    return config;
  }

  private static async resolveConfig(client: DbClient) {
    const config = await this.getActiveConfig(client);
    return {
      earnPercentage: config ? Number(config.earnPercentage) : DEFAULT_EARN_PERCENTAGE,
      pointValueInPhp: config ? Number(config.pointValueInPhp) : DEFAULT_POINT_VALUE_PHP,
      expirationMonths: config ? config.expirationMonths : DEFAULT_EXPIRATION_MONTHS,
      isEarningActive: config ? config.isEarningActive : true,
    };
  }

  static async getOrCreateWallet(client: DbClient, buyerId: string) {
    const existing = await client.rewardWallet.findUnique({ where: { buyerId } });
    if (existing) return existing;
    return client.rewardWallet.create({ data: { buyerId } });
  }

  /**
   * Credits MapPoints for a completed order. Idempotent per orderId — a
   * retried completion transaction cannot double-credit. Call inside the
   * same transaction as OrderService.completeOrder, right after the
   * settlement is booked. Points on the eligible net goods subtotal only
   * (subtotal - discount), same base the platform's other ledgers use.
   * Proportional to spend (rounded to the nearest whole point) — not floored
   * to a fixed-₱ block, so there is no minimum-spend cliff. Amounts under
   * about half a point's worth still round to zero; that's the rate being
   * too fine-grained for the purchase, not a bug.
   */
  static async awardPointsForCompletedOrder(client: DbClient, orderId: string) {
    const existing = await client.rewardTransactions.findFirst({
      where: { orderId, type: REWARDTRANSACTIONTYPE.EARN },
    });
    if (existing) return existing;

    const order = await client.orders.findUnique({ where: { id: orderId } });
    if (!order) throw { status: 404, message: `Order not found: ${orderId}` };

    const config = await this.resolveConfig(client);
    if (!config.isEarningActive) return null;

    const eligibleBase = Math.max(0, Number(order.subtotalAmount) - Number(order.discountAmount));
    const pointsValuePhp = eligibleBase * config.earnPercentage;
    const points = Math.round(pointsValuePhp / config.pointValueInPhp);
    if (points <= 0) return null;

    const wallet = await this.getOrCreateWallet(client, order.buyerId);

    const updated = await client.rewardWallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: points }, lifetimeEarned: { increment: points } },
    });

    return client.rewardTransactions.create({
      data: {
        walletId: wallet.id,
        type: REWARDTRANSACTIONTYPE.EARN,
        amount: points,
        balanceAfter: updated.balance,
        orderId,
        referenceKey: `EARN:ORDER:${orderId}`,
        source: 'purchase',
        expiresAt: addMonths(new Date(), config.expirationMonths),
      },
    });
  }

  static async getWallet(buyerId: string) {
    const wallet = await this.getOrCreateWallet(prisma, buyerId);
    const config = await this.resolveConfig(prisma);
    return {
      balance: wallet.balance,
      estimatedValuePhp: Number((wallet.balance * config.pointValueInPhp).toFixed(2)),
      lifetimeEarned: wallet.lifetimeEarned,
      lifetimeSpent: wallet.lifetimeSpent,
    };
  }

  static async getTransactions(buyerId: string, params: PaginationParams) {
    const wallet = await this.getOrCreateWallet(prisma, buyerId);
    const type = params.filters?.type as REWARDTRANSACTIONTYPE | undefined;
    const where: Prisma.RewardTransactionsWhereInput = {
      walletId: wallet.id,
      ...(type ? { type } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.rewardTransactions.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.limit,
      }),
      prisma.rewardTransactions.count({ where }),
    ]);

    return buildPage(items, total, params);
  }

  /** Active, in-stock vouchers. Catalog is admin-curated and small, so the
   * stock filter is a plain in-memory pass rather than a raw SQL column
   * comparison. */
  static async listVoucherCatalog() {
    const vouchers = await prisma.rewardVouchers.findMany({
      where: { isActive: true },
      orderBy: { pointCost: 'asc' },
    });
    return vouchers.filter((v) => v.totalStock === null || v.claimedCount < v.totalStock);
  }

  static async getMyVouchers(buyerId: string, status?: USERVOUCHERSTATUS) {
    return prisma.userVouchers.findMany({
      where: { buyerId, ...(status ? { status } : {}) },
      include: { voucher: true },
      orderBy: { claimedAt: 'desc' },
    });
  }

  /**
   * Spend points to claim a voucher. The wallet decrement is a conditional
   * `updateMany` (`WHERE balance >= cost`) so two concurrent claims against a
   * wallet that can only afford one leave exactly one winner — see F49 in
   * OPEN-FLAGS.md. Stock-limit enforcement is a simpler, non-money-safety
   * optimistic increment; a hard cap under heavy concurrency would need a raw
   * `claimedCount < totalStock` comparison, upgradable later if a real promo
   * needs it.
   */
  static async claimVoucher(buyerId: string, voucherId: string) {
    return prisma.$transaction(async (tx) => {
      const voucher = await tx.rewardVouchers.findUnique({ where: { id: voucherId } });
      if (!voucher || !voucher.isActive) {
        throw { status: 404, message: 'Voucher not found.' };
      }
      if (voucher.totalStock !== null && voucher.claimedCount >= voucher.totalStock) {
        throw { status: 400, message: 'This voucher is out of stock.' };
      }

      const wallet = await this.getOrCreateWallet(tx, buyerId);

      const decremented = await tx.rewardWallet.updateMany({
        where: { id: wallet.id, balance: { gte: voucher.pointCost } },
        data: { balance: { decrement: voucher.pointCost }, lifetimeSpent: { increment: voucher.pointCost } },
      });
      if (decremented.count === 0) {
        throw { status: 400, message: 'Insufficient MapPoints balance.' };
      }

      await tx.rewardVouchers.update({
        where: { id: voucherId },
        data: { claimedCount: { increment: 1 } },
      });

      const updatedWallet = await tx.rewardWallet.findUniqueOrThrow({ where: { id: wallet.id } });
      const userVoucher = await tx.userVouchers.create({
        data: {
          buyerId,
          voucherId,
          pointsSpent: voucher.pointCost,
          expiresAt: addDays(new Date(), voucher.validityDays),
        },
      });

      await tx.rewardTransactions.create({
        data: {
          walletId: wallet.id,
          type: REWARDTRANSACTIONTYPE.SPEND,
          amount: -voucher.pointCost,
          balanceAfter: updatedWallet.balance,
          userVoucherId: userVoucher.id,
          referenceKey: `SPEND:VOUCHER:${userVoucher.id}`,
          source: 'voucher_claim',
          description: voucher.title,
        },
      });

      return userVoucher;
    });
  }

  /**
   * Validates a claimed voucher against the buyer and the order being
   * checked out, and resolves the discount amount it's worth. Read-only —
   * does not mark it used. Called from OrderService.createOrder before
   * pricing is calculated.
   */
  static async validateVoucherForOrder(
    client: DbClient,
    buyerId: string,
    userVoucherId: string,
    eligibleOrderSubtotal: number,
  ) {
    const userVoucher = await client.userVouchers.findUnique({
      where: { id: userVoucherId },
      include: { voucher: true },
    });

    if (!userVoucher || userVoucher.buyerId !== buyerId) {
      throw { status: 404, message: 'Voucher not found.' };
    }
    if (userVoucher.status !== USERVOUCHERSTATUS.ACTIVE) {
      throw { status: 400, message: 'This voucher is no longer active.' };
    }
    if (userVoucher.expiresAt < new Date()) {
      throw { status: 400, message: 'This voucher has expired.' };
    }

    const { voucher } = userVoucher;
    const minOrderAmount = voucher.minOrderAmount ? Number(voucher.minOrderAmount) : 0;
    if (eligibleOrderSubtotal < minOrderAmount) {
      throw {
        status: 400,
        message: `This voucher requires a minimum order of ₱${minOrderAmount.toFixed(2)}.`,
      };
    }

    let discountAmount: number;
    if (voucher.discountType === REWARDDISCOUNTTYPE.FIXED) {
      discountAmount = Number(voucher.discountValue);
    } else {
      discountAmount = eligibleOrderSubtotal * (Number(voucher.discountValue) / 100);
      if (voucher.maxDiscountAmount) {
        discountAmount = Math.min(discountAmount, Number(voucher.maxDiscountAmount));
      }
    }
    discountAmount = Math.min(discountAmount, eligibleOrderSubtotal);

    return { userVoucher, discountAmount: Number(discountAmount.toFixed(2)) };
  }

  /**
   * Flips a claimed voucher ACTIVE -> USED for the order it was just applied
   * to. Conditional `updateMany` so two concurrent checkouts applying the
   * same voucher cannot both succeed — the loser 409s and its order-creation
   * transaction rolls back. Call inside the same transaction as order
   * creation, after the order row exists.
   */
  static async markVoucherUsed(client: DbClient, userVoucherId: string, orderId: string) {
    const result = await client.userVouchers.updateMany({
      where: { id: userVoucherId, status: USERVOUCHERSTATUS.ACTIVE },
      data: { status: USERVOUCHERSTATUS.USED, usedAt: new Date(), orderId },
    });
    if (result.count === 0) {
      throw { status: 409, message: 'Voucher already used or no longer active.' };
    }
  }

  /**
   * Whole-lot point expiry: each EARN row carries its own expiresAt. Full
   * FIFO partial-lot consumption tracking is more than this feature needs at
   * launch (0.1% earn rate, cap "effectively unreachable" per the spec) — the
   * F50 non-negative CHECK constraint catches it loudly if a balance ever
   * goes wrong. Driven by the scheduler; safe to run repeatedly (skips lots
   * already offset by their own EXPIRED row).
   */
  static async expireOldPoints(): Promise<number> {
    const dueLots = await prisma.rewardTransactions.findMany({
      where: { type: REWARDTRANSACTIONTYPE.EARN, expiresAt: { lte: new Date() } },
      select: { id: true, walletId: true, amount: true },
    });
    if (dueLots.length === 0) return 0;

    const offsetKeys = new Set(
      (
        await prisma.rewardTransactions.findMany({
          where: {
            type: REWARDTRANSACTIONTYPE.EXPIRED,
            referenceKey: { in: dueLots.map((lot) => `EXPIRE:EARN:${lot.id}`) },
          },
          select: { referenceKey: true },
        })
      ).map((row) => row.referenceKey),
    );

    let expiredCount = 0;
    for (const lot of dueLots) {
      const referenceKey = `EXPIRE:EARN:${lot.id}`;
      if (offsetKeys.has(referenceKey)) continue;

      const expired = await prisma.$transaction(async (tx) => {
        const wallet = await tx.rewardWallet.findUnique({ where: { id: lot.walletId } });
        if (!wallet) return false;

        const amountToExpire = Math.min(lot.amount, wallet.balance);
        if (amountToExpire <= 0) return false;

        const updated = await tx.rewardWallet.update({
          where: { id: wallet.id },
          data: { balance: { decrement: amountToExpire } },
        });

        await tx.rewardTransactions.create({
          data: {
            walletId: wallet.id,
            type: REWARDTRANSACTIONTYPE.EXPIRED,
            amount: -amountToExpire,
            balanceAfter: updated.balance,
            referenceKey,
            source: 'expiry',
          },
        });

        return true;
      });

      if (expired) expiredCount++;
    }

    return expiredCount;
  }

  static async expireStaleVouchers(): Promise<number> {
    const result = await prisma.userVouchers.updateMany({
      where: { status: USERVOUCHERSTATUS.ACTIVE, expiresAt: { lte: new Date() } },
      data: { status: USERVOUCHERSTATUS.EXPIRED },
    });
    return result.count;
  }

  static async updateConfig(adminUserId: string, patch: UpdateRewardConfigInput) {
    return prisma.$transaction(async (tx) => {
      const current = await tx.rewardConfigurations.findFirst({
        where: { isActive: true },
        orderBy: { version: 'desc' },
      });

      await tx.rewardConfigurations.updateMany({
        where: { isActive: true },
        data: { isActive: false, effectiveTo: new Date() },
      });

      return tx.rewardConfigurations.create({
        data: {
          version: (current?.version ?? 0) + 1,
          isActive: true,
          earnPercentage: patch.earnPercentage ?? current?.earnPercentage ?? DEFAULT_EARN_PERCENTAGE,
          pointValueInPhp: patch.pointValueInPhp ?? current?.pointValueInPhp ?? DEFAULT_POINT_VALUE_PHP,
          expirationMonths:
            patch.expirationMonths ?? current?.expirationMonths ?? DEFAULT_EXPIRATION_MONTHS,
          isEarningActive: patch.isEarningActive ?? current?.isEarningActive ?? true,
          updatedById: adminUserId,
          changeReason: patch.changeReason,
        },
      });
    });
  }

  static async listVouchersAdmin() {
    return prisma.rewardVouchers.findMany({ orderBy: { createdAt: 'desc' } });
  }

  static async createVoucher(data: CreateVoucherInput) {
    return prisma.rewardVouchers.create({ data });
  }

  static async updateVoucher(id: string, data: Partial<CreateVoucherInput>) {
    return prisma.rewardVouchers.update({ where: { id }, data });
  }
}
