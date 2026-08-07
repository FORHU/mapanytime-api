import express from 'express';
import AdminApprovalController from './adminApproval.controller';

const router = express.Router();

router.get('/', AdminApprovalController.list);
router.post('/properties/:id/approve', AdminApprovalController.approveProperty);
router.post('/properties/:id/reject', AdminApprovalController.rejectProperty);
router.post('/stores/:id/approve', AdminApprovalController.approveStore);
router.post('/stores/:id/reject', AdminApprovalController.rejectStore);

export default router;
