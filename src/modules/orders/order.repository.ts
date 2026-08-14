import { Prisma, ORDERSTATUS } from '@prisma/client';
import { prisma } from '../../utils/prisma';

export interface StoreOrdersPageQuery {
  status?: ORDERSTATUS;
  search?: string;
  sortOrder?: 'asc' | 'desc';
  skip: number;
  take: number;
}

export interface StoreOrderStatsResult {
  totalRevenue: number;
  statusCounts: Record<'ALL' | ORDERSTATUS, number>;
  lowStockCount: number;
}

export default class OrderRepository {
  static async insertOrder(
    data: Prisma.OrdersCreateInput | Prisma.OrdersUncheckedCreateInput,
    tx: Prisma.TransactionClient,
  ) {
    return tx.orders.create({
      data,
      include: {
        orderitems: true,
        payment: true,
      },
    });
  }

  static async getOrderById(orderId: string, tx: Prisma.TransactionClient) {
    return tx.orders.findUnique({
      where: { id: orderId },
      include: { orderitems: true, payment: true },
    });
  }

  static async updateOrderStatus(
    orderId: string,
    orderStatus: ORDERSTATUS,
    paymentStatus?: 'PENDING' | 'COMPLETED' | 'FAILED',
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? prisma;
    return client.orders.update({
      where: { id: orderId },
      data: {
        status: orderStatus,
        completedAt: orderStatus === 'COMPLETED' ? new Date() : undefined,
        ...(paymentStatus && {
          payment: {
            updateMany: {
              where: { orderId: orderId },
              data: { status: paymentStatus },
            },
          },
        }),
      },
      include: { orderitems: true, payment: true },
    });
  }

  static async getOrdersByBuyerId(buyerId: string) {
    const orders = await prisma.orders.findMany({
      where: { buyerId },
      orderBy: { createdAt: 'desc' },
      include: {
        store: { select: { storeName: true } },
        orderitems: true,
      },
    });

    if (orders.length === 0) return [];

    const productIds = orders.flatMap((o) => o.orderitems.map((i) => i.productId));
    const products = await prisma.products.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true },
    });

    const productMap = Object.fromEntries(products.map((p) => [p.id, p.name]));

    return orders.map((o) => ({
      ...o,
      orderitems: o.orderitems.map((item) => ({
        ...item,
        product: { name: item.productName ?? productMap[item.productId] ?? 'Unknown Product' },
      })),
    }));
  }

  static async getOrdersByStoreId(storeId: string) {
    return this.getOrdersByStoreIds([storeId]);
  }

  /**
   * Server-side filtered/searched/sorted/paginated store orders.
   * Filtering by status, text search (order id, customer name, product
   * name/SKU) and date sort all happen in the database — the indexes on
   * [storeId, status] and createdAt keep this cheap.
   */
  static async getStoreOrdersPage(storeIds: string[], query: StoreOrdersPageQuery) {
    if (storeIds.length === 0) return { items: [], total: 0 };

    const term = query.search?.trim();
    const where: Prisma.OrdersWhereInput = {
      storeId: { in: storeIds },
      deletedAt: null,
      ...(query.status && { status: query.status }),
      ...(term && {
        OR: [
          { id: { contains: term, mode: 'insensitive' } },
          { buyer: { displayName: { contains: term, mode: 'insensitive' } } },
          {
            orderitems: {
              some: {
                OR: [
                  { productName: { contains: term, mode: 'insensitive' } },
                  { productSku: { contains: term, mode: 'insensitive' } },
                ],
              },
            },
          },
        ],
      }),
    };

    const [orders, total] = await Promise.all([
      prisma.orders.findMany({
        where,
        orderBy: { createdAt: query.sortOrder === 'asc' ? 'asc' : 'desc' },
        skip: query.skip,
        take: query.take,
        include: {
          store: { select: { storeName: true } },
          buyer: { select: { displayName: true } },
          orderitems: true,
        },
      }),
      prisma.orders.count({ where }),
    ]);

    if (orders.length === 0) return { items: [], total };

    const productIds = orders.flatMap((o) => o.orderitems.map((i) => i.productId));
    const products = await prisma.products.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true },
    });

    const productMap = Object.fromEntries(products.map((p) => [p.id, p.name]));

    const items = orders.map((order) => ({
      ...order,
      orderitems: order.orderitems.map((item) => ({
        ...item,
        product: { name: item.productName ?? productMap[item.productId] ?? 'Unknown Product' },
      })),
    }));

    return { items, total };
  }

  /**
   * Aggregated stats for the seller dashboard / orders board tabs, computed
   * in the database instead of summing the full order history on the client.
   *
   * Revenue rule: gross totalAmount of every order that was not CANCELLED or
   * FAILED (pending and completed sales both count toward "Total sales").
   */
  static async getStoreOrderStats(storeIds: string[]): Promise<StoreOrderStatsResult> {
    const zeroCounts: StoreOrderStatsResult['statusCounts'] = {
      ALL: 0,
      PENDING: 0,
      PROCESSING: 0,
      READY_FOR_PICKUP: 0,
      COMPLETED: 0,
      CANCELLED: 0,
      FAILED: 0,
    };

    if (storeIds.length === 0) {
      return { totalRevenue: 0, statusCounts: zeroCounts, lowStockCount: 0 };
    }

    const baseWhere: Prisma.OrdersWhereInput = {
      storeId: { in: storeIds },
      deletedAt: null,
    };

    const [revenueAgg, grouped, lowStockCount] = await Promise.all([
      prisma.orders.aggregate({
        _sum: { totalAmount: true },
        where: { ...baseWhere, status: { notIn: ['CANCELLED', 'FAILED'] } },
      }),
      prisma.orders.groupBy({
        by: ['status'],
        _count: { _all: true },
        where: baseWhere,
      }),
      // Stock lives on Inventory, not on orders — count active products at or
      // below the low-stock threshold (product-level rows only, not variants).
      prisma.inventory.count({
        where: {
          storeId: { in: storeIds },
          productId: { not: null },
          variantId: null,
          quantityOnHand: { lte: 10 },
          deletedAt: null,
          product: { isActive: true, deletedAt: null },
        },
      }),
    ]);

    const countOf = (status: ORDERSTATUS) =>
      grouped.find((g) => g.status === status)?._count._all ?? 0;

    return {
      totalRevenue: Number(revenueAgg._sum.totalAmount ?? 0),
      statusCounts: {
        ...zeroCounts,
        ALL: grouped.reduce((sum, g) => sum + g._count._all, 0),
        PENDING: countOf('PENDING'),
        PROCESSING: countOf('PROCESSING'),
        READY_FOR_PICKUP: countOf('READY_FOR_PICKUP'),
        COMPLETED: countOf('COMPLETED'),
        CANCELLED: countOf('CANCELLED'),
        FAILED: countOf('FAILED'),
      },
      lowStockCount,
    };
  }

  static async getOrdersByStoreIds(storeIds: string[]) {
    if (storeIds.length === 0) return [];

    const orders = await prisma.orders.findMany({
      where: { storeId: { in: storeIds } },
      orderBy: { createdAt: 'desc' },
      include: {
        store: { select: { storeName: true } },
        buyer: { select: { displayName: true } },
        orderitems: true,
      },
    });

    if (orders.length === 0) return [];

    const productIds = orders.flatMap((o) => o.orderitems.map((i) => i.productId));
    const products = await prisma.products.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true },
    });

    const productMap = Object.fromEntries(products.map((p) => [p.id, p.name]));

    return orders.map((order) => ({
      ...order,
      orderitems: order.orderitems.map((item) => ({
        ...item,
        product: { name: item.productName ?? productMap[item.productId] ?? 'Unknown Product' },
      })),
    }));
  }
}
