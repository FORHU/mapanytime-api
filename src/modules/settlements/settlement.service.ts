import { prisma } from '../../utils/prisma';
import { Prisma, PrismaClient, SETTLEMENTSTATUS } from '@prisma/client';
import logger from '../../utils/logger';

type DbClient = Prisma.TransactionClient | PrismaClient;

/**
 * How long a completed order's money is held before the seller can be paid.
 *
 * The hold exists to cover the return window: once a settlement is `RELEASED`
 * it can be swept into a payout, and money that has left the platform cannot be
 * clawed back to fund a refund. Tunable per environment; keep it at or above
 * the return window.
 */
export const SETTLEMENT_HOLD_DAYS = Number(process.env.SETTLEMENT_HOLD_DAYS ?? 7);

export default class SettlementService {
  /**
   * Record what the platform owes the seller for a completed order.
   *
   * Nothing wrote `Settlements` before this existed, so `PayoutService`'s
   * filter on `RELEASED` settlements matched nothing and no seller could ever
   * be paid. See FLAGS.md LED-3/LED-4/LED-5.
   *
   * Idempotent on `orderId` (unique), so a retried completion cannot double-pay
   * a seller. Call inside the completing transaction: a settlement that exists
   * for an order that then failed to complete would be a phantom debt.
   */
  static async createForCompletedOrder(client: DbClient, orderId: string) {
    const order = await client.orders.findUnique({
      where: { id: orderId },
      include: {
        store: { select: { sellerId: true } },
        payment: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { paymentMethod: { select: { type: true } } },
        },
      },
    });

    if (!order) throw { status: 404, message: `Order not found: ${orderId}` };

    const existing = await client.settlements.findUnique({ where: { orderId } });
    if (existing) return existing;

    const payment = order.payment[0];
    const isCash = payment?.paymentMethod?.type === 'CASH';

    const subtotal = Number(order.subtotalAmount);
    const discount = Number(order.discountAmount);
    const commission = Number(order.sellerMarketplaceFeeAmount);
    const sellerNet = Number(order.sellerNetAmount);

    // What the seller sold, net of discount — the base the platform's
    // deductions come out of. This is the engine's `orderAmount`: the buyer's
    // total less the buyer transaction fee.
    const settlementBase = Math.max(0, subtotal - discount);

    // The seller's share of the gateway cost, derived from the same arithmetic
    // the engine used rather than re-encoding the payer-policy table in a
    // second place, where the two could silently drift apart. Under the `BUYER`
    // policy this is zero, which is every order today.
    const paymentFee = Number(Math.max(0, settlementBase - commission - sellerNet).toFixed(2));

    const releaseEligibleAt = new Date(
      (order.completedAt ?? new Date()).getTime() + SETTLEMENT_HOLD_DAYS * 24 * 60 * 60 * 1000,
    );

    // Cash at the stall runs the other way round. The platform never held the
    // money — the seller took it directly — so there is no net to pay out;
    // what exists is the commission the seller now owes us. Booked as a
    // negative settlement so it is netted off their next gateway-funded
    // payout, rather than needing an invoice and a collection process.
    // Settled 2026-08-20; see FIX-PLAN.md item 3.
    //
    // A refund closes it out for free: `markRefundedForOrder` takes the row out
    // of REFUNDED settlements, and no commission is owed on a sale that came
    // back. That is why cash debits observe the same hold as everything else.
    const netAmount = isCash ? -commission : sellerNet;

    if (isCash) {
      logger.info(
        `[Settlement] Order ${orderId} settled in cash at the stall. Booking a ` +
          `₱${commission.toFixed(2)} commission debit against seller ${order.store.sellerId}; ` +
          'it nets off their next payout.',
      );
    }

    return client.settlements.create({
      data: {
        orderId,
        sellerId: order.store.sellerId,
        subtotalAmount: settlementBase,
        commissionAmount: commission,
        paymentFeeAmount: isCash ? 0 : paymentFee,
        sellerNetAmount: netAmount,
        status: 'PENDING',
        releaseEligibleAt,
      },
    });
  }

  /**
   * Mature every settlement whose hold has elapsed, so it becomes payable.
   *
   * Skips any order with a live return request: releasing one would let the
   * money be swept into a payout while the buyer is still owed a refund.
   * Driven by the scheduler; safe to run repeatedly.
   */
  static async releaseMaturedSettlements(): Promise<number> {
    const due = await prisma.settlements.findMany({
      where: {
        status: { in: ['PENDING', 'HELD'] },
        releaseEligibleAt: { lte: new Date() },
        order: {
          status: 'COMPLETED',
          returnRequests: {
            none: { status: { in: ['PENDING', 'APPROVED', 'ITEM_RECEIVED'] } },
          },
        },
      },
      select: { id: true },
    });

    if (due.length === 0) return 0;

    const result = await prisma.settlements.updateMany({
      where: { id: { in: due.map((s) => s.id) }, status: { in: ['PENDING', 'HELD'] } },
      data: { status: 'RELEASED', settledAt: new Date() },
    });

    return result.count;
  }

  /**
   * Put a settlement beyond reach of a payout while a return is open. `HELD` is
   * reversible — `releaseMaturedSettlements` picks it back up once the return
   * closes and the hold has elapsed.
   */
  static async holdForOrder(client: DbClient, orderId: string) {
    return client.settlements.updateMany({
      where: { orderId, status: { in: ['PENDING', 'RELEASED'] } },
      data: { status: 'HELD' },
    });
  }

  /**
   * Mark a settlement refunded once the money has gone back to the buyer.
   * Only meaningful while it has not been paid out — after that the platform is
   * out of pocket and recovery is a manual matter.
   */
  static async markRefundedForOrder(client: DbClient, orderId: string) {
    return client.settlements.updateMany({
      where: { orderId },
      data: { status: 'REFUNDED', settledAt: new Date() },
    });
  }

  static async getSettlementsBySeller(sellerId: string) {
    return prisma.settlements.findMany({
      where: { sellerId },
      include: {
        order: { select: { id: true, totalAmount: true, completedAt: true } },
        payoutItem: { include: { payout: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * What a seller can actually be paid right now, and what is still maturing.
   * Backs the seller earnings view, and tells an admin what a payout run would
   * sweep before they run it.
   */
  static async getSellerBalance(sellerId: string) {
    const settlements = await prisma.settlements.findMany({
      where: { sellerId },
      include: { payoutItem: { select: { id: true } } },
    });

    const sum = (rows: typeof settlements) =>
      Number(rows.reduce((total, s) => total + Number(s.sellerNetAmount), 0).toFixed(2));

    const unpaid = settlements.filter((s) => !s.payoutItem);

    // Cash sales carry a negative net — commission the seller owes us. Shown on
    // its own so a seller can see why their payout is smaller than their sales,
    // rather than finding an unexplained deduction.
    const cashCommissionOwed = Number(
      Math.abs(
        unpaid
          .filter((s) => Number(s.sellerNetAmount) < 0)
          .reduce((t, s) => t + Number(s.sellerNetAmount), 0),
      ).toFixed(2),
    );

    return {
      pendingAmount: sum(unpaid.filter((s) => s.status === 'PENDING')),
      heldAmount: sum(unpaid.filter((s) => s.status === 'HELD')),
      availableAmount: sum(unpaid.filter((s) => s.status === 'RELEASED')),
      cashCommissionOwed,
      paidOutAmount: sum(settlements.filter((s) => s.payoutItem)),
      refundedAmount: sum(settlements.filter((s) => s.status === 'REFUNDED')),
      settlementCount: settlements.length,
      holdDays: SETTLEMENT_HOLD_DAYS,
    };
  }

  static async getSettlementByOrder(orderId: string) {
    return prisma.settlements.findUnique({
      where: { orderId },
      include: {
        order: true,
        seller: { select: { id: true, userId: true } },
      },
    });
  }

  static async updateSettlementStatus(id: string, status: SETTLEMENTSTATUS) {
    const settlement = await prisma.settlements.findUnique({
      where: { id },
      include: { payoutItem: { select: { id: true } } },
    });

    if (!settlement) throw { status: 404, message: 'Settlement not found.' };

    // Once a settlement sits inside a payout the money is gone. Letting an
    // admin walk it back to PENDING would leave the ledger claiming the
    // platform still owes what it has already sent.
    if (settlement.payoutItem) {
      throw {
        status: 409,
        message: 'This settlement has already been paid out and can no longer be changed.',
      };
    }

    return prisma.settlements.update({
      where: { id },
      data: {
        status,
        ...(status === 'RELEASED' ? { settledAt: new Date() } : {}),
      },
    });
  }
}
