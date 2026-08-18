import { Request, Response, NextFunction } from 'express';
import PaymentService from './payment.service';
import { PAYMENTSTATUS } from '@prisma/client';

export const getQrPayload = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    const { orderId } = req.params;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const payload = await PaymentService.generateQrPayload(userId, orderId);

    return res.status(200).json({
      success: true,
      message: 'QR Payload generated successfully',
      data: payload,
    });
  } catch (error) {
    next(error);
  }
};

export const mockWebhook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (process.env.NODE_ENV === 'production' && !req.headers['x-mock-secret']) {
      return res
        .status(403)
        .json({ success: false, message: 'Mock payment webhook is disabled in production' });
    }

    const { orderId, status, referenceNumber } = req.body;

    if (!orderId || !status) {
      return res.status(400).json({ success: false, message: 'orderId and status are required' });
    }

    const updatedPayment = await PaymentService.processMockWebhook(
      orderId,
      status as PAYMENTSTATUS,
      referenceNumber,
    );

    return res.status(200).json({
      success: true,
      message: `Mock webhook processed: ${status}`,
      data: updatedPayment,
    });
  } catch (error) {
    next(error);
  }
};

export const paymongoWebhook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const signature = req.headers['paymongo-signature'] as string;
    if (!signature) {
      return res.status(400).json({ success: false, message: 'Missing PayMongo signature' });
    }

    const { PayMongoProvider } = await import('./providers/paymongo.provider');
    const provider = new PayMongoProvider();

    if (!provider.verifyWebhook(req.body, signature)) {
      return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
    }

    const event = req.body.data;
    if (event.type === 'link.payment.paid') {
      const attributes = event.attributes.data.attributes;
      const orderId = attributes.reference_number || attributes.remarks?.replace('Order ID: ', '');
      
      if (orderId) {
        await PaymentService.processMockWebhook(orderId, 'COMPLETED', event.id);
      }
    }

    return res.status(200).send('Webhook processed');
  } catch (error) {
    next(error);
  }
};
