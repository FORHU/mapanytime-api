import OrderRepository, { LOW_STOCK_THRESHOLD } from './order.repository';
import ProductRepository from '../products/product.repository';
import { computeItemDiscount } from './pricing.util';
import { validateOrderTransition } from './order.state';
import { prisma } from '../../utils/prisma';
import { emitNotificationToUser } from '../../infrastructure/socket';
import { buildPage } from '../../helpers/pagination.helper';
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
import NotificationService from '../notifications/notification.service';
import logger from '../../utils/logger';

/**
 * Grace period after the booked pickup time before the hold lapses. A buyer who
 * turns up a little late should still find their goods there.
 */
const PICKUP_GRACE_MS = 2 * 60 * 60 * 1000;

/** Fallback hold for an order with no pickup time — the old flat TTL. */
const DEFAULT_RESERVATION_TTL_MS = 15 * 60 * 1000;

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

        await tx.inventory.update({
          where: { id: inventory.id },
          data: {
            quantityReserved: { increment: item.quantity },
          },
        });

        await tx.inventoryReservations.create({
          data: {
            inventoryId: inventory.id,
            buyerId: payload.buyerId,
            quantity: item.quantity,
            status: 'RESERVED',
            expiresAt: resolveReservationExpiry(payload.pickupAt),
          },
        });
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

      // Link newly created reservations to the order
      await tx.inventoryReservations.updateMany({
        where: {
          buyerId: payload.buyerId,
          orderId: null,
          status: 'RESERVED',
        },
        data: {
          orderId: createdOrder.id,
        },
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

  static async completeOrder(userId: string, orderId: string, storeId: string) {
    const seller = await ProductRepository.getSellerByUserId(userId);
    if (!seller || seller.applicationStatus !== 'APPROVED') {
      throw { status: 403, message: 'User is not an approved seller profile.' };
    }

    const store = await ProductRepository.getStoreById(storeId);
    if (!store || store.sellerId !== seller.id) {
      throw { status: 403, message: 'You do not have administrative access to this branch.' };
    }

    // Populated inside the transaction, read after it commits — see below.
    const lowStockAlerts: { productId: string; productName: string; quantityOnHand: number }[] = [];

    const completed = await prisma.$transaction(async (tx) => {
      const order = await OrderRepository.getOrderById(orderId, tx);

      if (!order) throw new Error('Order not found.');
      if (order.storeId !== storeId) throw new Error('Unauthorized store fulfillment.');

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

        await tx.inventory.update({
          where: { id: inventory.id },
          data: {
            quantityOnHand: { decrement: item.quantity },
            quantityReserved: { decrement: item.quantity },
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

      await tx.inventoryReservations.updateMany({
        where: { orderId: orderId, status: 'RESERVED' },
        data: { status: 'CONSUMED' },
      });

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

      return completed;
    });

    for (const alert of lowStockAlerts) {
      try {
        await NotificationService.sendNotification({
          userId: seller.userId,
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
      throw { status: 403, message: 'Unauthorized. You do not own this order.' };
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
    // stamped FAILED. See PICKUP-NEXT.md S3.
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

        for (const item of order.orderitems) {
          const inventory = await tx.inventory.findFirst({
            where: { productId: item.productId },
          });

          if (!inventory)
            throw new Error(`Inventory tracking ledger missing for product ID ${item.productId}.`);

          await tx.inventory.update({
            where: { id: inventory.id },
            data: {
              quantityReserved: { decrement: item.quantity },
            },
          });
        }

        await tx.inventoryReservations.updateMany({
          where: { orderId: orderId, status: 'RESERVED' },
          data: { status: 'RELEASED' },
        });

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
  private static async resolveSellerStoreIds(userId: string, storeId?: string) {
    const seller = await prisma.sellers.findUnique({
      where: { userId: userId },
      include: { stores: true },
    });

    if (!seller) {
      throw { status: 403, message: 'Only registered sellers can view store orders.' };
    }

    const sellerStoreIds = seller.stores.map((s) => s.id);

    if (!storeId || storeId === 'ALL') {
      return sellerStoreIds;
    }

    if (!sellerStoreIds.includes(storeId)) {
      throw { status: 403, message: 'Unauthorized store access.' };
    }

    return [storeId];
  }

  static async getStoreOrders(
    userId: string,
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
    const storeIds = await this.resolveSellerStoreIds(userId, storeId);

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

  static async getStoreOrderStats(userId: string, storeId?: string) {
    const storeIds = await this.resolveSellerStoreIds(userId, storeId);

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

  static async updateFulfillmentStatus(userId: string, orderId: string, inputStatus: string) {
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
      return this.completeOrder(userId, orderId, order.storeId);
    }
    if (normalizedStatus === 'CANCELLED') {
      return this.cancelOrder(userId, orderId);
    }

    const seller = await prisma.sellers.findUnique({ where: { userId } });
    if (!seller) throw { status: 403, message: 'Only registered sellers can update order status.' };
    const store = await prisma.stores.findUnique({ where: { id: order.storeId } });
    if (!store || store.sellerId !== seller.id) {
      throw { status: 403, message: 'Unauthorized. You do not own the store for this order.' };
    }

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
