import express from 'express';
import MerchantAdsController from './merchantAds.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = express.Router();

// Public, buyer-facing — unlike the routes below, no auth/store-ownership check.
router.get('/nearby', MerchantAdsController.nearby);
router.get('/', authenticate, MerchantAdsController.index);
router.post('/', authenticate, MerchantAdsController.create);
router.put('/:id', authenticate, MerchantAdsController.update);
router.delete('/:id', authenticate, MerchantAdsController.destroy);
router.patch('/:id', authenticate, MerchantAdsController.toggle);

export default router;
