import { Router } from 'express';
import { getQrPayload, mockWebhook } from '../controllers/payment.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/qr-payload/:orderId', authenticate, getQrPayload);
router.post('/mock-webhook', mockWebhook);

export default router;
