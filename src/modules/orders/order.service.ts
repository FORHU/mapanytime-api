import crypto from 'crypto';
import OrderRepository, { LOW_STOCK_THRESHOLD } from './order.repository';
import ProductRepository from '../products/product.repository';
import { computeItemDiscount } from './pricing.util';
import { validateOrderTransition } from './order.state';
import { prisma } from '../../utils/prisma';
import { emitNotificationToUser } from '../../infrastructure/socket';
import { buildPage } from '../../helpers/pagination.helper';
import RedisUtil from '../../utils/redis.util';
import {
  CHARGEBENEFICIARY,
  CHARGEPAYER,
  FULLFILLMENTTYPE,
  ORDERCHARGETYPE,
  ORDERSTATUS,
  PAYMENTMETHODTYPE,
  PAYMENTSTATUS,
  Prisma,
} from '@prisma/client';
import PaymentService from '../payments/payment.service';
import PricingEngineService from '../pricing/pricing-engine.service';
import SettlementService from '../settlements/settlement.service';
import RewardService from '../rewards/reward.service';
import InventoryStockRepository from '../inventory/inventoryStock.repository';
import NotificationService from '../notifications/notification.service';
import { assertStoreInScope, resolveAccessibleStoreIds } from '../organization/storeAccess';
import type { AuthUser } from '../auth/auth.repository';
import logger from '../../utils/logger';

/**
 * Grace period after the booked pickup time before the hold lapses. A buyer who
 * turns up a little late should still find their goods there.
 */
const PICKUP_GRACE_MS = 2 * 60 * 60 * 1000;

/** Fallback hold for an order with no pickup time — the old flat TTL. */
const DEFAULT_RESERVATION_TTL_MS = 15 * 60 * 1000;

/**
 * How long a seller-generated cash-pickup confirmation code stays valid.
 * Long enough to cover showing the QR and the buyer scanning it, short
 * enough to bound how long a leaked/overheard code stays exploitable.
 */
const CASH_PICKUP_CODE_TTL_SECONDS = 15 * 60;

const cashPickupCodeKey = (orderId: string) => `cash-pickup-code:${orderId}`;

/** Mutex guarding confirmCashPickup's critical section — see its comment. */
const cashPickupLockKey = (orderId: string) => `cash-pickup-lock:${orderId}`;

/**
 * How long stock is held for an order.
 *
 * The flat 15 minutes assumed checkout followed immediately, which is true of a
 * web basket and false of this business: the buyer reserves online and collects
 * at the stall, possibly days later. Every reservation expired long before they
 * arrived, releasing stock they had already paid for. Held to the pickup slot
 * they actually booked instead, plus a grace window.
 *
 * Settled 2026-08-20; see FIX-PLAN.md item 14.
 */
function resolveReservationExpiry(pickupAt?: Date | null): Date {
  if (!pickupAt) return new Date(Date.now() + DEFAULT_RESERVATION_TTL_MS);

  const expiry = new Date(new Date(pickupAt).getTime() + PICKUP_GRACE_MS);

  // A pickup time in the past would expire the hold instantly. Order creation
  // validates `pickupAt` is in the future, so this is belt and braces.
  const floor = new Date(Date.now() + DEFAULT_RESERVATION_TTL_MS);
  return expiry > floor ? expiry : floor;
}

export default class OrderService {
  static async createOrder(payload: {
    buyerId: string;
    storeId: string;
    type: FULLFILLMENTTYPE;
    paymentMethod?: string;
    paymentMethodId?: string;
    pickupAt?: Date;
    userVoucherId?: string;
    items: { productId: string; quantity: number }[];
  }) {
    const order = await prisma.$transaction(async (tx) => {
      const store = await tx.stores.findUnique({
        where: { id: payload.storeId },
        include: {
          storeLocations: true,
          seller: { include: { users: true } },
        },
      });

      if (!store) {
        throw { status: 404, message: 'Store not found.' };
      }
      if (!store.isActive) {
        throw {
          status: 400,
          message: `Store ${store.storeName} is currently inactive and cannot accept orders.`,
        };
      }

      // Snapshot merchant info at order time so receipts are immutable
      const loc = store.storeLocations;
      const storeAddressSnapshot = loc
        ? [loc.currentAddress, loc.city, loc.province, loc.country].filter(Boolean).join(', ')
        : null;
      const sellerPhoneSnapshot = store.phone ?? store.seller?.users?.phoneNumber ?? null;
      const storeEmailSnapshot = store.email ?? store.seller?.users?.email ?? null;

      let subtotalAmount = 0;
      let totalDiscount = 0;
      const orderItemsData = [];
      const reservationIds: string[] = [];
      let primaryCategoryId: string | undefined;

      for (const item of payload.items) {
        const product = await tx.products.findUnique({
          where: { id: item.productId },
          include: { inventory: true },
        });

        if (!product) throw new Error(`Product with ID ${item.productId} not found.`);
        if (!product.isActive)
          throw new Error(`Product ${product.name} is currently inactive and cannot be ordered.`);
        if (product.storeId !== payload.storeId)
          throw new Error(`Product ${product.name} does not belong to the selected store.`);

        if (!primaryCategoryId && product.categoryId) {
          primaryCategoryId = product.categoryId;
        }

        const inventory = product.inventory[0];
        if (!inventory) throw new Error(`Inventory record missing for ${product.name}.`);

        const availableStock = inventory.quantityOnHand - inventory.quantityReserved;
        if (availableStock < item.quantity) {
          throw new Error(`Insufficient stock for ${product.name}. Only ${availableStock} left.`);
        }

        const numericPrice = Number(product.price);
        const itemTotal = numericPrice * item.quantity;
        subtotalAmount += itemTotal;

        // Find an active discount ad (BOGO, % off, or fixed-amount off)
        // linked to this product for this store. variantId is left out —
        // cart items are product-only today. Shared with the cart pricing
        // preview so what a buyer sees before checkout matches the charge.
        const { itemDiscount, appliedAdId } = await computeItemDiscount(tx, {
          productId: item.productId,
          quantity: item.quantity,
          storeId: payload.storeId,
          unitPrice: numericPrice,
        });
        totalDiscount += itemDiscount;

        orderItemsData.push({
          productId: product.id,
          productName: product.name,
          quantity: item.quantity,
          unitPrice: product.price,
          discountAmount: itemDiscount,
          appliedAdId,
        });

        // The availableStock read above is advisory only — another checkout
        // can take the last unit between that read and this line. The
        // conditional UPDATE inside tryReserve is the actual guard (F75).
        const reserved = await InventoryStockRepository.tryReserve(tx, inventory.id, item.quantity);
        if (!reserved) {
          throw new Error(`Insufficient stock for ${product.name}. It sold out during checkout.`);
        }

        const reservation = await tx.inventoryReservations.create({
          data: {
            inventoryId: inventory.id,
            buyerId: payload.buyerId,
            quantity: item.quantity,
            status: 'RESERVED',
            expiresAt: resolveReservationExpiry(payload.pickupAt),
          },
        });
        reservationIds.push(reservation.id);
      }

      // A claimed MapPoints voucher, validated but not yet marked used —
      // that happens after the order row exists, so a phantom spend can
      // never outlive a failed order creation.
      let voucherAmount = 0;
      let userVoucherId: string | undefined;
      if (payload.userVoucherId) {
        const validated = await RewardService.validateVoucherForOrder(
          tx,
          payload.buyerId,
          payload.userVoucherId,
          Math.max(0, subtotalAmount - totalDiscount),
        );
        userVoucherId = validated.userVoucher.id;
        voucherAmount = validated.discountAmount;
      }

      // 1. Resolve payment provider and method
      // Throws a 400 when the method is unknown or inactive rather than
      // substituting an arbitrary one. See FLAGS.md.
      const method = await PaymentService.resolvePaymentMethod(tx, {
        paymentMethodId: payload.paymentMethodId,
        paymentMethod: payload.paymentMethod,
      });

      // 2. Dynamically calculate order pricing, provider processing fee, payer policy, and marketplace commission
      const pricingResult = await PricingEngineService.calculateOrderPricing({
        subtotalAmount,
        discountAmount: totalDiscount,
        voucherAmount,
        storeId: payload.storeId,
        sellerId: store.sellerId,
        categoryId: primaryCategoryId,
        providerId: method.providerId,
        paymentMethodId: method.id,
        paymentMethodCode: method.code,
        paymentMethodType: method.type,
      });

      const charges: Prisma.OrderChargesUncheckedCreateWithoutOrderInput[] = [
        {
          type: ORDERCHARGETYPE.PRODUCT,
          source: 'Cart Items Subtotal',
          amount: pricingResult.subtotalAmount,
          payer: CHARGEPAYER.BUYER,
          beneficiary: CHARGEBENEFICIARY.SELLER,
        },
        ...(pricingResult.discountAmount > 0
          ? [
              {
                type: ORDERCHARGETYPE.DISCOUNT,
                source: 'Store / Item Promotion',
                amount: pricingResult.discountAmount,
                payer: CHARGEPAYER.SELLER,
                beneficiary: CHARGEBENEFICIARY.BUYER,
              },
            ]
          : []),
        // MapPoints voucher redemption. Payer PLATFORM, not SELLER — the
        // platform absorbs it and the seller is still paid in full, so it
        // must never fold into the DISCOUNT row above. See F39/F40.
        ...(pricingResult.voucherAmount > 0
          ? [
              {
                type: ORDERCHARGETYPE.PLATFORM_SUBSIDY,
                source: 'MapPoints Voucher Redemption',
                amount: pricingResult.voucherAmount,
                payer: CHARGEPAYER.PLATFORM,
                beneficiary: CHARGEBENEFICIARY.BUYER,
              },
            ]
          : []),
        {
          type: ORDERCHARGETYPE.BUYER_TRANSACTION_FEE,
          source: 'Buyer Handling Fee',
          rate: pricingResult.buyerTransactionFee.effectiveRatePercentage,
          amount: pricingResult.buyerTransactionFee.totalBuyerFeeAmount,
          payer: CHARGEPAYER.BUYER,
          beneficiary: CHARGEBENEFICIARY.PLATFORM,
        },
        {
          type: ORDERCHARGETYPE.SELLER_MARKETPLACE_FEE,
          source: `MapAnytime Marketplace Commission (${(pricingResult.sellerMarketplaceCommission.rate * 100).toFixed(2)}%)`,
          rate: pricingResult.sellerMarketplaceCommission.rate,
          amount: pricingResult.sellerMarketplaceCommission.amount,
          payer: CHARGEPAYER.SELLER,
          beneficiary: CHARGEBENEFICIARY.PLATFORM,
        },
        {
          type: ORDERCHARGETYPE.PAYMENT_PROCESSING_FEE,
          source: `${method.provider.name || 'Payment'} Gateway Cost`,
          rate: pricingResult.paymentProcessingCost.ratePercentage,
          amount: pricingResult.paymentProcessingCost.calculatedCost,
          payer: CHARGEPAYER.PLATFORM,
          beneficiary: CHARGEBENEFICIARY.PAYMENT_PROVIDER,
        },
      ];

      const orderData: Prisma.OrdersUncheckedCreateInput = {
        buyerId: payload.buyerId,
        storeId: payload.storeId,
        storeName: store.storeName,
        storeAddressSnapshot,
        sellerPhoneSnapshot,
        storeEmailSnapshot,
        totalAmount: pricingResult.buyerTotalAmount,
        subtotalAmount: pricingResult.subtotalAmount,
        discountAmount: pricingResult.discountAmount,
        voucherAmount: pricingResult.voucherAmount,
        marketplaceFeeAmount: pricingResult.sellerMarketplaceCommission.amount,
        sellerNetAmount: pricingResult.sellerNetAmount,

        // ── Immutable Financial Accounting & Fee Snapshots ─────────────
        // 1. Marketplace Commission (MapAnytime Revenue)
        sellerMarketplaceFeeRate: pricingResult.sellerMarketplaceCommission.rate,
        sellerMarketplaceFeeAmount: pricingResult.sellerMarketplaceCommission.amount,

        // 2. Payment Provider Processing Cost (Actual cost charged by PayMongo/Bank/etc.)
        paymentProviderFeeRate: pricingResult.paymentProcessingCost.ratePercentage,
        paymentProviderFixedFee: pricingResult.paymentProcessingCost.fixedAmount,
        paymentProviderFeeAmount: pricingResult.paymentProcessingCost.calculatedCost,

        // 3. Buyer Transaction Fee (Amount charged to buyer based on PAYMENTFEEPAYER policy)
        buyerTransactionFeeRate: pricingResult.buyerTransactionFee.effectiveRatePercentage,
        buyerTransactionFeeAmount: pricingResult.buyerTransactionFee.totalBuyerFeeAmount,
        paymentFeePayer: pricingResult.buyerTransactionFee.payerPolicy,

        type: payload.type,
        pickupAt: payload.pickupAt ?? null,
        status: 'PENDING' as const,
        orderitems: {
          create: orderItemsData,
        },
        payment: {
          create: {
            amount: pricingResult.buyerTotalAmount,
            providerId: method.providerId,
            paymentMethodId: method.id,
            status: 'PENDING' as const,
          },
        },
        charges: { create: charges },
      };

      const createdOrder = await OrderRepository.insertOrder(orderData, tx);

      if (userVoucherId) {
        // Inside the same transaction: a voucher marked used for an order
        // that then failed to create would be a phantom spend.
        await RewardService.markVoucherUsed(tx, userVoucherId, createdOrder.id);
      }

      const providerCode = method.provider.code;
      const provider = PaymentService.getProviderAdapter(providerCode);

      const amountInCentavos = Math.round(Number(createdOrder.totalAmount) * 100);
      const lineItems = orderItemsData.map((item) => ({
        name: `Product #${item.productId}`,
        quantity: item.quantity,
        amount: Math.round(Number(item.unitPrice) * 100),
        currency: 'PHP',
      }));

      const checkoutResult = await provider.createCheckoutSession({
        orderId: createdOrder.id,
        amountInCentavos,
        currency: 'PHP',
        description: `Payment for Order ${createdOrder.id}`,
        lineItems,
        paymentMethodCode: method.code,
      });

      await tx.payments.updateMany({
        where: { orderId: createdOrder.id },
        data: {
          checkoutSessionId: checkoutResult.checkoutSessionId,
          checkoutUrl: checkoutResult.checkoutUrl,
          paymentIntentId: checkoutResult.paymentIntentId,
        },
      });

      // Link this checkout's own reservations to the order, by id. Matching on
      // (buyerId, orderId: null) instead also swept up the same buyer's
      // unrelated holds — a cart reservation, or a concurrent checkout at
      // another store — and attached them here, after which this order's
      // release paths would hand back stock it never held.
      await tx.inventoryReservations.updateMany({
        where: { id: { in: reservationIds } },
        data: { orderId: createdOrder.id },
      });

      return {
        ...createdOrder,
        checkoutUrl: checkoutResult.checkoutUrl,
      };
    });

    try {
      const [store, buyer] = await Promise.all([
        prisma.stores.findUnique({
          where: { id: order.storeId },
          include: { seller: { select: { userId: true } } },
        }),
        prisma.buyers.findUnique({
          where: { id: order.buyerId },
          select: { userId: true },
        }),
      ]);

      if (store?.seller?.userId) {
        emitNotificationToUser(store.seller.userId, {
          id: order.id,
          title: 'New order',
          body: `You have a new order worth ₱${order.totalAmount.toLocaleString()}.`,
          metadata: { orderId: order.id, storeId: order.storeId, type: 'ORDER_CREATED' },
          sentAt: new Date().toISOString(),
        });
      }

      if (buyer?.userId) {
        emitNotificationToUser(buyer.userId, {
          id: order.id,
          title: 'Order Placed',
          body: `Your order #${order.id.slice(0, 8).toUpperCase()} has been placed successfully.`,
          metadata: { orderId: order.id, storeId: order.storeId, type: 'ORDER_CREATED' },
          sentAt: new Date().toISOString(),
        });
      }
    } catch {
      // Swallow — notification delivery is non-critical.
    }

    return order;
  }

  /**
   * A seller marks an order fulfilled.
   *
   * Organization-scoped: an assigned `SELLER_USER` fulfils orders for their
   * store, not just the merchant who owns it. The old check compared the
   * caller's own `Sellers.id` against `store.sellerId`, which staff can never
   * match.
   */
  static async completeOrder(user: AuthUser, orderId: string, storeId: string) {
    await assertStoreInScope(user, storeId);
    return this.completeOrderInternal(orderId, storeId);
  }

  /**
   * The completion work itself, with no actor check — callers must already have
   * established authority.
   *
   * Two do, differently: {@link completeOrder} by proving the caller may
   * operate the store, and {@link confirmCashPickup} by the BUYER presenting a
   * valid single-use code. The buyer is the actor in that second case, so a
   * seller-scope check there would always fail; the code is the authorization.
   */
  private static async completeOrderInternal(orderId: string, storeId: string) {
    // Populated inside the transaction, read after it commits — see below.
    const lowStockAlerts: { productId: string; productName: string; quantityOnHand: number }[] = [];

    const completed = await prisma.$transaction(async (tx) => {
      const order = await OrderRepository.getOrderById(orderId, tx);

      if (!order) throw new Error('Order not found.');
      if (order.storeId !== storeId) throw new Error('No access to this store for fulfillment.');

      validateOrderTransition(order.status, 'COMPLETED');

      const payment = await tx.payments.findFirst({
        where: { orderId: orderId },
        orderBy: { createdAt: 'desc' },
        include: { paymentMethod: { select: { type: true } } },
      });

      if (!payment) {
        throw new Error('No payment record found for this order.');
      }

      // Only cash is settled by the seller handing the goods over — that is the
      // moment the money actually changes hands, and no gateway will ever send
      // a webhook for it. For every other method the gateway is the authority,
      // so completing the order must not fabricate a payment confirmation.
      // See FLAGS.md.
      if (payment.status !== 'COMPLETED') {
        if (payment.paymentMethod?.type !== PAYMENTMETHODTYPE.CASH) {
          throw {
            status: 400,
            message:
              'This order cannot be completed until its payment is confirmed by the payment provider.',
          };
        }

        await tx.payments.update({
          where: { id: payment.id },
          data: { status: 'COMPLETED', paidAt: new Date() },
        });
      }

      for (const item of order.orderitems) {
        const inventory = await tx.inventory.findFirst({
          where: { productId: item.productId },
        });

        if (!inventory)
          throw new Error(`Inventory tracking ledger missing for product ID ${item.productId}.`);

        const newOnHand = inventory.quantityOnHand - item.quantity;

        // Only the on-hand count moves here. The matching quantityReserved
        // release is claimed from the reservation rows once, below.
        await tx.inventory.update({
          where: { id: inventory.id },
          data: {
            quantityOnHand: { decrement: item.quantity },
            version: { increment: 1 },
          },
        });

        // Alert on the crossing, not on every order once already low — otherwise
        // the seller gets one notification per sale for the rest of the product's
        // life at low stock.
        if (inventory.quantityOnHand > LOW_STOCK_THRESHOLD && newOnHand <= LOW_STOCK_THRESHOLD) {
          lowStockAlerts.push({
            productId: item.productId,
            productName: item.productName ?? 'A product',
            quantityOnHand: newOnHand,
          });
        }

        await tx.products.update({
          where: { id: item.productId },
          data: {
            totalSold: { increment: item.quantity },
          },
        });
      }

      // Releases the hold and flips the rows to CONSUMED in one claim. The
      // quantity comes from the reservation rows rather than the order's items:
      // if the TTL sweeper already expired this order's hold there is nothing
      // left to give back, and decrementing per item drove quantityReserved
      // negative (F43).
      await InventoryStockRepository.releaseOrderReservations(tx, orderId, 'CONSUMED');

      const completed = await OrderRepository.updateOrderStatus(
        orderId,
        'COMPLETED',
        'COMPLETED',
        tx,
      );

      // Book what the platform now owes the seller. This is the only writer of
      // `Settlements` — without it `PayoutService` filters on RELEASED rows
      // that never exist, and no seller is ever paid. Inside the same
      // transaction as the completion, so the ledger cannot record a debt for
      // an order that did not finish completing. See FLAGS.md LED-3.
      await SettlementService.createForCompletedOrder(tx, orderId);

      // Credit MapPoints in the same transaction as completion, for the same
      // reason the settlement is booked here: a ledger row for an order that
      // then failed to complete would be a phantom credit.
      await RewardService.awardPointsForCompletedOrder(tx, orderId);

      return completed;
    });

    // The store's OWNER, not whoever completed the order. A SELLER_USER can now
    // fulfil an order, and low stock is the merchant's problem to act on.
    const storeOwner = lowStockAlerts.length ? await ProductRepository.getStoreById(storeId) : null;
    const ownerUserId = storeOwner?.seller?.userId ?? '';

    for (const alert of ownerUserId ? lowStockAlerts : []) {
      try {
        await NotificationService.sendNotification({
          userId: ownerUserId,
          title: 'Low stock alert',
          body: `${alert.productName} is down to ${alert.quantityOnHand} unit${alert.quantityOnHand === 1 ? '' : 's'} left.`,
          metadata: {
            type: 'LOW_STOCK',
            productId: alert.productId,
            quantityOnHand: alert.quantityOnHand,
          },
        });
      } catch {
        // Swallow — notification delivery is non-critical, and the order is
        // already completed.
      }
    }

    return completed;
  }

  /**
   * Seller generates a short-lived, single-use code for a Cash on Pickup
   * order — displayed to the buyer as a QR (and as plain text for manual
   * fallback) instead of the seller unilaterally marking the order complete.
   * The buyer scanning/entering it correctly is what proves cash actually
   * changed hands; see {@link confirmCashPickup}, which is the only thing
   * that can spend this code.
   */
  static async generateCashPickupCode(user: AuthUser, orderId: string, storeId: string) {
    await assertStoreInScope(user, storeId);

    const order = await OrderRepository.getOrderById(orderId, prisma);
    if (!order) throw { status: 404, message: 'Order not found.' };
    if (order.storeId !== storeId) {
      throw { status: 403, message: 'This order does not belong to this branch.' };
    }
    if (order.status !== 'READY_FOR_PICKUP') {
      throw {
        status: 400,
        message: 'Only orders that are ready for pickup can generate a confirmation code.',
      };
    }

    const payment = await prisma.payments.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      include: { paymentMethod: { select: { type: true } } },
    });
    if (payment?.paymentMethod?.type !== PAYMENTMETHODTYPE.CASH) {
      throw {
        status: 400,
        message: 'This order is not paid by cash on pickup.',
      };
    }

    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    await RedisUtil.client.setEx(cashPickupCodeKey(orderId), CASH_PICKUP_CODE_TTL_SECONDS, code);

    return { code, expiresInSeconds: CASH_PICKUP_CODE_TTL_SECONDS };
  }

  /**
   * Buyer redeems the seller-shown code to confirm a Cash on Pickup order —
   * the flipped counterpart of the seller-scans-buyer's-pass flow every other
   * payment method uses. The code is the only proof of payment this endpoint
   * trusts; it is consumed on first use (deleted from Redis before completion
   * runs) so a screenshot or overheard code cannot confirm a second time.
   * Completion itself still runs through {@link completeOrder} unchanged, so
   * inventory, settlement, and low-stock alerting stay identical either way —
   * only *who* is allowed to trigger it, and *why*, differs here.
   */
  static async confirmCashPickup(userId: string, orderId: string, code: string) {
    const buyer = await prisma.buyers.findUnique({ where: { userId } });
    if (!buyer) {
      throw { status: 403, message: 'Only registered buyers can confirm a pickup.' };
    }

    const order = await OrderRepository.getOrderById(orderId, prisma);
    if (!order) throw { status: 404, message: 'Order not found.' };
    if (order.buyerId !== buyer.id) {
      throw { status: 403, message: 'You do not have access to this order.' };
    }

    const payment = await prisma.payments.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      include: { paymentMethod: { select: { type: true } } },
    });
    if (payment?.paymentMethod?.type !== PAYMENTMETHODTYPE.CASH) {
      throw { status: 400, message: 'This order is not paid by cash on pickup.' };
    }

    // A network retry or a double-tap before the button visually disables
    // could otherwise both pass the code check before either delete runs,
    // and both proceed into completeOrder concurrently — double inventory
    // decrements, double settlements. This lock (not the code's own
    // get-then-delete, which stays non-atomic on purpose — see below) is
    // what actually closes that window: only one confirm attempt per order
    // is ever inside the critical section at a time.
    const lockKey = cashPickupLockKey(orderId);
    const acquiredLock = await RedisUtil.client.set(lockKey, '1', {
      NX: true,
      expiration: { type: 'EX', value: 30 },
    });
    if (!acquiredLock) {
      throw {
        status: 409,
        message: 'This order is already being confirmed — please wait a moment.',
      };
    }

    try {
      const storedCode = await RedisUtil.client.get(cashPickupCodeKey(orderId));
      if (!storedCode) {
        throw {
          status: 400,
          message: 'No pending confirmation code for this order — ask the seller to show it again.',
        };
      }
      // Deliberately not consumed via an atomic get-and-delete: that would
      // burn the real code on a single wrong guess or typo (manual entry is
      // the fallback when scanning fails), forcing the seller to regenerate
      // for what might just be a mis-scan. The lock above is what prevents
      // concurrent double-spend, not this comparison.
      if (storedCode.toUpperCase() !== code.trim().toUpperCase()) {
        throw { status: 400, message: 'Incorrect confirmation code.' };
      }

      // Consumed before completion runs, not after — a failure inside
      // completeOrder should not leave a still-valid code sitting around to
      // be silently retried; the seller can just generate a fresh one.
      await RedisUtil.client.del(cashPickupCodeKey(orderId));

      // No scope check: the buyer is the actor here, and the code they just
      // presented is the authorization.
      return await this.completeOrderInternal(orderId, order.storeId);
    } finally {
      await RedisUtil.client.del(lockKey);
    }
  }

  static async cancelOrder(userId: string, orderId: string) {
    const buyer = await prisma.buyers.findUnique({
      where: { userId: userId },
    });

    if (!buyer) {
      throw { status: 403, message: 'Only registered buyers can cancel orders.' };
    }

    const order = await prisma.orders.findUnique({
      where: { id: orderId },
      include: { orderitems: true },
    });

    if (!order) throw { status: 404, message: 'Order not found.' };
    if (order.buyerId !== buyer.id) {
      throw { status: 403, message: 'You do not have access to this order.' };
    }

    try {
      validateOrderTransition(order.status, 'CANCELLED');
    } catch (error) {
      const err = error as Error;
      throw { status: 400, message: err.message };
    }

    // Cancelling a PENDING order (buyer never finished paying) just releases the
    // hold. Cancelling a PROCESSING order means the gateway already captured
    // real money — that must go back through the provider, not just be
    // stamped FAILED. Raised as S3 in the since-deleted PICKUP-NEXT.md; the
    // register now lives in mapanytime-api/docs/specs/OPEN-FLAGS.md.
    const payment = await prisma.payments.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      include: {
        paymentMethod: { select: { type: true } },
        provider: { select: { code: true } },
      },
    });

    const isCash = payment?.paymentMethod?.type === PAYMENTMETHODTYPE.CASH;
    const needsRefund = payment?.status === PAYMENTSTATUS.COMPLETED && !isCash;

    let refundReference: string | null = null;

    if (needsRefund && payment) {
      if (!payment.providerReference) {
        throw {
          status: 409,
          message:
            'This payment has no provider reference, so it cannot be refunded automatically. ' +
            'Cancel it in the provider dashboard and reconcile manually.',
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
      // than looking like it never happened. Mirrors ReturnService.executeRefund.
      await prisma.payments.update({
        where: { id: payment.id },
        data: { status: PAYMENTSTATUS.REFUND_PENDING },
      });

      try {
        const result = await adapter.refundPayment(
          payment.providerReference,
          Math.round(Number(payment.amount) * 100),
          'requested_by_customer',
        );
        refundReference = result.refundId;
      } catch (error) {
        // Put the payment back where it was; the refund did not happen, so the
        // order must not be cancelled either.
        await prisma.payments.update({
          where: { id: payment.id },
          data: { status: payment.status },
        });
        logger.error(`[Cancel] Provider refund failed for order ${orderId}:`, error);
        throw {
          status: 502,
          message:
            'The payment provider rejected the refund. No money has moved; the order was not cancelled.',
        };
      }
    }

    try {
      return await prisma.$transaction(async (tx) => {
        // Re-validate against the live status: the refund call above was made
        // outside this transaction, so the order may have moved on (e.g. the
        // seller completed it) while the refund was in flight. Overwriting a
        // COMPLETED/settled order back to CANCELLED here would double-account
        // — refunded buyer, settled seller, same order.
        const current = await tx.orders.findUniqueOrThrow({ where: { id: orderId } });
        try {
          validateOrderTransition(current.status, 'CANCELLED');
        } catch {
          throw new Error(
            needsRefund
              ? `Order status changed to ${current.status} while the refund was processing. ` +
                  'The refund has already been issued at the provider — reconcile this order manually.'
              : `Order status changed to ${current.status}; it can no longer be cancelled.`,
          );
        }

        // One claim, idempotent: a hold the TTL sweeper already released is no
        // longer RESERVED, so it is not given back a second time (F43).
        await InventoryStockRepository.releaseOrderReservations(tx, orderId, 'RELEASED');

        if (needsRefund && payment) {
          await tx.payments.update({
            where: { id: payment.id },
            data: {
              status: PAYMENTSTATUS.REFUNDED,
              refundedAmount: payment.amount,
              refundReference,
              refundedAt: new Date(),
            },
          });
          return tx.orders.update({
            where: { id: orderId },
            data: { status: 'CANCELLED' },
            include: { orderitems: true, payment: true },
          });
        }

        return OrderRepository.updateOrderStatus(orderId, 'CANCELLED', 'FAILED', tx);
      });
    } catch (error) {
      const err = error as Error;
      throw { status: 400, message: err.message };
    }
  }

  static async getMyOrders(userId: string) {
    let buyer = await prisma.buyers.findUnique({
      where: { userId: userId },
    });

    if (!buyer) {
      const user = await prisma.users.findUnique({ where: { id: userId } });
      const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Buyer';
      buyer = await prisma.buyers.create({
        data: { userId: userId, displayName },
      });
    }

    return OrderRepository.getOrdersByBuyerId(buyer.id);
  }

  /**
   * Resolves which of the seller's stores a request may read, enforcing
   * ownership. Shared by the paginated list and the stats endpoint.
   */
  /**
   * The stores whose orders the caller may read.
   *
   * Two ownership models coexist. Organization membership is the current one —
   * a `seller_admin` reaches every store the org owns, a `seller_user` only the
   * stores explicitly assigned to them. Direct ownership through the caller's
   * own `Sellers` row is the pre-organization one.
   *
   * The union of both is deliberate. Reading org membership alone would break
   * any seller whose organization backfill never ran; reading direct ownership
   * alone was the bug — org staff own no stores of their own, so a `seller_user`
   * asking for a store legitimately assigned to them was refused.
   */
  private static async resolveSellerStoreIds(user: AuthUser, storeId?: string) {
    const { storeIds, hasOrg, hasSellerRow } = await resolveAccessibleStoreIds(user);

    if (!hasOrg && !hasSellerRow) {
      throw { status: 403, message: 'Only registered sellers can view store orders.' };
    }

    if (!storeId || storeId === 'ALL') {
      return storeIds;
    }

    if (!storeIds.includes(storeId)) {
      throw { status: 404, message: 'Store not found.' };
    }

    return [storeId];
  }

  static async getStoreOrders(
    user: AuthUser,
    storeId: string | undefined,
    query: {
      status?: ORDERSTATUS;
      search?: string;
      sortOrder?: 'asc' | 'desc';
      page: number;
      limit: number;
      skip: number;
    },
  ) {
    const storeIds = await this.resolveSellerStoreIds(user, storeId);

    // Filtering, searching, sorting and pagination all run in the database —
    // the client renders the page it asked for instead of post-processing
    // the store's entire order history.
    const { items, total } = await OrderRepository.getStoreOrdersPage(storeIds, {
      status: query.status,
      search: query.search,
      sortOrder: query.sortOrder,
      skip: query.skip,
      take: query.limit,
    });

    return buildPage(items, total, { page: query.page, limit: query.limit });
  }

  /**
   * Every order on the platform, for the admin console.
   *
   * `getStoreOrders` resolves the caller's seller profile and 403s without one,
   * so an administrator could not use it — which is why `/admin/orders` was
   * rendering a hardcoded array of invented US orders in dollars instead.
   * See FLAGS.md ADM-3. Authorization is the route's `requireAdmin`.
   */
  static async getAllOrders(query: {
    status?: ORDERSTATUS;
    search?: string;
    sortOrder?: 'asc' | 'desc';
    page: number;
    limit: number;
    skip: number;
  }) {
    const { items, total } = await OrderRepository.getStoreOrdersPage(null, {
      status: query.status,
      search: query.search,
      sortOrder: query.sortOrder,
      skip: query.skip,
      take: query.limit,
    });

    return buildPage(items, total, { page: query.page, limit: query.limit });
  }

  static async getStoreOrderStats(user: AuthUser, storeId?: string) {
    const storeIds = await this.resolveSellerStoreIds(user, storeId);

    const { totalRevenue, statusCounts, lowStockCount } =
      await OrderRepository.getStoreOrderStats(storeIds);

    return {
      totalRevenue,
      pendingCount: statusCounts.PENDING + statusCounts.PROCESSING + statusCounts.READY_FOR_PICKUP,
      fulfilledCount: statusCounts.COMPLETED,
      statusCounts,
      lowStockCount,
    };
  }

  static async updateFulfillmentStatus(user: AuthUser, orderId: string, inputStatus: string) {
    const statusUpper = (inputStatus || '').toUpperCase();
    let normalizedStatus: ORDERSTATUS;

    if (['PREPARING', 'PROCESSING'].includes(statusUpper)) {
      normalizedStatus = 'PROCESSING';
    } else if (['READY_FOR_PICKUP', 'READY'].includes(statusUpper)) {
      normalizedStatus = 'READY_FOR_PICKUP';
    } else if (['COMPLETED', 'PICKED_UP', 'SHIPPED', 'FULFILLED'].includes(statusUpper)) {
      normalizedStatus = 'COMPLETED';
    } else if (['CANCELLED', 'CANCELED'].includes(statusUpper)) {
      normalizedStatus = 'CANCELLED';
    } else {
      throw {
        status: 400,
        message: `Invalid status '${inputStatus}'. Allowed: PREPARING, READY_FOR_PICKUP, COMPLETED, CANCELLED`,
      };
    }

    const order = await prisma.orders.findUnique({
      where: { id: orderId },
      include: { buyer: true },
    });
    if (!order) throw { status: 404, message: 'Order not found.' };

    validateOrderTransition(order.status, normalizedStatus);

    if (normalizedStatus === 'COMPLETED') {
      return this.completeOrder(user, orderId, order.storeId);
    }
    if (normalizedStatus === 'CANCELLED') {
      // Pre-existing: cancelOrder is buyer-scoped (it requires a `Buyers` row
      // and matches `order.buyerId`), so this branch has never worked for a
      // seller of any kind. Left as-is — changing who may cancel is a separate
      // decision from store scoping.
      return this.cancelOrder(user.id, orderId);
    }

    await assertStoreInScope(user, order.storeId);

    const updated = await OrderRepository.updateOrderStatus(orderId, normalizedStatus);

    try {
      const titles: Record<string, string> = {
        PROCESSING: 'Order is being prepared',
        READY_FOR_PICKUP: 'Order is ready for pickup!',
      };
      const title = titles[normalizedStatus] || `Order status updated to ${normalizedStatus}`;
      emitNotificationToUser(order.buyer.userId, {
        id: orderId,
        title,
        body: `Your order status changed to ${normalizedStatus.replace(/_/g, ' ')}.`,
        metadata: { orderId, status: normalizedStatus, type: 'ORDER_UPDATED' },
        sentAt: new Date().toISOString(),
      });
    } catch {
      // non-critical socket emission
    }

    return updated;
  }
}
