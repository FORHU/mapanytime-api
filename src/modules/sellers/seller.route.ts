import express from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { PERMISSIONS } from '../../constants/permissions.constant';
import SellerController from './seller.controller';

const router = express.Router();

// Reviewing a seller application is exactly what `sellers.approve` describes.
// Administrator-only today; requirePermission lets a reviewer role be granted
// the code later without touching this file.
router.use(authenticate, requirePermission(PERMISSIONS.SELLERS_APPROVE));

router.get('/', SellerController.list);
router.get('/:sellerId', SellerController.getDetail);
router.post('/:sellerId/approve', SellerController.approve);
router.post('/:sellerId/reject', SellerController.reject);

export default router;
