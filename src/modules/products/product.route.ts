import express from 'express';
import ProductController from './product.controller';
import { authenticate } from '../../middleware/auth.middleware';
import {
  requireSellerFeature,
  requireSellerOrg,
  requireStoreInScope,
  requireStoreInScopeIfPresent,
} from '../../middleware/sellerOrg.middleware';
import { PERMISSIONS } from '../../constants/permissions.constant';

const router = express.Router();

// Public buyer catalog — never org-scoped.
router.get('/all', ProductController.getAllProducts);

// Seller-management routes. `requireSellerOrg` resolves the caller's
// organization context and admits any org member; `requireSellerFeature`
// narrows that to members actually granted the code (admins hold every code
// implicitly). Reads take `products.view` and writes `products.edit`, so a
// SELLER_MEMBER can browse the catalog without being able to change it.
// `storeId` is optional on both read routes —
// omitting it is "All Stores" mode. When one IS supplied it must still be a
// store the caller may see, or a seller_user could read a sibling store's
// catalog by passing its id.
router.get(
  '/my-categories',
  authenticate,
  requireSellerOrg,
  requireSellerFeature(PERMISSIONS.PRODUCTS_VIEW),
  requireStoreInScopeIfPresent,
  ProductController.myCategories,
);
router.post(
  '/',
  authenticate,
  requireSellerOrg,
  requireSellerFeature(PERMISSIONS.PRODUCTS_EDIT),
  requireStoreInScope,
  ProductController.create,
);
router.get(
  '/',
  authenticate,
  requireSellerOrg,
  requireSellerFeature(PERMISSIONS.PRODUCTS_VIEW),
  requireStoreInScopeIfPresent,
  ProductController.index,
);
router.put(
  '/:id',
  authenticate,
  requireSellerOrg,
  requireSellerFeature(PERMISSIONS.PRODUCTS_EDIT),
  ProductController.update,
);
router.delete(
  '/:id',
  authenticate,
  requireSellerOrg,
  requireSellerFeature(PERMISSIONS.PRODUCTS_EDIT),
  ProductController.delete,
);

export default router;
