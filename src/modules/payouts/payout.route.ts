import { Router } from 'express';
import PayoutController from './payout.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/admin.middleware';

const router = Router();

// A seller's own payout history.
router.get('/me', authenticate, PayoutController.getMyPayouts);

// Admin-only. Creating a payout moves real money and marking one COMPLETED
// asserts that it left; with `authenticate` alone any signed-in user could pay
// any seller and then declare the transfer done.
router.get('/seller/:sellerId', authenticate, requireAdmin, PayoutController.getSellerPayouts);
router.post('/', authenticate, requireAdmin, PayoutController.createPayout);
router.patch('/:id/status', authenticate, requireAdmin, PayoutController.updatePayoutStatus);

export default router;
