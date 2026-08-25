import ReturnRepository from './return.repository';
import { PAYMENTSTATUS, Prisma, RETURNSTATUS } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import PaymentService from '../payments/payment.service';
import SettlementService from '../settlements/settlement.service';
import { emitNotificationToUser } from '../../infrastructure/socket';
import logger from '../../utils/logger';
import { ADMIN_ROLES, SystemRole } from '../../constants/roles.constant';

/**
 * Legal return status transitions.
 *
 * `updateReturnStatus` previously accepted any status from the request body, so
 * a return could jump straight from PENDING to REFUNDED — skipping approval and
 * skipping the goods coming back. See FLAGS.md ORD-6.
 */
/**
 * How long after completion a buyer may still open a return.
 *
 * Kept at or below `SETTLEMENT_HOLD_DAYS`, which exists to cover exactly this
 * window: once the hold elapses the settlement is released and can be swept
 * into a payout, and a refund after that comes out of the platform's own
 * pocket with no way to claw it back (OPEN-FLAGS F84).
 *
 * There was no window at all before — any COMPLETED order was returnable
 * forever, which made that overrun the eventual default rather than an edge
 * case. `MASTER_IMPLEMENTATION_PLAN.md` required the window and required it to
 * be configurable; neither had been built. See OPEN-FLAGS F85.
 */
export const RETURN_WINDOW_DAYS = Number(process.env.RETURN_WINDOW_DAYS ?? 7);

const DAY_MS = 24 * 60 * 60 * 1000;

const ALLOWED_RETURN_TRANSITIONS: Record<RETURNSTATUS, RETURNSTATUS[]> = {
  PENDING: [RETURNSTATUS.APPROVED, RETURNSTATUS.REJECTED],
  APPROVED: [RETURNSTATUS.ITEM_RECEIVED, RETURNSTATUS.REJECTED],
  ITEM_RECEIVED: [RETURNSTATUS.REFUNDED],
  REFUNDED: [], // Terminal — the money has gone back
  REJECTED: [], // Terminal
};

export default class ReturnService {
  /**
   * Resolves the `Buyers` row for an authenticated `Users` id. `Orders.buyerId`
   * and `ReturnRequests.buyerId` both reference `Buyers`, never `Users`.
   */
  private static async resolveBuyerId(userId: string) {
    const buyer = await prisma.buyers.findUnique({ where: { userId } });
    if (!buyer) {
      throw { status: 403, message: 'Only registered buyers can request a return.' };
    }
    return buyer.id;
  }

  static async createReturnRequest(payload: { orderId: string; userId: string; reason: string }) {
    const buyerId = await this.resolveBuyerId(payload.userId);

    const order = await prisma.orders.findUnique({
      where: { id: payload.orderId },
      include: { store: true, returnRequests: true },
    });

    if (!order) {
      throw { status: 404, message: 'Order not found.' };
    }
    if (order.buyerId !== buyerId) {
      throw { status: 403, message: 'You are not authorized to initiate a return for this order.' };
    }

    // Only a completed order has anything to return. Returning a PENDING order
    // is a cancellation, which releases the reservation rather than refunding.
    if (order.status !== 'COMPLETED') {
      throw {
        status: 400,
        message: `Only completed orders can be returned. This order is ${order.status}. Cancel it instead.`,
      };
    }

    // The window runs from completion, not from order creation. An order that
    // reached COMPLETED without a `completedAt` predates that field being set;
    // it is treated as out of window rather than as returnable forever.
    if (!order.completedAt) {
      throw {
        status: 409,
        message:
          'This order has no completion date on record, so its return window cannot be ' +
          'established. Contact support to have it reviewed manually.',
      };
    }

    const windowClosesAt = new Date(order.completedAt.getTime() + RETURN_WINDOW_DAYS * DAY_MS);
    if (Date.now() > windowClosesAt.getTime()) {
      throw {
        status: 400,
        message:
          `The ${RETURN_WINDOW_DAYS}-day return window for this order closed on ` +
          `${windowClosesAt.toISOString().slice(0, 10)}.`,
      };
    }

    // A second open return on the same order would let the buyer be refunded
    // twice for one purchase.
    const openReturn = order.returnRequests.find((r) =>
      ['PENDING', 'APPROVED', 'ITEM_RECEIVED'].includes(r.status),
    );
    if (openReturn) {
      throw { status: 409, message: 'A return request for this order is already open.' };
    }
    if (order.returnRequests.some((r) => r.status === 'REFUNDED')) {
      throw { status: 409, message: 'This order has already been refunded.' };
    }

    return ReturnRepository.createReturnRequest({
      orderId: payload.orderId,
      buyerId,
      sellerId: order.store.sellerId,
      reason: payload.reason,
      refundAmount: Number(order.totalAmount),
    });
  }

  /** [userId] is the authenticated `Users` id, resolved to its buyer profile. */
  static async getReturnsByBuyer(userId: string) {
    const buyerId = await this.resolveBuyerId(userId);
    return ReturnRepository.findByBuyerId(buyerId);
  }

  static async getReturnsBySeller(sellerId: string) {
    return ReturnRepository.findBySellerId(sellerId);
  }

  /** Resolves the `Sellers` row for an authenticated `Users` id. */
  static async resolveOwnSellerId(userId?: string) {
    if (!userId) throw { status: 401, message: 'Unauthorized.' };
    const seller = await prisma.sellers.findUnique({ where: { userId } });
    if (!seller) throw { status: 403, message: 'No seller profile for this account.' };
    return seller.id;
  }

  /**
   * Advance a return through its lifecycle, executing the money movement when
   * it reaches REFUNDED.
   *
   * The refund used to stop at computing `refundAmount` — no provider was ever
   * called, so REFUNDED was a label on a record and the buyer's money stayed
   * where it was. See FLAGS.md ORD-6 / PAY-7.
   */
  static async updateReturnStatus(id: string, status: RETURNSTATUS, actorUserId?: string) {
    const returnRequest = await ReturnRepository.findById(id);
    if (!returnRequest) {
      throw { status: 404, message: 'Return request not found.' };
    }

    await this.assertCanDecide(returnRequest.sellerId, actorUserId);

    // A request for the state the return is already in is a retry, not a
    // transition: answer with the current record and do nothing else. The
    // transition check used to sit *inside* this same condition, so a second
    // PATCH of REFUNDED skipped the terminal guard entirely and fell straight
    // back into `executeRefund`. Only the payment-state check two layers down
    // stood between that and a second payout to the buyer, and that check holds
    // only while refunds are for the full amount. See OPEN-FLAGS F88.
    if (returnRequest.status === status) {
      return returnRequest;
    }

    const allowed = ALLOWED_RETURN_TRANSITIONS[returnRequest.status] ?? [];
    if (!allowed.includes(status)) {
      throw {
        status: 400,
        message: allowed.length
          ? `Invalid return transition from '${returnRequest.status}' to '${status}'. Allowed next states: [${allowed.join(', ')}].`
          : `A return in terminal state '${returnRequest.status}' cannot be changed.`,
      };
    }

    if (status === RETURNSTATUS.APPROVED) {
      // Freeze the seller's settlement the moment a return is approved.
      // Without this the hold could elapse mid-return, the settlement would be
      // swept into a payout, and the refund would have to come from the
      // platform's own pocket.
      await SettlementService.holdForOrder(prisma, returnRequest.orderId);
    }

    if (status === RETURNSTATUS.REFUNDED) {
      return this.executeRefund(id);
    }

    const updated = await ReturnRepository.updateStatus(id, status);

    // A rejected return frees the settlement to mature normally again.
    if (status === RETURNSTATUS.REJECTED) {
      await prisma.settlements.updateMany({
        where: { orderId: returnRequest.orderId, status: 'HELD' },
        data: { status: 'PENDING' },
      });
    }

    return updated;
  }

  /**
   * Only the seller the return is against, or an administrator, may decide it.
   *
   * The route was `authenticate` alone, so the buyer who filed the return could
   * approve it and drive it to REFUNDED themselves — an unauthenticated-in-
   * practice refund button. See FLAGS.md ORD-6.
   */
  private static async assertCanDecide(sellerId: string, actorUserId?: string) {
    if (!actorUserId) {
      throw { status: 401, message: 'Unauthorized.' };
    }

    const user = await prisma.users.findUnique({
      where: { id: actorUserId },
      include: { roles: true, seller: { select: { id: true } } },
    });

    const isAdmin = user?.roles.some((role) => ADMIN_ROLES.includes(role.roleName as SystemRole));
    if (isAdmin) return;

    if (user?.seller?.id && user.seller.id === sellerId) return;

    throw {
      status: 403,
      message: 'Only the seller this return is against, or an administrator, can decide it.',
    };
  }

  /**
   * Send the money back through the gateway that took it, then record it.
   *
   * The provider call is made *before* the database is updated: a refund we
   * recorded but never sent is worse than one we sent but failed to record —
   * the first silently keeps the buyer's money, the second is visible in the
   * provider dashboard and can be reconciled.
   */
  private static async executeRefund(returnId: string) {
    const returnRequest = await ReturnRepository.findById(returnId);
    if (!returnRequest) throw { status: 404, message: 'Return request not found.' };

    const payment = await prisma.payments.findFirst({
      where: { orderId: returnRequest.orderId },
      orderBy: { createdAt: 'desc' },
      include: {
        provider: { select: { code: true } },
        paymentMethod: { select: { type: true } },
      },
    });

    if (!payment) {
      throw { status: 404, message: 'No payment record found for this order.' };
    }
    if (
      payment.status !== PAYMENTSTATUS.COMPLETED &&
      payment.status !== PAYMENTSTATUS.PARTIALLY_REFUNDED
    ) {
      throw {
        status: 400,
        message: `Cannot refund a payment in state '${payment.status}'. Only a completed payment can be refunded.`,
      };
    }

    const alreadyRefunded = Number(payment.refundedAmount);
    const refundAmount = Number(returnRequest.refundAmount);
    const refundable = Number((Number(payment.amount) - alreadyRefunded).toFixed(2));

    if (refundAmount <= 0) {
      throw { status: 400, message: 'Refund amount must be greater than zero.' };
    }
    if (refundAmount > refundable) {
      throw {
        status: 400,
        message: `Refund of ₱${refundAmount.toFixed(2)} exceeds the ₱${refundable.toFixed(2)} still refundable on this payment.`,
      };
    }

    // Cash never went through a gateway — the seller took the buyer's money at
    // the stall, so there is nothing for us to send back. Recording it as
    // refunded is the seller's acknowledgement that they handed the cash over.
    const isCash = payment.paymentMethod?.type === 'CASH';

    let refundReference: string | null = null;

    if (!isCash) {
      if (!payment.providerReference) {
        throw {
          status: 409,
          message:
            'This payment has no provider reference, so it cannot be refunded automatically. ' +
            'Refund it in the provider dashboard and reconcile manually.',
        };
      }

      const adapter = PaymentService.getProviderAdapter(payment.provider?.code ?? 'MOCK');
      if (!adapter.refundPayment) {
        throw {
          status: 501,
          message: `The ${payment.provider?.code ?? 'configured'} provider does not support automated refunds.`,
        };
      }

      // Mark the intent before calling out, so a refund that succeeds at the
      // gateway but whose response we never see is visibly in flight rather
      // than looking like it never happened.
      await prisma.payments.update({
        where: { id: payment.id },
        data: { status: PAYMENTSTATUS.REFUND_PENDING },
      });

      try {
        const result = await adapter.refundPayment(
          payment.providerReference,
          Math.round(refundAmount * 100),
          'requested_by_customer',
        );
        refundReference = result.refundId;
      } catch (error) {
        // Put the payment back where it was; the refund did not happen.
        await prisma.payments.update({
          where: { id: payment.id },
          data: { status: payment.status },
        });
        logger.error(`[Refund] Provider refund failed for order ${returnRequest.orderId}:`, error);
        throw {
          status: 502,
          message: 'The payment provider rejected the refund. No money has moved.',
        };
      }
    }

    const totalRefunded = Number((alreadyRefunded + refundAmount).toFixed(2));
    const isFullRefund = totalRefunded >= Number(payment.amount);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.payments.update({
        where: { id: payment.id },
        data: {
          status: isFullRefund ? PAYMENTSTATUS.REFUNDED : PAYMENTSTATUS.PARTIALLY_REFUNDED,
          refundedAmount: new Prisma.Decimal(totalRefunded),
          refundReference,
          refundedAt: new Date(),
        },
      });

      // The seller is not paid for a sale that came back.
      const settlement = await SettlementService.markRefundedForOrder(tx, returnRequest.orderId);

      // The goods are back with the seller, so the stock is sellable again.
      await this.restockReturnedItems(tx, returnRequest.orderId, returnId);

      const closed = await tx.returnRequests.update({
        where: { id: returnId },
        data: {
          status: RETURNSTATUS.REFUNDED,
          refundedAt: new Date(),
          closedAt: new Date(),
        },
      });

      return { closed, settlement };
    });

    // Refunding a settlement that was already paid out leaves the platform
    // short by the seller's net. `markRefundedForOrder` logs it; repeat it on
    // the refund's own log line so the two sides of the loss appear together.
    if (updated.settlement?.clawbackOwed) {
      logger.error(
        `[Refund] Order ${returnRequest.orderId} refunded to the buyer, but the seller had ` +
          `already been paid ₱${updated.settlement.clawbackOwed.toFixed(2)} on payout ` +
          `${updated.settlement.payoutNumber}. Recover it manually. See OPEN-FLAGS F84.`,
      );
    }

    try {
      const order = await prisma.orders.findUnique({
        where: { id: returnRequest.orderId },
        include: { buyer: { select: { userId: true } } },
      });
      if (order?.buyer?.userId) {
        emitNotificationToUser(order.buyer.userId, {
          id: returnId,
          title: 'Refund issued',
          body: `₱${refundAmount.toLocaleString('en-PH')} has been refunded for Order #${returnRequest.orderId}.`,
          metadata: { orderId: returnRequest.orderId, type: 'REFUND_ISSUED' },
          sentAt: new Date().toISOString(),
        });
      }
    } catch {
      // Notification delivery is best-effort.
    }

    return updated.closed;
  }

  /**
   * Put the goods back on the shelf.
   *
   * `completeOrder` decrements `quantityOnHand` and increments `totalSold` when
   * the seller hands the order over. A refund is that sale coming back, and
   * nothing reversed either half: stock the seller physically has again stayed
   * unsellable until somebody noticed and used the manual restock endpoint.
   *
   * `quantityReserved` is deliberately untouched — the reservation was consumed
   * at fulfilment, so there is nothing left to release. Note that the schema has
   * carried `RETURN` in both `INVENTORYMOVEMENTTYPE` and `INVENTORYREFERENCETYPE`
   * since it was written, and no code ever wrote one. See OPEN-FLAGS F87.
   */
  private static async restockReturnedItems(
    tx: Prisma.TransactionClient,
    orderId: string,
    returnId: string,
  ) {
    const items = await tx.orderItems.findMany({
      where: { orderId },
      select: { productId: true, quantity: true },
    });

    for (const item of items) {
      if (item.quantity <= 0) continue;

      const inventory = await tx.inventory.findFirst({
        where: { productId: item.productId },
        select: { id: true, storeId: true, quantityOnHand: true },
      });

      // A product whose inventory row has since been removed has no ledger to
      // credit. Skip it rather than failing the refund — the money has already
      // left the gateway by this point, and a stock count is the lesser loss.
      if (!inventory) {
        logger.warn(
          `[Refund] No inventory row for product ${item.productId} on order ${orderId}; ` +
            'its stock was not restored.',
        );
        continue;
      }

      const newOnHand = inventory.quantityOnHand + item.quantity;

      await tx.inventory.update({
        where: { id: inventory.id },
        data: { quantityOnHand: { increment: item.quantity } },
      });

      // Clamped rather than decremented blind: `totalSold` drives the product
      // ranking, and a negative one would sort a returned product below a
      // product nobody has ever bought.
      const product = await tx.products.findUnique({
        where: { id: item.productId },
        select: { totalSold: true },
      });
      await tx.products.update({
        where: { id: item.productId },
        data: { totalSold: Math.max(0, (product?.totalSold ?? 0) - item.quantity) },
      });

      await tx.inventoryMovements.create({
        data: {
          inventoryId: inventory.id,
          productId: item.productId,
          storeId: inventory.storeId,
          movementType: 'RETURN',
          quantityDelta: item.quantity,
          previousOnHand: inventory.quantityOnHand,
          newOnHand,
          referenceId: returnId,
          referenceType: 'RETURN',
          note: `Refunded return ${returnId} for order ${orderId}`,
        },
      });
    }
  }
}
