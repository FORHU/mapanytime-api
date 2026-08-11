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

export default router;
