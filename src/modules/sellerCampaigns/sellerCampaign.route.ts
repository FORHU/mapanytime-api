import express from 'express';
import SellerCampaignController from './sellerCampaign.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = express.Router();

router.post('/', authenticate, SellerCampaignController.createCampaign);
router.get('/', authenticate, SellerCampaignController.getCampaigns);
router.get('/:id', authenticate, SellerCampaignController.getCampaignById);
router.patch('/:id', authenticate, SellerCampaignController.updateCampaign);
router.get('/:id/transactions', authenticate, SellerCampaignController.getCampaignTransactions);

export default router;
