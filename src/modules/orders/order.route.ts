import express from 'express';
import OrderController from './order.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/admin.middleware';
import { requireSellerFeature } from '../../middleware/sellerOrg.middleware';

const router = express.Router();

// Buyer-facing. Never gated on a seller feature.
router.post('/', authenticate, OrderController.create);
router.get('/', authenticate, OrderController.myOrders);
// Platform-wide, admin only. `/store` resolves the caller's seller profile and
// 403s without one, so an admin had no way to read orders across stores.
router.get('/admin', authenticate, requireAdmin, OrderController.allOrders);

// Seller-facing. `requireSellerFeature` gates the feature; which stores the
// caller may operate is still settled per-request by assertStoreInScope inside
// OrderService.
router.get(
  '/store/stats',
  authenticate,
  requireSellerFeature('orders'),
  OrderController.storeOrderStats,
);
router.get('/store', authenticate, requireSellerFeature('orders'), OrderController.storeOrders);
router.patch('/complete', authenticate, requireSellerFeature('orders'), OrderController.complete);
// Cash on Pickup only: seller generates a short-lived code, buyer confirms
// it to complete the order — the flipped counterpart of /complete, which
// every other payment method still uses (seller marks it complete directly).
router.post(
  '/cash-pickup/generate-code',
  authenticate,
  requireSellerFeature('orders'),
  OrderController.generateCashPickupCode,
);
// The BUYER is the actor here and on /cancel — both resolve a `Buyers` row and
// 403 without one. Gating them on a seller feature would lock out every buyer.
router.post('/cash-pickup/confirm', authenticate, OrderController.confirmCashPickup);
router.patch('/cancel', authenticate, OrderController.cancel);
router.patch(
  '/status',
  authenticate,
  requireSellerFeature('orders'),
  OrderController.updateFulfillmentStatus,
);

export default router;
