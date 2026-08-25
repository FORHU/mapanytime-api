import { Request, Response, NextFunction } from 'express';
import PaymentService from './payment.service';

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
 */
export const mockWebhook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (process.env.NODE_ENV === 'production' && !req.headers['x-mock-secret']) {
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
