import { Router } from 'express';
import SettlementController from './settlement.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/admin.middleware';

const router = Router();

// A seller's own ledger. Takes no id from the client — see resolveOwnSellerId.
router.get('/me', authenticate, SettlementController.getMySettlements);
router.get('/me/balance', authenticate, SettlementController.getMyBalance);

// Admin-only. These read and mutate the money the platform owes; `authenticate`
// alone let any signed-in user read another seller's ledger and walk a
// settlement's status wherever they liked.
router.get(
  '/seller/:sellerId',
  authenticate,
  requireAdmin,
  SettlementController.getSellerSettlements,
);
router.get(
  '/seller/:sellerId/balance',
  authenticate,
  requireAdmin,
  SettlementController.getSellerBalance,
);
router.get('/order/:orderId', authenticate, requireAdmin, SettlementController.getOrderSettlement);
router.patch(
  '/:id/status',
  authenticate,
  requireAdmin,
  SettlementController.updateSettlementStatus,
);

export default router;
