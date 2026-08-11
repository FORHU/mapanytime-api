import express from 'express';
import MerchantAdsController from './merchantAds.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = express.Router();

router.get('/', authenticate, MerchantAdsController.index);
router.post('/', authenticate, MerchantAdsController.create);
router.delete('/:id', authenticate, MerchantAdsController.delete);

export default router;
