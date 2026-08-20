import express from 'express';
import WishlistController from './wishlist.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = express.Router();

// A wishlist is per-buyer and always resolved from the token — no id is taken
// from the client. Closes FLAGS.md CAT-7.
router.get('/', authenticate, WishlistController.index);
router.get('/saved', authenticate, WishlistController.saved);
router.post('/items', authenticate, WishlistController.add);
router.delete('/items/:productId', authenticate, WishlistController.remove);
router.delete('/', authenticate, WishlistController.clear);

export default router;
