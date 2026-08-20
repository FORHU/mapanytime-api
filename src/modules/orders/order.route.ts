import express from 'express';
import OrderController from './order.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/admin.middleware';

const router = express.Router();

router.post('/', authenticate, OrderController.create);
router.get('/', authenticate, OrderController.myOrders);
// Platform-wide, admin only. `/store` resolves the caller's seller profile and
// 403s without one, so an admin had no way to read orders across stores.
router.get('/admin', authenticate, requireAdmin, OrderController.allOrders);
router.get('/store/stats', authenticate, OrderController.storeOrderStats);
router.get('/store', authenticate, OrderController.storeOrders);
router.patch('/complete', authenticate, OrderController.complete);
router.patch('/cancel', authenticate, OrderController.cancel);
router.patch('/status', authenticate, OrderController.updateFulfillmentStatus);

export default router;
