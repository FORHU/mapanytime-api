import { PAYMENTSTATUS, PAYMENTMETHODTYPE, Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { emitNotificationToUser } from '../../infrastructure/socket';
import { PaymentProvider } from './providers/payment-provider.interface';
import { PayMongoProvider } from './providers/paymongo.provider';
import { MockProvider } from './providers/mock.provider';
import { XenditProvider } from './providers/xendit.provider';
import { StripeProvider } from './providers/stripe.provider';
import PricingEngineService, { OrderPricingResult } from '../pricing/pricing-engine.service';
import InventoryStockRepository from '../inventory/inventoryStock.repository';
import logger from '../../utils/logger';
import { recordGatewayFeeKeptOnRefund } from './refund-ledger';

/** Peso amount for buyer-facing copy: `1500` -> `₱1,500`. */
const formatPeso = (amount: number) => `₱${amount.toLocaleString('en-PH')}`;

/**
 * Values of the removed PAYMENTMETHOD enum that name a channel rather than a
 * type, mapped onto the seeded PaymentMethods.code they now mean. Kept for
 * app builds already installed before the checkout flow moved to sending
 * `code: 'COD'` directly — current source no longer emits `CASH_ON_DELIVERY`,
 * but old clients in the field still can until they update.
 */
const LEGACY_METHOD_CODE_ALIASES: Record<string, string> = {
  CASH_ON_DELIVERY: 'COD',
  CASH: 'COD',
};

/** Legacy values that name a PAYMENTMETHODTYPE rather than a single channel. */
const LEGACY_METHOD_TYPES = ['E_WALLET', 'BANK', 'CARD', 'QR', 'OTHER'] as const;

export default class PaymentService {
  /**
   * Resolves the appropriate provider adapter by provider code.
   *
   * PayMongo is only handed out when a secret key is actually configured.
   * PayMongo has no separate sandbox host — test and live both post to
   * api.paymongo.com and the mode is decided by the key prefix — so an empty
   * key is not "sandbox mode", it is an unauthenticated call to the production
   * host that 401s. Since the seeder activates PAYMONGO at priority 1, that
   * 401 would surface inside the order-creation transaction and roll the whole
   * order back. Falling back to MockProvider keeps a keyless environment
   * working, which is what the pre-rework code did.
   * See FLAGS.md.
   */
  static getProviderAdapter(providerCode: string): PaymentProvider {
    switch (providerCode.toUpperCase()) {
      case 'PAYMONGO':
        if (!process.env.PAYMONGO_SECRET_KEY) {
          this.warnUnconfigured('PAYMONGO', 'PAYMONGO_SECRET_KEY');
          return new MockProvider();
        }
        return new PayMongoProvider();
      case 'XENDIT':
        if (!process.env.XENDIT_SECRET_KEY) {
          this.warnUnconfigured('XENDIT', 'XENDIT_SECRET_KEY');
          return new MockProvider();
        }
        return new XenditProvider();
      case 'STRIPE':
        if (!process.env.STRIPE_SECRET_KEY) {
          this.warnUnconfigured('STRIPE', 'STRIPE_SECRET_KEY');
          return new MockProvider();
        }
        return new StripeProvider();
      case 'MOCK':
      default:
        return new MockProvider();
    }
  }

  /**
   * Warn once per provider that it is running on the mock.
   *
   * `getActivePaymentMethods` calls `getProviderAdapter` to decide what to
   * offer (F83), and that endpoint is public and unauthenticated — so warning
   * on every fallback meant a line per unconfigured provider per checkout page
   * load. Once per process keeps the state visible without burying the log.
   */
  private static warnedUnconfigured = new Set<string>();
  private static warnUnconfigured(providerCode: string, envVar: string) {
    if (this.warnedUnconfigured.has(providerCode)) return;
    this.warnedUnconfigured.add(providerCode);
    console.warn(
      `[payments] ${envVar} is not set — ${providerCode} falls back to MockProvider and is ` +
        'hidden from checkout. Real checkout sessions will not be created.',
    );
  }

  /**
   * Resolves a payment method from either an explicit id or a method code.
   *
   * `paymentMethod` is the legacy free-string field: clients still in flight
   * send the old PAYMENTMETHOD enum values, which are a mix of codes and types
   * under the new model — `CASH_ON_DELIVERY` is the `COD` code, while
   * `E_WALLET` and `BANK` are `PAYMENTMETHODTYPE`s with several codes each. So
   * we try id, then code, then legacy alias, then type, and give up.
   *
   * There is deliberately no "just pick any active method" fallback. The old
   * one was an unordered findFirst, which resolved a buyer's cash-on-pickup
   * choice to whichever row Postgres happened to return first.
   * See FLAGS.md.
   */
  static async resolvePaymentMethod(
    client: Pick<typeof prisma, 'paymentMethods'>,
    input: { paymentMethodId?: string; paymentMethod?: string },
  ) {
    if (input.paymentMethodId) {
      const byId = await client.paymentMethods.findUnique({
        where: { id: input.paymentMethodId },
        include: { provider: true },
      });
      if (byId?.isActive && byId.provider.isActive) return byId;
      throw { status: 400, message: 'Selected payment method is currently unavailable.' };
    }

    if (!input.paymentMethod) {
      throw { status: 400, message: 'A paymentMethodId or paymentMethod is required.' };
    }

    const raw = input.paymentMethod.toUpperCase();
    const code = LEGACY_METHOD_CODE_ALIASES[raw] ?? raw;

    const byCode = await client.paymentMethods.findFirst({
      where: { code, isActive: true, provider: { isActive: true } },
      orderBy: { priority: 'asc' },
      include: { provider: true },
    });
    if (byCode) return byCode;

    // `E_WALLET` / `BANK` / `CARD` name a type, not a single channel.
    if ((LEGACY_METHOD_TYPES as readonly string[]).includes(raw)) {
      const byType = await client.paymentMethods.findFirst({
        where: {
          type: raw as PAYMENTMETHODTYPE,
          isActive: true,
          provider: { isActive: true },
        },
        orderBy: { priority: 'asc' },
        include: { provider: true },
      });
      if (byType) return byType;
    }

    throw {
      status: 400,
      message: `Unknown or inactive payment method: ${input.paymentMethod}`,
    };
  }

  /**
   * Returns active payment providers and active payment channels for frontend checkout.
   *
   * When `amount` is supplied, each method additionally carries what it would
   * actually cost the buyer and whether it may be used for a basket that size.
   * The buyer picks from this list, so the fee is known before the checkout
   * session is created and the engine can price the exact method chosen —
   * rather than letting PayMongo's hosted page decide after the fact.
   */
  static async getActivePaymentMethods(amount?: number) {
    const providers = await prisma.paymentProviders.findMany({
      where: { isActive: true },
      orderBy: { priority: 'asc' },
      include: {
        methods: {
          where: { isActive: true },
          orderBy: { priority: 'asc' },
          select: {
            id: true,
            code: true,
            name: true,
            description: true,
            type: true,
            minOrderAmount: true,
            maxOrderAmount: true,
          },
        },
      },
    });

    // The mock provider accepts any signature and any payment. It is gated at
    // the webhook, but the *method* was still offered in the picker, so a
    // production checkout could list "Mock Sandbox" as a way to pay.
    // See FLAGS.md F33.
    //
    // Hiding the MOCK row alone was not enough. `getProviderAdapter` falls back
    // to MockProvider for any provider whose secret key is unset, and
    // MockProvider returns a null checkoutUrl — so an unconfigured gateway was
    // still offered, the buyer picked GCash, an order and a PENDING payment
    // were created, and nothing could ever pay it. Offering a way to pay that
    // cannot take money is worse than offering nothing: the buyer has
    // committed before finding out. A provider is listed only if its real
    // adapter resolves. See FLAGS.md F83.
    const offerable = providers.filter((provider) => {
      if (provider.code === 'MOCK') return process.env.NODE_ENV !== 'production';

      // Cash never reaches a gateway — `isCashPayment` short-circuits pricing
      // and no checkout session is created — so it has no adapter and must not
      // be judged by one. `getProviderAdapter` has no CASH case and falls
      // through to its default, which is MockProvider, so testing it here
      // would delete Pay on Pickup from the picker.
      if (provider.methods.every((method) => method.type === PAYMENTMETHODTYPE.CASH)) {
        return true;
      }

      return !(this.getProviderAdapter(provider.code) instanceof MockProvider);
    });

    // Price every method against one read of the pricing configuration. A call
    // per method re-read the configuration and its components each time —
    // roughly 15 queries on a public, unauthenticated endpoint. See FLAGS.md F37.
    const priceable = offerable.flatMap((provider) =>
      provider.methods
        .filter((method) => this.isWithinBounds(method, amount))
        .map((method) => ({ provider, method })),
    );

    const pricings =
      amount === undefined
        ? []
        : await PricingEngineService.calculateManyOrderPricing(
            priceable.map(({ provider, method }) => ({
              subtotalAmount: amount,
              providerId: provider.id,
              paymentMethodId: method.id,
              paymentMethodCode: method.code,
              paymentMethodType: method.type,
            })),
          );

    const pricingByMethodId = new Map(priceable.map(({ method }, i) => [method.id, pricings[i]]));

    return offerable.map((provider) => ({
      id: provider.id,
      code: provider.code,
      name: provider.name,
      description: provider.description,
      methods: provider.methods.map((method) =>
        this.describeMethod(method, amount, pricingByMethodId.get(method.id)),
      ),
    }));
  }

  /** True when this basket falls inside the method's configured order bounds. */
  private static isWithinBounds(
    method: { minOrderAmount: Prisma.Decimal | null; maxOrderAmount: Prisma.Decimal | null },
    amount?: number,
  ): boolean {
    if (amount === undefined) return true;
    const min = method.minOrderAmount ? Number(method.minOrderAmount) : null;
    const max = method.maxOrderAmount ? Number(method.maxOrderAmount) : null;
    if (min !== null && amount < min) return false;
    if (max !== null && amount > max) return false;
    return true;
  }

  /**
   * One method as the checkout picker needs it: its fee for this basket, the
   * total the buyer would pay, and — when the basket falls outside the method's
   * bounds — why it is unavailable. A disabled method that explains itself
   * beats one that is merely greyed out.
   */
  private static describeMethod(
    method: {
      id: string;
      code: string;
      name: string;
      description: string | null;
      type: PAYMENTMETHODTYPE;
      minOrderAmount: Prisma.Decimal | null;
      maxOrderAmount: Prisma.Decimal | null;
    },
    amount?: number,
    pricing?: OrderPricingResult,
  ) {
    const base = {
      id: method.id,
      code: method.code,
      name: method.name,
      description: method.description,
      type: method.type,
    };

    if (amount === undefined) return { ...base, available: true };

    const min = method.minOrderAmount ? Number(method.minOrderAmount) : null;
    const max = method.maxOrderAmount ? Number(method.maxOrderAmount) : null;

    if (min !== null && amount < min) {
      return {
        ...base,
        available: false,
        unavailableReason: `${method.name} is available on orders of ${formatPeso(min)} and above.`,
      };
    }

    if (max !== null && amount > max) {
      return {
        ...base,
        available: false,
        unavailableReason: `${method.name} is available on orders up to ${formatPeso(max)}.`,
      };
    }

    if (!pricing) return { ...base, available: true };

    return {
      ...base,
      available: true,
      feeAmount: pricing.buyerTransactionFee.totalBuyerFeeAmount,
      buyerTotalAmount: pricing.buyerTotalAmount,
    };
  }

  /**
   * Initiates payment for an order through the selected payment method.
   */
  /**
   * Asserts the authenticated user is a party to this order — its buyer, or the
   * seller of the fulfilling store. `authenticate` only establishes who the
   * caller is; without this any signed-in user could read or pay any order id
   * they could guess. See FLAGS.md.
   *
   * Deliberately a 404 rather than a 403: confirming that an order id exists is
   * itself the enumeration signal worth withholding.
   */
  static async assertOrderAccess(userId: string, orderId: string) {
    const order = await prisma.orders.findFirst({
      where: {
        id: orderId,
        OR: [{ buyer: { userId } }, { store: { seller: { userId } } }],
      },
      select: { id: true },
    });

    if (!order) {
      throw { status: 404, message: 'Order not found.' };
    }
  }

  static async initiateOrderPayment(
    userId: string,
    orderId: string,
    paymentMethodId: string,
    customer?: { name?: string; email?: string; phone?: string },
  ) {
    await this.assertOrderAccess(userId, orderId);

    const order = await prisma.orders.findUnique({
      where: { id: orderId },
      include: {
        orderitems: {
          include: {
            product: { select: { name: true } },
          },
        },
        store: { select: { storeName: true } },
      },
    });

    if (!order) {
      throw { status: 404, message: 'Order not found.' };
    }

    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
      throw { status: 400, message: `Cannot initiate payment for ${order.status} order.` };
    }

    const method = await prisma.paymentMethods.findUnique({
      where: { id: paymentMethodId },
      include: { provider: true },
    });

    if (!method || !method.isActive || !method.provider.isActive) {
      throw { status: 400, message: 'Selected payment method is currently unavailable.' };
    }

    const provider = this.getProviderAdapter(method.provider.code);
    const amountInCentavos = Math.round(Number(order.totalAmount) * 100);

    const lineItems = order.orderitems.map((item) => ({
      name: item.product?.name || `Product ${item.productId}`,
      quantity: item.quantity,
      amount: Math.round(Number(item.unitPrice) * 100),
      currency: 'PHP',
    }));

    const checkoutResult = await provider.createCheckoutSession({
      orderId: order.id,
      amountInCentavos,
      currency: 'PHP',
      description: `Order ${order.id} - ${order.store?.storeName || 'Marketplace Store'}`,
      lineItems,
      customer,
      paymentMethodCode: method.code,
      metadata: {
        orderId: order.id,
        storeId: order.storeId,
        paymentMethodCode: method.code,
      },
    });

    // createOrder already opened a PENDING row for this order, so reuse it
    // rather than stacking a second one. Both this and the webhook resolve a
    // payment with findFirst(createdAt desc), so a second row would strand the
    // first in PENDING forever holding a checkout session nobody reconciles.
    // See FLAGS.md.
    const sessionFields = {
      currency: 'PHP',
      providerId: method.provider.id,
      paymentMethodId: method.id,
      status: PAYMENTSTATUS.PENDING,
      checkoutSessionId: checkoutResult.checkoutSessionId,
      paymentIntentId: checkoutResult.paymentIntentId,
      checkoutUrl: checkoutResult.checkoutUrl,
      rawResponse: checkoutResult.rawResponse
        ? (checkoutResult.rawResponse as Prisma.InputJsonValue)
        : undefined,
    };

    const reusable = await prisma.payments.findFirst({
      where: { orderId: order.id, status: PAYMENTSTATUS.PENDING },
      orderBy: { createdAt: 'desc' },
    });

    const payment = reusable
      ? await prisma.payments.update({ where: { id: reusable.id }, data: sessionFields })
      : await prisma.payments.create({
          data: { orderId: order.id, amount: order.totalAmount, ...sessionFields },
        });

    return {
      paymentId: payment.id,
      checkoutUrl: checkoutResult.checkoutUrl,
      checkoutSessionId: checkoutResult.checkoutSessionId,
      status: payment.status,
    };
  }

  /**
   * Retrieves current payment & order status for frontend polling on return.
   */
  static async getPaymentStatusByOrderId(userId: string, orderId: string) {
    await this.assertOrderAccess(userId, orderId);

    const payment = await prisma.payments.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      include: {
        order: { select: { id: true, status: true, totalAmount: true } },
        provider: { select: { code: true, name: true } },
        paymentMethod: { select: { code: true, name: true, type: true } },
      },
    });

    if (!payment) {
      throw { status: 404, message: 'Payment record not found for this order.' };
    }

    return {
      orderId: payment.orderId,
      paymentId: payment.id,
      orderStatus: payment.order.status,
      paymentStatus: payment.status,
      amount: Number(payment.amount),
      currency: payment.currency,
      provider: payment.provider?.name || 'Unknown',
      paymentMethod: payment.paymentMethod?.name || 'Default',
      paidAt: payment.paidAt,
    };
  }

  /**
   * Payment and order status for the unauthenticated post-payment return page.
   *
   * Deliberately narrower than `getPaymentStatusByOrderId`. There is no user to
   * scope by — the browser coming back from the gateway holds no token, and the
   * signed `t` parameter on the URL is what establishes it was sent here by us
   * — so this returns only the two status values that page renders, never the
   * amount, buyer, store or line items.
   *
   * Returns null when no payment row exists yet, which the caller renders as
   * "still confirming" rather than as an error: the buyer's browser routinely
   * beats our own write.
   */
  static async getReturnPageStatus(orderId: string) {
    const payment = await prisma.payments.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      select: {
        status: true,
        order: { select: { status: true } },
      },
    });

    if (!payment) return null;

    return {
      paymentStatus: payment.status as string,
      orderStatus: payment.order.status as string,
    };
  }

  /**
   * Authoritative Webhook Processor with signature validation and deduplication.
   */
  static async processProviderWebhook(
    providerCode: string,
    rawBody: string | Buffer,
    signatureHeader: string,
    payload: unknown,
  ) {
    const providerRecord = await prisma.paymentProviders.findUnique({
      where: { code: providerCode.toUpperCase() },
    });

    if (!providerRecord) {
      throw { status: 404, message: `Unknown payment provider: ${providerCode}` };
    }

    // MockProvider accepts any signature, so a reachable mock webhook is an
    // unauthenticated "mark any order paid" endpoint. Removing the /mock-webhook
    // route is not enough on its own — /webhook/:provider reaches the same
    // processor, and payments.seeder.ts activates the MOCK provider row
    // unconditionally. Enforced here so every route in is covered.
    // See FLAGS.md.
    const adapter = this.getProviderAdapter(providerRecord.code);

    // Test the adapter actually in use, not the row's code. `getProviderAdapter`
    // falls back to MockProvider whenever a provider's secret key is missing, so
    // an unset XENDIT_SECRET_KEY in production left `providerRecord.code` as
    // 'XENDIT' — the old check passed — while the adapter verifying the webhook
    // was the mock, which returns true for any signature. A missing environment
    // variable was one step from an open "mark any order paid" endpoint on
    // /webhook/xendit and /webhook/paymongo alike.
    if (adapter instanceof MockProvider && process.env.NODE_ENV === 'production') {
      throw { status: 403, message: 'Mock payment webhooks are disabled in production.' };
    }

    // 1. Signature validation
    const isValid = adapter.verifyWebhook(rawBody, signatureHeader);
    if (!isValid) {
      throw { status: 400, message: 'Invalid webhook signature.' };
    }

    // 2. Normalize the provider's own payload shape into the generic event
    // shape — each gateway's webhook JSON is structurally different
    // (PayMongo's nested envelope vs. Xendit's flat {event, data}), so
    // that difference is contained in the adapter, not hardcoded here.
    const { eventId, eventType, orderId, isSuccess, isFailure, providerReference, failureReason } =
      adapter.parseWebhookEvent(payload);

    // 3. Webhook Idempotency: Check if already registered/processed
    const existingEvent = await prisma.paymentWebhookEvents.findUnique({
      where: {
        providerId_eventId: {
          providerId: providerRecord.id,
          eventId,
        },
      },
    });

    if (existingEvent && existingEvent.processed) {
      return { status: 'already_processed', eventId };
    }

    if (!orderId) {
      // Record unrecognized or irrelevant event
      await prisma.paymentWebhookEvents.upsert({
        where: {
          providerId_eventId: {
            providerId: providerRecord.id,
            eventId,
          },
        },
        create: {
          providerId: providerRecord.id,
          eventId,
          eventType,
          payload: payload as Prisma.InputJsonValue,
          processed: true,
          processedAt: new Date(),
        },
        update: {
          processed: true,
          processedAt: new Date(),
        },
      });
      return { status: 'ignored_no_order_id', eventId };
    }

    // Set inside the transaction when money lands on an order the sweeper already
    // closed (F109); the refund is sent after it commits, never inside it.
    let paidOnClosedOrder = false;

    // 4. Execute state transition transactionally
    const { payment, justCompleted } = await prisma.$transaction(async (tx) => {
      // Upsert webhook event idempotency record
      await tx.paymentWebhookEvents.upsert({
        where: {
          providerId_eventId: {
            providerId: providerRecord.id,
            eventId,
          },
        },
        create: {
          providerId: providerRecord.id,
          eventId,
          eventType,
          payload: payload as Prisma.InputJsonValue,
          processed: true,
          processedAt: new Date(),
        },
        update: {
          processed: true,
          processedAt: new Date(),
        },
      });

      const existingPayment = await tx.payments.findFirst({
        where: { orderId },
        orderBy: { createdAt: 'desc' },
      });

      if (!existingPayment) {
        throw { status: 404, message: `No payment record for order: ${orderId}` };
      }

      // COMPLETED is terminal, for every event type rather than just for repeat
      // successes. Gateways retry and can deliver out of order, so a late
      // payment.failed must not walk a settled payment backwards — and §2's
      // open mock endpoint made that trivially reachable from outside.
      // See FLAGS.md.
      if (existingPayment.status === PAYMENTSTATUS.COMPLETED) {
        return { payment: existingPayment, justCompleted: false };
      }

      if (isSuccess) {
        const updatedPayment = await tx.payments.update({
          where: { id: existingPayment.id },
          data: {
            status: PAYMENTSTATUS.COMPLETED,
            providerReference: providerReference || eventId,
            paidAt: new Date(),
            rawResponse: payload as Prisma.InputJsonValue,
          },
        });

        // Advance Order to PROCESSING
        const advanced = await tx.orders.updateMany({
          where: { id: orderId, status: 'PENDING' },
          data: { status: 'PROCESSING' },
        });

        // F109: money arrived for an order that is no longer waiting for it. The stale-order
        // sweeper cancels a PENDING order after 15 minutes and releases its stock; a buyer who
        // pays after that is charged for an order that no longer exists. Checkout sessions now
        // close before the sweeper runs, so this should be rare; whatever still gets through is
        // refunded automatically once this transaction commits (#117).
        if (advanced.count === 0) {
          const current = await tx.orders.findUnique({
            where: { id: orderId },
            select: { status: true },
          });
          if (current && (current.status === 'CANCELLED' || current.status === 'FAILED')) {
            paidOnClosedOrder = true;
            logger.warn(
              `[Payment] Payment ${existingPayment.id} completed for order ${orderId}, which is ` +
                `already ${current.status}. Refunding it automatically.`,
              {
                orderId,
                paymentId: existingPayment.id,
                orderStatus: current.status,
                amount: existingPayment.amount?.toString(),
                providerReference: providerReference || eventId,
              },
            );
          }
        }

        // The reservations deliberately stay RESERVED here. Payment succeeding
        // does not move any goods — they sit on the shelf, still held for this
        // buyer, until pickup. `OrderService.completeOrder` is what takes them
        // off the shelf, and it ends the hold in the same claim (F43).
        //
        // Marking them CONSUMED at this point ended the hold in name only: the
        // rows said the stock was gone while `quantityReserved` still counted
        // it, and the balancing decrement came from the order's items at
        // completion, whether or not the hold was still there to give back.

        return { payment: updatedPayment, justCompleted: true };
      } else if (isFailure) {
        const updatedPayment = await tx.payments.update({
          where: { id: existingPayment.id },
          data: {
            status: PAYMENTSTATUS.FAILED,
            failureReason: failureReason || 'Payment failed at gateway',
            rawResponse: payload as Prisma.InputJsonValue,
          },
        });

        // Give the hold back and mark the rows RELEASED in one claim (F43).
        // These were two separate steps: the updateMany flipped the rows, then
        // the loop below decremented from the order's items — so a hold the TTL
        // sweeper had already released was subtracted a second time, and
        // quantityReserved went negative.
        await InventoryStockRepository.releaseOrderReservations(tx, orderId, 'RELEASED');

        const order = await tx.orders.findUnique({
          where: { id: orderId },
          select: { status: true },
        });

        if (order && order.status === 'PENDING') {
          await tx.orders.update({
            where: { id: orderId },
            data: { status: 'FAILED' },
          });
        }

        return { payment: updatedPayment, justCompleted: false };
      }

      return { payment: existingPayment, justCompleted: false };
    });

    if (paidOnClosedOrder) {
      await this.refundPaymentOnClosedOrder(adapter, payment.id, orderId);
    }

    // 5. Asynchronous Notification Delivery
    if (justCompleted) {
      try {
        const order = await prisma.orders.findUnique({
          where: { id: orderId },
          include: {
            buyer: { select: { userId: true } },
            store: {
              include: {
                seller: { select: { userId: true } },
              },
            },
          },
        });
        // A payment that landed on an already-cancelled order (F109, logged above) must not tell
        // the seller to start preparing it, nor tell the buyer their order is confirmed.
        const orderIsLive = order?.status !== 'CANCELLED' && order?.status !== 'FAILED';
        if (orderIsLive && order?.buyer?.userId) {
          emitNotificationToUser(order.buyer.userId, {
            id: payment.id,
            title: 'Payment Confirmed',
            body: `Your payment of ₱${Number(payment.amount).toLocaleString()} for Order #${orderId} was confirmed.`,
            metadata: { orderId, type: 'PAYMENT_COMPLETED' },
            sentAt: new Date().toISOString(),
          });
        }
        if (orderIsLive && order?.store?.seller?.userId) {
          emitNotificationToUser(order.store.seller.userId, {
            id: order.id,
            title: 'New Paid Order',
            body: `Order #${orderId} (₱${Number(payment.amount).toLocaleString()}) is confirmed paid and ready for preparation.`,
            metadata: { orderId, type: 'ORDER_PAID' },
            sentAt: new Date().toISOString(),
          });
        }
      } catch {
        // Notification delivery is best-effort
      }
    }

    return { status: 'processed', orderId, paymentId: payment.id };
  }

  /**
   * Refund a payment that completed after its order was already closed (F109, #117).
   *
   * The money goes back through the provider that took it. Called after the
   * webhook's transaction commits, so a provider call never holds a database
   * transaction open, and never throws: the webhook has already been recorded,
   * and a failure here must not make the gateway retry it.
   *
   * Moving the payment from COMPLETED to REFUND_PENDING is the claim, so a
   * second caller for the same payment does nothing. If the provider refuses,
   * the payment goes back to COMPLETED and a `REFUND OWED` error is logged for a
   * person to refund it by hand, which was the only behaviour before this.
   *
   * Returns true when the money was refunded.
   */
  static async refundPaymentOnClosedOrder(
    adapter: PaymentProvider,
    paymentId: string,
    orderId: string,
  ): Promise<boolean> {
    const owed = (reason: string, details: Record<string, unknown> = {}) =>
      logger.error(
        `[Payment] REFUND OWED: payment ${paymentId} completed for closed order ${orderId}, ` +
          `and ${reason}. Refund it in the provider dashboard and reconcile.`,
        { orderId, paymentId, ...details },
      );
    const message = (error: unknown) => (error instanceof Error ? error.message : error);

    try {
      const payment = await prisma.payments.findUnique({ where: { id: paymentId } });
      if (!payment) {
        owed('its payment record could not be read');
        return false;
      }
      if (!payment.providerReference) {
        owed('it has no provider reference to refund');
        return false;
      }
      if (!adapter.refundPayment) {
        owed('this provider does not support automated refunds');
        return false;
      }

      const claimed = await prisma.payments.updateMany({
        where: { id: paymentId, status: PAYMENTSTATUS.COMPLETED },
        data: { status: PAYMENTSTATUS.REFUND_PENDING },
      });
      if (claimed.count === 0) return false;

      const amount = Number(payment.amount);
      let refundReference: string;
      try {
        const result = await adapter.refundPayment(
          payment.providerReference,
          Math.round(amount * 100),
          'requested_by_customer',
        );
        refundReference = result.refundId;
      } catch (error) {
        await prisma.payments.update({
          where: { id: paymentId },
          data: { status: PAYMENTSTATUS.COMPLETED },
        });
        owed('the automatic refund failed', { error: message(error) });
        return false;
      }

      try {
        await prisma.$transaction(async (tx) => {
          await tx.payments.update({
            where: { id: paymentId },
            data: {
              status: PAYMENTSTATUS.REFUNDED,
              refundedAmount: payment.amount,
              refundReference,
              refundedAt: new Date(),
            },
          });
          await recordGatewayFeeKeptOnRefund(tx, {
            orderId,
            paymentAmount: amount,
            totalRefunded: amount,
            refundReference,
          });
        });
      } catch (error) {
        // The money has gone back; only our record of it failed.
        logger.error(
          `[Payment] Refunded payment ${paymentId} for closed order ${orderId} at the provider ` +
            `(refund ${refundReference}), but recording it failed. It is left REFUND_PENDING; ` +
            `mark it REFUNDED by hand.`,
          { orderId, paymentId, refundReference, error: message(error) },
        );
        return true;
      }

      logger.info(
        `[Payment] Refunded ${formatPeso(amount)} for closed order ${orderId} (refund ${refundReference}).`,
      );

      try {
        const order = await prisma.orders.findUnique({
          where: { id: orderId },
          include: { buyer: { select: { userId: true } } },
        });
        if (order?.buyer?.userId) {
          emitNotificationToUser(order.buyer.userId, {
            id: paymentId,
            title: 'Payment refunded',
            body:
              `Order #${orderId} had already expired when your payment arrived, ` +
              `so your ${formatPeso(amount)} has been refunded.`,
            metadata: { orderId, type: 'REFUND_ISSUED' },
            sentAt: new Date().toISOString(),
          });
        }
      } catch {
        // Notification delivery is best-effort.
      }
      return true;
    } catch (error) {
      owed('handling it failed unexpectedly', { error: message(error) });
      return false;
    }
  }
}
