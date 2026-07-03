import { Router } from 'express';
import OrderController from '../controllers/order.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.post('/', authenticate, OrderController.create);

// ADDED: Endpoint for store owners to complete orders
router.patch('/complete', authenticate, OrderController.complete);

export default router;
