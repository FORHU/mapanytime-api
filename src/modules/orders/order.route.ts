import express from 'express';
import OrderController from './order.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = express.Router();

router.post('/', authenticate, OrderController.create);
router.get('/', authenticate, OrderController.myOrders);
router.get('/store/stats', authenticate, OrderController.storeOrderStats);
router.get('/store', authenticate, OrderController.storeOrders);
router.patch('/complete', authenticate, OrderController.complete);
router.patch('/cancel', authenticate, OrderController.cancel);
router.patch('/status', authenticate, OrderController.updateFulfillmentStatus);

export default router;
