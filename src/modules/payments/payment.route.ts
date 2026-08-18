import { Router } from 'express';
import { getQrPayload, mockWebhook, paymongoWebhook } from './payment.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

router.get('/qr-payload/:orderId', authenticate, getQrPayload);
router.post('/mock-webhook', mockWebhook);
router.post('/webhook/paymongo', paymongoWebhook);

export default router;
