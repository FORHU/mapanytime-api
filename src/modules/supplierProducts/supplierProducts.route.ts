import express from 'express';
import SupplierProductsController from './supplierProducts.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = express.Router();

router.post('/', authenticate, SupplierProductsController.create);
router.get('/seller/:sellerId', authenticate, SupplierProductsController.getBySeller);
router.get('/product/:productId', authenticate, SupplierProductsController.getByProduct);
router.put('/:id', authenticate, SupplierProductsController.update);
router.delete('/:id', authenticate, SupplierProductsController.delete);

export default router;
