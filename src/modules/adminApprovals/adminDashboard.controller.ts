import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../utils/prisma';

/** How many months of history the revenue/orders trend chart shows. */
const TREND_MONTHS = 6;

/**
 * Start of the month `monthsAgo` months back, in server-local time. Used as the
 * lower bound of each trend bucket.
 */
function startOfMonth(monthsAgo: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  d.setMonth(d.getMonth() - monthsAgo);
  return d;
}

export default class AdminDashboardController {
  static async getDashboardMetrics(req: Request, res: Response, next: NextFunction) {
    try {
      const trendStart = startOfMonth(TREND_MONTHS - 1);

      const [
        totalBuyers,
        totalSellers,
        verifiedStores,
        pendingStoresCount,
        revenueAggregate,
        completedOrderCount,
        trendOrders,
      ] = await Promise.all([
        prisma.buyers.count(),
        prisma.sellers.count(),
        prisma.stores.count({ where: { approvalStatus: 'ACTIVE' } }),
        prisma.stores.count({ where: { approvalStatus: 'PENDING' } }),
        // Summed in the database rather than by loading every completed order
        // into memory and reducing. See docs/payments-rework-review.md §13.
        prisma.orders.aggregate({
          where: { status: 'COMPLETED' },
          _sum: { totalAmount: true },
        }),
        prisma.orders.count({ where: { status: 'COMPLETED' } }),
        // Only the trend window is pulled row-by-row, and only the two fields
        // the buckets need.
        prisma.orders.findMany({
          where: { status: 'COMPLETED', completedAt: { gte: trendStart } },
          select: { completedAt: true, totalAmount: true },
        }),
      ]);

      const totalRevenue = Number(revenueAggregate._sum.totalAmount ?? 0);

      // Real month buckets, oldest first. Months with no orders still appear, so
      // the chart shows a gap rather than silently compressing the axis.
      const chartData = Array.from({ length: TREND_MONTHS }, (_, i) => {
        const bucketStart = startOfMonth(TREND_MONTHS - 1 - i);
        const bucketEnd = startOfMonth(TREND_MONTHS - 2 - i);
        const inBucket = trendOrders.filter(
          (o) =>
            o.completedAt !== null &&
            o.completedAt >= bucketStart &&
            (i === TREND_MONTHS - 1 || o.completedAt < bucketEnd),
        );

        return {
          month: bucketStart.toLocaleString('en-US', { month: 'short' }),
          revenue: inBucket.reduce((sum, o) => sum + Number(o.totalAmount), 0),
          orders: inBucket.length,
        };
      });

      const pendingStores = await prisma.stores.findMany({
        where: { approvalStatus: 'PENDING' },
        include: {
          primaryCategory: { select: { name: true } },
          seller: {
            include: {
              users: { select: { firstName: true, lastName: true, email: true } },
            },
          },
        },
        take: 5,
        orderBy: { createdAt: 'desc' },
      });

      const recentOrders = await prisma.orders.findMany({
        include: {
          store: { select: { storeName: true } },
          buyer: { select: { displayName: true } },
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
      });

      return res.status(200).json({
        success: true,
        data: {
          kpis: {
            totalRevenue,
            verifiedStores,
            activeUsers: totalBuyers + totalSellers,
            pendingStoreApprovals: pendingStoresCount,
            completedOrders: completedOrderCount,
          },
          pendingStores: pendingStores.map((store) => ({
            id: store.id,
            name: store.storeName,
            owner:
              `${store.seller?.users?.firstName ?? ''} ${store.seller?.users?.lastName ?? ''}`.trim(),
            email: store.seller?.users?.email ?? '',
            category: store.primaryCategory?.name ?? 'Uncategorized',
            date: store.createdAt,
            avatar: store.storeName ? store.storeName.substring(0, 2).toUpperCase() : 'ST',
          })),
          recentOrders: recentOrders.map((order) => ({
            id: order.id,
            store: order.store?.storeName ?? 'Unknown Store',
            buyer: order.buyer?.displayName ?? 'Unknown Buyer',
            amount: Number(order.totalAmount),
            type: order.type,
            status: order.status,
            time: order.createdAt,
          })),
          chartData,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}
