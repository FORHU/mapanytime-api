import { Router } from 'express';
import ReturnController from './return.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

router.post('/', authenticate, ReturnController.createReturn);
router.get('/buyer/:buyerId?', authenticate, ReturnController.getBuyerReturns);
// Scoped to the caller's own seller profile; the path id is ignored.
router.get('/seller/:sellerId?', authenticate, ReturnController.getSellerReturns);
router.patch('/:id/status', authenticate, ReturnController.updateReturnStatus);

export default router;
