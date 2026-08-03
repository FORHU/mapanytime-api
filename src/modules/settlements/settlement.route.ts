import { Router } from 'express';
import SettlementController from './settlement.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

router.get('/seller/:sellerId', authenticate, SettlementController.getSellerSettlements);
router.get('/order/:orderId', authenticate, SettlementController.getOrderSettlement);
router.patch('/:id/status', authenticate, SettlementController.updateSettlementStatus);

export default router;
