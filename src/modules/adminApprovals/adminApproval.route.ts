import express from 'express';
import AdminApprovalController from './adminApproval.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/admin.middleware';

const router = express.Router();

router.use(authenticate, requireAdmin);

router.get('/', AdminApprovalController.list);
router.post('/properties/:id/approve', AdminApprovalController.approveProperty);
router.post('/properties/:id/reject', AdminApprovalController.rejectProperty);
router.post('/stores/:id/approve', AdminApprovalController.approveStore);
router.post('/stores/:id/reject', AdminApprovalController.rejectStore);

export default router;
