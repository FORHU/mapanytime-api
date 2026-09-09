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

// Store review workflow. Claim is what moves a store to UNDER_REVIEW; the three
// decisions below are only reachable from there, enforced by the transition
// matrix rather than by these routes.
router.post('/stores/:id/claim', AdminApprovalController.claimStore);
router.delete('/stores/:id/claim', AdminApprovalController.releaseStore);
router.post('/stores/:id/approve', AdminApprovalController.approveStore);
router.post('/stores/:id/reject', AdminApprovalController.rejectStore);
router.post('/stores/:id/request-revision', AdminApprovalController.requestStoreRevision);
router.get('/stores/:id/history', AdminApprovalController.storeHistory);

export default router;
