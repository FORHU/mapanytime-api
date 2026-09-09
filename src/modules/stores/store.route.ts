import express from 'express';
import StoreController from './store.controller';
import { authenticate } from '../../middleware/auth.middleware';
import {
  requireApprovedSeller,
  requireSellerOrg,
  requireSellerOrgAdmin,
  requireStoreInScope,
} from '../../middleware/sellerOrg.middleware';

const router = express.Router();

// Specific named routes MUST come before the /:id wildcard
router.get('/nearby', StoreController.getNearby);
router.get('/my-stores', authenticate, requireSellerOrg, StoreController.getMyStores);

// Public storefront — buyer views a store by id (no auth required)
router.get('/:id', StoreController.getById);
router.get('/:id/products', StoreController.getStoreProducts);

// Managing the organization's stores is an admin-only action, and opening a
// first store additionally requires the seller application to have been
// approved. The frontend hides the affordance, but this is what actually
// enforces it — the endpoint is reachable directly.
//
// Deliberately not on PATCH below: a seller approved once should still be able
// to correct an existing store if their status later changes.
router.post(
  '/',
  authenticate,
  requireSellerOrg,
  requireApprovedSeller,
  requireSellerOrgAdmin,
  StoreController.createStore,
);

// Seller edits a store profile — admin-only. Access is scoped to the caller's
// organization and (for staff) their assigned stores via the middleware +
// service check.
router.patch(
  '/:id',
  authenticate,
  requireSellerOrg,
  requireSellerOrgAdmin,
  requireStoreInScope,
  StoreController.updateStore,
);

export default router;
