import express from 'express';
import AdminApprovalController from './adminApproval.controller';
import AdminDashboardController from './adminDashboard.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { PERMISSIONS } from '../../constants/permissions.constant';

const router = express.Router();

// The dashboard metrics endpoint
router.get(
  '/dashboard',
  authenticate,
  requirePermission(PERMISSIONS.STORES_APPROVE),
  AdminDashboardController.getDashboardMetrics,
);

// Approving or rejecting a store or property listing is exactly what
// `stores.approve` describes. Administrator-only today; requirePermission lets
// a reviewer role be granted the code later without touching this file.
router.use(authenticate, requirePermission(PERMISSIONS.STORES_APPROVE));

router.get('/', AdminApprovalController.list);
router.post('/properties/:id/approve', AdminApprovalController.approveProperty);
router.post('/properties/:id/reject', AdminApprovalController.rejectProperty);
router.post('/stores/:id/approve', AdminApprovalController.approveStore);
router.post('/stores/:id/reject', AdminApprovalController.rejectStore);

export default router;
