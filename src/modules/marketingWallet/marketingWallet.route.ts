import express from 'express';
import MarketingWalletController from './marketingWallet.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireSellerFeature } from '../../middleware/sellerOrg.middleware';
import { PERMISSIONS } from '../../constants/permissions.constant';

const router = express.Router();

router.get(
  '/',
  authenticate,
  requireSellerFeature(PERMISSIONS.PROMOTIONS_ADD),
  MarketingWalletController.getWallet,
);

router.post(
  '/deposit',
  authenticate,
  requireSellerFeature(PERMISSIONS.PROMOTIONS_ADD),
  MarketingWalletController.deposit,
);

router.get(
  '/transactions',
  authenticate,
  requireSellerFeature(PERMISSIONS.PROMOTIONS_ADD),
  MarketingWalletController.getTransactions,
);

export default router;
