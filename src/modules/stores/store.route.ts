import express from 'express';
import StoreController from './store.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = express.Router();

// Specific named routes MUST come before the /:id wildcard
router.get('/nearby', StoreController.getNearby);
router.get('/my-stores', authenticate, StoreController.getMyStores);

// Public storefront — buyer views a store by id (no auth required)
router.get('/:id', StoreController.getById);
router.get('/:id/products', StoreController.getStoreProducts);

router.post('/', authenticate, StoreController.createStore);

// Seller edits their own store profile. Ownership is enforced in the service
// against req.user.seller.id, so this needs no extra middleware — a seller
// holding a valid token still cannot patch a store they do not own.
router.patch('/:id', authenticate, StoreController.updateStore);

export default router;
