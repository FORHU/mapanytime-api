import { Router } from 'express';
import CartController from '../controllers/cart.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Retrieve the current user's active cart
router.get('/', authenticate, CartController.getCart);

// Add an item to the cart or update its quantity
router.post('/add', authenticate, CartController.addToCart);

// Empty the cart manually
router.delete('/', authenticate, CartController.clearCart);

export default router;
