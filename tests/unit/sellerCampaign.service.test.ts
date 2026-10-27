import { Prisma, SELLERCAMPAIGNTYPE, CAMPAIGNSTATUS, REWARDTRANSACTIONTYPE } from '@prisma/client';
import SellerCampaignService from '../../src/modules/sellerCampaigns/sellerCampaign.service';
import { prisma } from '../../src/utils/prisma';
import RewardService from '../../src/modules/rewards/reward.service';
import type { AuthUser } from '../../src/modules/auth/auth.repository';

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    sellerCampaigns: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    sellerCampaignTransactions: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    stores: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('../../src/modules/rewards/reward.service');

const mockPrisma = prisma as unknown as {
  sellerCampaigns: {
    create: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
  };
  sellerCampaignTransactions: {
    create: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    count: jest.Mock;
    aggregate: jest.Mock;
  };
  stores: {
    findFirst: jest.Mock;
  };
};

const mockUser = {
  id: 'usr-seller-1',
  email: 'seller@example.com',
  seller: {
    id: 'seller-1',
  },
  orgMemberships: [],
} as unknown as AuthUser;

describe('SellerCampaignService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createCampaign', () => {
    it('creates a campaign with valid inputs', async () => {
      const startDate = new Date(Date.now() - 1000);
      const endDate = new Date(Date.now() + 86400000);

      mockPrisma.sellerCampaigns.create.mockResolvedValue({
        id: 'camp-1',
        sellerId: 'seller-1',
        name: 'Summer Bonus Points',
        type: SELLERCAMPAIGNTYPE.BONUS_POINTS,
        status: CAMPAIGNSTATUS.ACTIVE,
        budgetAmount: new Prisma.Decimal(500),
        spentAmount: new Prisma.Decimal(0),
        bonusPoints: 20,
      });

      const result = await SellerCampaignService.createCampaign(mockUser, {
        name: 'Summer Bonus Points',
        startDate,
        endDate,
        budgetAmount: 500,
        bonusPoints: 20,
      });

      expect(result.id).toBe('camp-1');
      expect(mockPrisma.sellerCampaigns.create).toHaveBeenCalled();
    });

    it('rejects if endDate is before startDate', async () => {
      await expect(
        SellerCampaignService.createCampaign(mockUser, {
          name: 'Invalid Date Campaign',
          startDate: new Date('2026-10-30'),
          endDate: new Date('2026-10-20'),
          budgetAmount: 100,
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('rejects if store does not belong to seller', async () => {
      mockPrisma.stores.findFirst.mockResolvedValue(null);

      await expect(
        SellerCampaignService.createCampaign(mockUser, {
          name: 'Store Campaign',
          storeId: 'store-foreign',
          startDate: new Date('2026-10-20'),
          endDate: new Date('2026-10-30'),
          budgetAmount: 100,
        }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('getCampaigns', () => {
    it('returns paginated campaigns with remaining budget calculated', async () => {
      mockPrisma.sellerCampaigns.findMany.mockResolvedValue([
        {
          id: 'camp-1',
          name: 'Camp 1',
          budgetAmount: new Prisma.Decimal(1000),
          spentAmount: new Prisma.Decimal(250),
          minOrderAmount: new Prisma.Decimal(50),
          _count: { transactions: 5 },
        },
      ]);
      mockPrisma.sellerCampaigns.count.mockResolvedValue(1);

      const res = await SellerCampaignService.getCampaigns(mockUser, { page: 1, limit: 10 });
      expect(res.items.length).toBe(1);
      expect(res.items[0].remainingBudget).toBe(750);
      expect(res.items[0].totalTransactions).toBe(5);
    });
  });

  describe('getCampaignById', () => {
    it('returns campaign details and ROI metrics', async () => {
      mockPrisma.sellerCampaigns.findFirst.mockResolvedValue({
        id: 'camp-1',
        sellerId: 'seller-1',
        name: 'Camp 1',
        budgetAmount: new Prisma.Decimal(500),
        spentAmount: new Prisma.Decimal(100),
      });

      mockPrisma.sellerCampaignTransactions.aggregate.mockResolvedValue({
        _count: { id: 10 },
        _sum: { pointsGranted: 1000, sellerCost: new Prisma.Decimal(100) },
      });

      const res = await SellerCampaignService.getCampaignById(mockUser, 'camp-1');
      expect(res.remainingBudget).toBe(400);
      expect(res.roiMetrics.totalOrdersRewarded).toBe(10);
      expect(res.roiMetrics.totalPointsGranted).toBe(1000);
      expect(res.roiMetrics.budgetUtilizationPercent).toBe(20);
    });
  });

  describe('updateCampaign', () => {
    it('updates campaign and reactivates if budget topped up', async () => {
      mockPrisma.sellerCampaigns.findFirst.mockResolvedValue({
        id: 'camp-1',
        sellerId: 'seller-1',
        startDate: new Date(Date.now() - 10000),
        endDate: new Date(Date.now() + 100000),
        budgetAmount: new Prisma.Decimal(100),
        spentAmount: new Prisma.Decimal(100),
        status: CAMPAIGNSTATUS.EXHAUSTED,
      });

      mockPrisma.sellerCampaigns.update.mockResolvedValue({
        id: 'camp-1',
        budgetAmount: new Prisma.Decimal(300),
        spentAmount: new Prisma.Decimal(100),
        status: CAMPAIGNSTATUS.ACTIVE,
      });

      const res = await SellerCampaignService.updateCampaign(mockUser, 'camp-1', {
        addBudgetAmount: 200,
      });

      expect(res.budgetAmount).toBe(300);
      expect(res.remainingBudget).toBe(200);
      expect(mockPrisma.sellerCampaigns.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: CAMPAIGNSTATUS.ACTIVE,
          }),
        }),
      );
    });
  });

  describe('processOrderCampaignIncentive', () => {
    const mockTx = {
      sellerCampaignTransactions: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      orders: {
        findUnique: jest.fn(),
      },
      sellerCampaigns: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
      rewardWallet: {
        update: jest.fn(),
      },
      rewardTransactions: {
        create: jest.fn(),
      },
    } as unknown as Prisma.TransactionClient;

    it('returns existing transaction if order was already processed (idempotency)', async () => {
      (mockTx.sellerCampaignTransactions.findFirst as jest.Mock).mockResolvedValue({
        id: 'tx-existing',
        orderId: 'ord-1',
      });

      const res = await SellerCampaignService.processOrderCampaignIncentive(mockTx, 'ord-1');
      expect(res).toEqual({ id: 'tx-existing', orderId: 'ord-1' });
      expect(mockTx.orders.findUnique).not.toHaveBeenCalled();
    });

    it('awards bonus points, deducts budget, and updates buyer wallet', async () => {
      (mockTx.sellerCampaignTransactions.findFirst as jest.Mock).mockResolvedValue(null);
      (mockTx.orders.findUnique as jest.Mock).mockResolvedValue({
        id: 'ord-1',
        buyerId: 'buyer-1',
        storeId: 'store-1',
        subtotalAmount: new Prisma.Decimal(1000),
        discountAmount: new Prisma.Decimal(0),
        store: { sellerId: 'seller-1' },
      });

      (mockTx.sellerCampaigns.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'camp-1',
          sellerId: 'seller-1',
          storeId: 'store-1',
          type: SELLERCAMPAIGNTYPE.BONUS_POINTS,
          status: CAMPAIGNSTATUS.ACTIVE,
          budgetAmount: new Prisma.Decimal(500),
          spentAmount: new Prisma.Decimal(0),
          bonusPoints: 50,
        },
      ]);

      (RewardService.getActiveConfig as jest.Mock).mockResolvedValue({
        pointValueInPhp: 0.1,
        earnPercentage: 0.001,
        expirationMonths: 12,
      });

      (mockTx.sellerCampaignTransactions.create as jest.Mock).mockResolvedValue({
        id: 'camp-tx-1',
        pointsGranted: 50,
        sellerCost: new Prisma.Decimal(5),
      });

      (RewardService.getOrCreateWallet as jest.Mock).mockResolvedValue({
        id: 'wallet-1',
        balance: 10,
      });
      (mockTx.rewardWallet.update as jest.Mock).mockResolvedValue({ id: 'wallet-1', balance: 60 });

      const res = await SellerCampaignService.processOrderCampaignIncentive(mockTx, 'ord-1');

      expect(res).toBeDefined();
      expect(mockTx.sellerCampaigns.update).toHaveBeenCalledWith({
        where: { id: 'camp-1' },
        data: {
          spentAmount: { increment: new Prisma.Decimal(5) },
        },
      });

      expect(mockTx.rewardTransactions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: REWARDTRANSACTIONTYPE.BONUS,
            amount: 50,
            orderId: 'ord-1',
          }),
        }),
      );
    });

    it('clamps points when cost would exceed remaining budget and marks EXHAUSTED', async () => {
      (mockTx.sellerCampaignTransactions.findFirst as jest.Mock).mockResolvedValue(null);
      (mockTx.orders.findUnique as jest.Mock).mockResolvedValue({
        id: 'ord-2',
        buyerId: 'buyer-1',
        storeId: 'store-1',
        subtotalAmount: new Prisma.Decimal(500),
        discountAmount: new Prisma.Decimal(0),
        store: { sellerId: 'seller-1' },
      });

      (mockTx.sellerCampaigns.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'camp-1',
          sellerId: 'seller-1',
          type: SELLERCAMPAIGNTYPE.BONUS_POINTS,
          status: CAMPAIGNSTATUS.ACTIVE,
          budgetAmount: new Prisma.Decimal(10),
          spentAmount: new Prisma.Decimal(8), // only ₱2 remaining = 20 points
          bonusPoints: 50, // asks for 50 points = ₱5
        },
      ]);

      (RewardService.getActiveConfig as jest.Mock).mockResolvedValue({
        pointValueInPhp: 0.1,
        earnPercentage: 0.001,
        expirationMonths: 12,
      });

      (mockTx.sellerCampaignTransactions.create as jest.Mock).mockResolvedValue({
        id: 'camp-tx-2',
        pointsGranted: 20,
        sellerCost: new Prisma.Decimal(2),
      });

      (RewardService.getOrCreateWallet as jest.Mock).mockResolvedValue({
        id: 'wallet-1',
        balance: 0,
      });
      (mockTx.rewardWallet.update as jest.Mock).mockResolvedValue({ id: 'wallet-1', balance: 20 });

      await SellerCampaignService.processOrderCampaignIncentive(mockTx, 'ord-2');

      expect(mockTx.sellerCampaigns.update).toHaveBeenCalledWith({
        where: { id: 'camp-1' },
        data: {
          spentAmount: { increment: new Prisma.Decimal(2) },
          status: CAMPAIGNSTATUS.EXHAUSTED,
        },
      });
    });
  });
});
