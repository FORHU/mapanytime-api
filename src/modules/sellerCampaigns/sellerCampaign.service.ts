import {
  Prisma,
  PrismaClient,
  SELLERCAMPAIGNTYPE,
  CAMPAIGNSTATUS,
  REWARDTRANSACTIONTYPE,
} from '@prisma/client';
import { prisma } from '../../utils/prisma';
import logger from '../../utils/logger';
import { resolveOrgContext } from '../organization/orgContext';
import type { AuthUser } from '../auth/auth.repository';
import RewardService, {
  DEFAULT_EARN_PERCENTAGE,
  DEFAULT_POINT_VALUE_PHP,
} from '../rewards/reward.service';

type DbClient = Prisma.TransactionClient | PrismaClient;

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export interface CreateCampaignInput {
  name: string;
  storeId?: string | null;
  type?: SELLERCAMPAIGNTYPE;
  startDate: string | Date;
  endDate: string | Date;
  budgetAmount: number;
  bonusPoints?: number;
  maxRewardPoints?: number | null;
  minOrderAmount?: number | null;
}

export interface UpdateCampaignInput {
  name?: string;
  status?: CAMPAIGNSTATUS;
  endDate?: string | Date;
  bonusPoints?: number;
  maxRewardPoints?: number | null;
  minOrderAmount?: number | null;
  addBudgetAmount?: number;
}

export default class SellerCampaignService {
  /**
   * Resolves the seller/organization ID for the authenticated user.
   */
  static resolveSellerId(user: AuthUser): string {
    const orgContext = resolveOrgContext(user);
    const sellerId = orgContext.organizationId || user.seller?.id;
    if (!sellerId) {
      throw { status: 403, message: 'Only sellers can access promotional campaigns.' };
    }
    return sellerId;
  }

  /**
   * Creates a new promotional reward campaign for the seller.
   */
  static async createCampaign(user: AuthUser, data: CreateCampaignInput) {
    const sellerId = this.resolveSellerId(user);

    if (data.storeId) {
      const store = await prisma.stores.findFirst({
        where: { id: data.storeId, sellerId },
      });
      if (!store) {
        throw { status: 404, message: 'Store not found or does not belong to your account.' };
      }
    }

    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    if (end <= start) {
      throw { status: 400, message: 'Campaign end date must be after the start date.' };
    }

    const now = new Date();
    let initialStatus: CAMPAIGNSTATUS = CAMPAIGNSTATUS.DRAFT;
    if (start <= now && now <= end) {
      initialStatus = CAMPAIGNSTATUS.ACTIVE;
    }

    const campaign = await prisma.sellerCampaigns.create({
      data: {
        sellerId,
        storeId: data.storeId || null,
        name: data.name.trim(),
        type: data.type || SELLERCAMPAIGNTYPE.BONUS_POINTS,
        status: initialStatus,
        startDate: start,
        endDate: end,
        budgetAmount: new Prisma.Decimal(data.budgetAmount),
        spentAmount: new Prisma.Decimal(0),
        bonusPoints: data.bonusPoints ?? 10,
        maxRewardPoints: data.maxRewardPoints ?? null,
        minOrderAmount:
          data.minOrderAmount != null ? new Prisma.Decimal(data.minOrderAmount) : null,
      },
    });

    logger.info(
      `[SellerCampaign] Created campaign ${campaign.id} (${campaign.name}) for seller ${sellerId}`,
    );

    return campaign;
  }

  /**
   * List campaigns for the authenticated seller with optional filters.
   */
  static async getCampaigns(
    user: AuthUser,
    params: {
      status?: CAMPAIGNSTATUS;
      storeId?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const sellerId = this.resolveSellerId(user);
    const page = Math.max(1, params.page || 1);
    const limit = Math.max(1, Math.min(100, params.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.SellerCampaignsWhereInput = {
      sellerId,
      ...(params.status ? { status: params.status } : {}),
      ...(params.storeId ? { storeId: params.storeId } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.sellerCampaigns.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          store: {
            select: { id: true, storeName: true },
          },
          _count: {
            select: { transactions: true },
          },
        },
      }),
      prisma.sellerCampaigns.count({ where }),
    ]);

    return {
      items: items.map((c) => ({
        ...c,
        budgetAmount: Number(c.budgetAmount),
        spentAmount: Number(c.spentAmount),
        remainingBudget: Math.max(0, Number(c.budgetAmount) - Number(c.spentAmount)),
        minOrderAmount: c.minOrderAmount ? Number(c.minOrderAmount) : null,
        totalTransactions: c._count.transactions,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get single campaign details including performance/ROI summary.
   */
  static async getCampaignById(user: AuthUser, campaignId: string) {
    const sellerId = this.resolveSellerId(user);

    const campaign = await prisma.sellerCampaigns.findFirst({
      where: { id: campaignId, sellerId },
      include: {
        store: { select: { id: true, storeName: true } },
      },
    });

    if (!campaign) {
      throw { status: 404, message: 'Campaign not found.' };
    }

    const txSummary = await prisma.sellerCampaignTransactions.aggregate({
      where: { campaignId },
      _count: { id: true },
      _sum: { pointsGranted: true, sellerCost: true },
    });

    const budget = Number(campaign.budgetAmount);
    const spent = Number(campaign.spentAmount);

    return {
      ...campaign,
      budgetAmount: budget,
      spentAmount: spent,
      remainingBudget: Math.max(0, budget - spent),
      minOrderAmount: campaign.minOrderAmount ? Number(campaign.minOrderAmount) : null,
      roiMetrics: {
        totalOrdersRewarded: txSummary._count.id,
        totalPointsGranted: txSummary._sum.pointsGranted || 0,
        totalCostPhp: Number(txSummary._sum.sellerCost || 0),
        budgetUtilizationPercent: budget > 0 ? Number(((spent / budget) * 100).toFixed(1)) : 0,
      },
    };
  }

  /**
   * Update an existing campaign (name, status toggle, budget top-up, date extension).
   */
  static async updateCampaign(user: AuthUser, campaignId: string, patch: UpdateCampaignInput) {
    const sellerId = this.resolveSellerId(user);

    const campaign = await prisma.sellerCampaigns.findFirst({
      where: { id: campaignId, sellerId },
    });

    if (!campaign) {
      throw { status: 404, message: 'Campaign not found.' };
    }

    const data: Prisma.SellerCampaignsUpdateInput = {};

    if (patch.name) data.name = patch.name.trim();
    if (patch.status) data.status = patch.status;
    if (patch.bonusPoints !== undefined) data.bonusPoints = patch.bonusPoints;
    if (patch.maxRewardPoints !== undefined) data.maxRewardPoints = patch.maxRewardPoints;
    if (patch.minOrderAmount !== undefined) {
      data.minOrderAmount =
        patch.minOrderAmount != null ? new Prisma.Decimal(patch.minOrderAmount) : null;
    }

    if (patch.endDate) {
      const newEnd = new Date(patch.endDate);
      if (newEnd <= campaign.startDate) {
        throw { status: 400, message: 'End date must be after campaign start date.' };
      }
      data.endDate = newEnd;
    }

    if (patch.addBudgetAmount && patch.addBudgetAmount > 0) {
      const newBudget = Number(campaign.budgetAmount) + patch.addBudgetAmount;
      data.budgetAmount = new Prisma.Decimal(newBudget);

      // If campaign was exhausted but budget was added and still within schedule, reactivate it
      if (
        campaign.status === CAMPAIGNSTATUS.EXHAUSTED &&
        newBudget > Number(campaign.spentAmount)
      ) {
        const now = new Date();
        if (
          now >= campaign.startDate &&
          now <= (data.endDate ? new Date(data.endDate as Date) : campaign.endDate)
        ) {
          data.status = CAMPAIGNSTATUS.ACTIVE;
        }
      }
    }

    const updated = await prisma.sellerCampaigns.update({
      where: { id: campaignId },
      data,
    });

    return {
      ...updated,
      budgetAmount: Number(updated.budgetAmount),
      spentAmount: Number(updated.spentAmount),
      remainingBudget: Math.max(0, Number(updated.budgetAmount) - Number(updated.spentAmount)),
    };
  }

  /**
   * List transaction ledger for a campaign.
   */
  static async getCampaignTransactions(
    user: AuthUser,
    campaignId: string,
    params: { page?: number; limit?: number },
  ) {
    const sellerId = this.resolveSellerId(user);

    const campaign = await prisma.sellerCampaigns.findFirst({
      where: { id: campaignId, sellerId },
    });
    if (!campaign) {
      throw { status: 404, message: 'Campaign not found.' };
    }

    const page = Math.max(1, params.page || 1);
    const limit = Math.max(1, Math.min(100, params.limit || 20));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      prisma.sellerCampaignTransactions.findMany({
        where: { campaignId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.sellerCampaignTransactions.count({ where: { campaignId } }),
    ]);

    return {
      items: items.map((t) => ({
        ...t,
        sellerCost: Number(t.sellerCost),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Evaluates active seller campaigns during order completion and grants promotional
   * bonus reward points to the buyer. Atomic and idempotent per order.
   *
   * Call inside the order completion transaction right after awardPointsForCompletedOrder.
   */
  static async processOrderCampaignIncentive(client: DbClient, orderId: string) {
    // 1. Idempotency check: don't double-grant points if already processed for this order
    const existingTx = await client.sellerCampaignTransactions.findFirst({
      where: { orderId },
    });
    if (existingTx) return existingTx;

    // 2. Fetch order details
    const order = await client.orders.findUnique({
      where: { id: orderId },
      include: {
        store: { select: { sellerId: true } },
      },
    });
    if (!order) return null;

    const sellerId = order.store?.sellerId;
    if (!sellerId) return null;

    const eligibleSubtotal = Math.max(
      0,
      Number(order.subtotalAmount) - Number(order.discountAmount),
    );
    if (eligibleSubtotal <= 0) return null;

    const now = new Date();

    // 3. Find candidate active campaign (store-specific first, fallback to all-stores campaign)
    const campaigns = await client.sellerCampaigns.findMany({
      where: {
        sellerId,
        status: CAMPAIGNSTATUS.ACTIVE,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      orderBy: [{ storeId: 'desc' }, { createdAt: 'asc' }],
    });

    const activeCampaign = campaigns.find((c) => {
      if (c.storeId && c.storeId !== order.storeId) return false;
      if (c.minOrderAmount && eligibleSubtotal < Number(c.minOrderAmount)) return false;
      const remaining = Number(c.budgetAmount) - Number(c.spentAmount);
      return remaining > 0;
    });

    if (!activeCampaign) return null;

    // 4. Resolve reward point value and rate configuration
    const activeConfig = await RewardService.getActiveConfig(client);
    const pointValueInPhp = activeConfig
      ? Number(activeConfig.pointValueInPhp)
      : DEFAULT_POINT_VALUE_PHP;
    const earnPercentage = activeConfig
      ? Number(activeConfig.earnPercentage)
      : DEFAULT_EARN_PERCENTAGE;
    const expirationMonths = activeConfig ? activeConfig.expirationMonths : 12;

    // 5. Calculate bonus points according to campaign type
    let pointsToGrant = 0;
    if (activeCampaign.type === SELLERCAMPAIGNTYPE.DOUBLE_POINTS) {
      // Matches standard base order points
      const basePointsValue = eligibleSubtotal * earnPercentage;
      pointsToGrant = Math.round(basePointsValue / pointValueInPhp);
    } else {
      // BONUS_POINTS or PRODUCT_BOOST
      pointsToGrant = activeCampaign.bonusPoints || 10;
    }

    if (activeCampaign.maxRewardPoints && pointsToGrant > activeCampaign.maxRewardPoints) {
      pointsToGrant = activeCampaign.maxRewardPoints;
    }

    if (pointsToGrant <= 0) return null;

    // 6. Check budget cap
    const remainingBudget =
      Number(activeCampaign.budgetAmount) - Number(activeCampaign.spentAmount);
    let costPhp = Number((pointsToGrant * pointValueInPhp).toFixed(2));

    if (costPhp > remainingBudget) {
      // Clamp points to remaining budget
      pointsToGrant = Math.floor(remainingBudget / pointValueInPhp);
      costPhp = Number((pointsToGrant * pointValueInPhp).toFixed(2));
    }

    if (pointsToGrant <= 0) {
      // Budget cannot afford even 1 point — mark exhausted
      await client.sellerCampaigns.update({
        where: { id: activeCampaign.id },
        data: { status: CAMPAIGNSTATUS.EXHAUSTED },
      });
      return null;
    }

    const newSpent = Number(activeCampaign.spentAmount) + costPhp;
    const isExhausted = newSpent >= Number(activeCampaign.budgetAmount);

    // 7. Update campaign spentAmount and status
    await client.sellerCampaigns.update({
      where: { id: activeCampaign.id },
      data: {
        spentAmount: { increment: new Prisma.Decimal(costPhp) },
        ...(isExhausted ? { status: CAMPAIGNSTATUS.EXHAUSTED } : {}),
      },
    });

    // 8. Record campaign transaction
    const campaignTx = await client.sellerCampaignTransactions.create({
      data: {
        campaignId: activeCampaign.id,
        sellerId: activeCampaign.sellerId,
        buyerId: order.buyerId,
        orderId,
        pointsGranted: pointsToGrant,
        sellerCost: new Prisma.Decimal(costPhp),
        referenceKey: `CAMPAIGN:${activeCampaign.id}:ORDER:${orderId}`,
      },
    });

    // 9. Credit the bonus points to buyer's RewardWallet
    const wallet = await RewardService.getOrCreateWallet(client, order.buyerId);
    const updatedWallet = await client.rewardWallet.update({
      where: { id: wallet.id },
      data: {
        balance: { increment: pointsToGrant },
        lifetimeEarned: { increment: pointsToGrant },
      },
    });

    await client.rewardTransactions.create({
      data: {
        walletId: wallet.id,
        type: REWARDTRANSACTIONTYPE.BONUS,
        amount: pointsToGrant,
        balanceAfter: updatedWallet.balance,
        orderId,
        referenceKey: `BONUS:CAMPAIGN:${activeCampaign.id}:ORDER:${orderId}`,
        source: 'seller_campaign',
        expiresAt: addMonths(new Date(), expirationMonths),
      },
    });

    logger.info(
      `[SellerCampaign] Awarded ${pointsToGrant} bonus points (cost: ₱${costPhp}) for order ${orderId} from campaign ${activeCampaign.id}`,
    );

    return campaignTx;
  }
}
