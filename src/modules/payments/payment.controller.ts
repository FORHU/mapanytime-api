import { Request, Response, NextFunction } from 'express';
import PaymentService from './payment.service';
import {
  isSafeOrderId,
  verifyOrderReturnToken,
  resolveReturnOutcome,
  renderReturnPage,
  MAX_REFRESHES,
} from './payment-return';

export const getActiveMethods = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Optional: with an amount the response carries each method's real fee for
    // this basket and gates the ones that do not apply to it.
    const rawAmount = req.query.amount;
    const amount = rawAmount === undefined ? undefined : Number(rawAmount);
    if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
      return res
        .status(400)
        .json({ success: false, message: 'amount must be a non-negative number.' });
    }

    const providers = await PaymentService.getActivePaymentMethods(amount);
    return res.status(200).json({
      success: true,
      message: 'Active payment methods retrieved successfully.',
      data: { providers },
    });
  } catch (error) {
    next(error);
  }
};

export const initiatePayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { orderId } = req.params;
    const { paymentMethodId, customer } = req.body;

    if (!paymentMethodId) {
      return res.status(400).json({ success: false, message: 'paymentMethodId is required.' });
    }

    const result = await PaymentService.initiateOrderPayment(
      userId,
      orderId,
      paymentMethodId,
      customer,
    );

    return res.status(200).json({
      success: true,
      message: 'Payment session created successfully.',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const getPaymentStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { orderId } = req.params;
    const status = await PaymentService.getPaymentStatusByOrderId(userId, orderId);

    return res.status(200).json({
      success: true,
      data: status,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * The page the buyer's browser lands on after paying.
 *
 * Unauthenticated by necessity: the in-app browser returning from GCash is not
 * the app's HTTP client and carries no bearer token. The signed `t` parameter,
 * minted when the checkout session was created, stands in for that.
 *
 * This is a *display* endpoint. It never writes, and it never treats the
 * `status` Xendit appended as proof of anything — the webhook is what settles a
 * payment, and this only reports what the webhook already recorded.
 */
export const handleXenditReturn = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId, t } = req.query;
    const returned = req.query.status === 'cancelled' ? 'cancelled' : 'success';
    const attempt = Number.parseInt(String(req.query.n ?? '0'), 10) || 0;

    if (!isSafeOrderId(orderId) || !verifyOrderReturnToken(orderId, t)) {
      return res
        .status(400)
        .type('html')
        .send(renderReturnPage({ outcome: 'invalid', orderId: '' }));
    }

    const record = await PaymentService.getReturnPageStatus(orderId);
    const outcome = record
      ? resolveReturnOutcome(record.paymentStatus, record.orderStatus, returned)
      : 'waiting';

    // The redirect normally beats the webhook, so the first load usually reads
    // PENDING. Self-refresh while that can still change, but bound it — a
    // genuinely abandoned payment should not leave a phone reloading forever.
    // The counter rides in the URL because there is no session to keep it in.
    const refreshUrl =
      outcome === 'waiting' && attempt < MAX_REFRESHES
        ? `?orderId=${orderId}&status=${returned}&t=${encodeURIComponent(t as string)}` +
          `&n=${attempt + 1}`
        : undefined;

    return res.status(200).type('html').send(renderReturnPage({ outcome, orderId, refreshUrl }));
  } catch (error) {
    next(error);
  }
};

export const handleProviderWebhook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const provider = req.params.provider || 'paymongo';
    const signature =
      (req.headers['paymongo-signature'] as string) ||
      (req.headers['x-callback-token'] as string) ||
      (req.headers['x-signature'] as string) ||
      '';

    // app.ts captures the unparsed bytes via express.json({ verify }). Falling
    // back to a re-serialised body would change key order and whitespace, and
    // the provider HMAC is over the bytes as sent — so a missing rawBody is a
    // verification failure, not something to paper over.
    // See FLAGS.md.
    const rawBody = (req as Request & { rawBody?: Buffer | string }).rawBody;
    if (!rawBody) {
      return res.status(400).json({
        success: false,
        message: 'Raw request body unavailable; cannot verify webhook signature.',
      });
    }

    const result = await PaymentService.processProviderWebhook(
      provider,
      rawBody,
      signature,
      req.body,
    );

    return res.status(200).json({
      success: true,
      message: 'Webhook processed successfully.',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Development-only shortcut for driving a payment to COMPLETED without a
 * gateway. MockProvider.verifyWebhook returns true unconditionally, so this
 * route is an unauthenticated "mark any order paid" endpoint if it is ever
 * reachable in production — hence both the guard here and the mount-time guard
 * in payment.route.ts. See FLAGS.md.
 *
 * The guard below refuses production outright. It previously allowed a caller
 * to pass by sending any `x-mock-secret` header at all: the header's presence
 * was the whole check, its value never compared against a configured secret,
 * and no such secret exists anywhere in the codebase. Unreachable in practice,
 * because the route is not mounted in production — but it would have become an
 * open endpoint the moment anyone moved the mount out of its `!isProduction`
 * block, trusting the guard here to hold. Do not reintroduce an escape hatch.
 */
export const mockWebhook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res
        .status(403)
        .json({ success: false, message: 'Mock payment webhook is disabled in production' });
    }

    const signature = 'mock_signature';
    const rawBody = JSON.stringify(req.body);
    const result = await PaymentService.processProviderWebhook('MOCK', rawBody, signature, {
      data: {
        id: req.body.referenceNumber || `mock_evt_${Date.now()}`,
        type: req.body.status === 'COMPLETED' ? 'payment.paid' : 'payment.failed',
        attributes: {
          data: {
            attributes: {
              reference_number: req.body.orderId,
            },
          },
        },
      },
    });

    return res.status(200).json({
      success: true,
      message: `Mock webhook processed`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
