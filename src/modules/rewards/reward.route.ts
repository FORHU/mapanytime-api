import express from 'express';
import RewardController from './reward.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/admin.middleware';

const router = express.Router();

// Buyer-facing MapPoints wallet and voucher catalog.
router.get('/wallet', authenticate, RewardController.getWallet);
router.get('/transactions', authenticate, RewardController.getTransactions);
router.get('/vouchers', authenticate, RewardController.listVoucherCatalog);
router.post('/vouchers/:id/claim', authenticate, RewardController.claimVoucher);
router.get('/my-vouchers', authenticate, RewardController.getMyVouchers);
// Display-safe subset of the active rate, for checkout's "you'll earn ~N
// points" estimate. Not the full admin config (see /admin/config below).
router.get('/config', authenticate, RewardController.getPublicConfig);

// Admin-only. Decide the rate every buyer earns at and curate the voucher
// catalog — `authenticate` alone would let any signed-in user set the rate.
router.get('/admin/config', authenticate, requireAdmin, RewardController.getConfig);
router.patch('/admin/config', authenticate, requireAdmin, RewardController.updateConfig);
router.get('/admin/vouchers', authenticate, requireAdmin, RewardController.listVouchersAdmin);
router.post('/admin/vouchers', authenticate, requireAdmin, RewardController.createVoucher);
router.patch('/admin/vouchers/:id', authenticate, requireAdmin, RewardController.updateVoucher);

export default router;
