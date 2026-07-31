import { Router } from 'express';
import PayoutController from './payout.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

router.get('/seller/:sellerId', authenticate, PayoutController.getSellerPayouts);
router.post('/', authenticate, PayoutController.createPayout);
router.patch('/:id/status', authenticate, PayoutController.updatePayoutStatus);

export default router;
