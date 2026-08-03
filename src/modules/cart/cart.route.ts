import express from 'express';
import CartController from './cart.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = express.Router();

router.get('/', authenticate, CartController.getCart);
router.post('/add', authenticate, CartController.addToCart);
router.delete('/clear', authenticate, CartController.clearCart);

export default router;
