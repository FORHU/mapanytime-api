import { Router } from 'express';
import OrderController from '../controllers/order.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/', authenticate, OrderController.getOrders);
router.post('/', authenticate, OrderController.create);
router.patch('/complete', authenticate, OrderController.complete);
router.patch('/cancel', authenticate, OrderController.cancel);

export default router;
