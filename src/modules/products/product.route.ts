import express from 'express';
import ProductController from './product.controller';
import { authenticate } from '../../middleware/auth.middleware';
import {
  requireSellerFeature,
  requireSellerOrg,
  requireStoreInScope,
  requireStoreInScopeIfPresent,
} from '../../middleware/sellerOrg.middleware';

const router = express.Router();

// Public buyer catalog — never org-scoped.
router.get('/all', ProductController.getAllProducts);

// Seller-management routes. `requireSellerOrg` resolves the caller's
// organization context and admits any org member; `requireSellerFeature`
// narrows that to members actually granted the products feature (admins hold
// every feature implicitly). `storeId` is optional on both read routes —
// omitting it is "All Stores" mode. When one IS supplied it must still be a
// store the caller may see, or a seller_user could read a sibling store's
// catalog by passing its id.
router.get(
  '/my-categories',
  authenticate,
  requireSellerOrg,
  requireSellerFeature('products'),
  requireStoreInScopeIfPresent,
  ProductController.myCategories,
);
router.post(
  '/',
  authenticate,
  requireSellerOrg,
  requireSellerFeature('products'),
  requireStoreInScope,
  ProductController.create,
);
router.get(
  '/',
  authenticate,
  requireSellerOrg,
  requireSellerFeature('products'),
  requireStoreInScopeIfPresent,
  ProductController.index,
);
router.put(
  '/:id',
  authenticate,
  requireSellerOrg,
  requireSellerFeature('products'),
  ProductController.update,
);
router.delete(
  '/:id',
  authenticate,
  requireSellerOrg,
  requireSellerFeature('products'),
  ProductController.delete,
);

export default router;
