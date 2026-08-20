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

    if (returnRequest.status !== status) {
      const allowed = ALLOWED_RETURN_TRANSITIONS[returnRequest.status] ?? [];
      if (!allowed.includes(status)) {
        throw {
          status: 400,
          message: allowed.length
            ? `Invalid return transition from '${returnRequest.status}' to '${status}'. Allowed next states: [${allowed.join(', ')}].`
            : `A return in terminal state '${returnRequest.status}' cannot be changed.`,
        };
      }
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
      await SettlementService.markRefundedForOrder(tx, returnRequest.orderId);

      return tx.returnRequests.update({
        where: { id: returnId },
        data: {
          status: RETURNSTATUS.REFUNDED,
          refundedAt: new Date(),
          closedAt: new Date(),
        },
      });
    });

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

    return updated;
  }
}
