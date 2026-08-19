import express from 'express';
import MerchantAdsController from './merchantAds.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = express.Router();

// Public, buyer-facing — discovery & deal inspection
router.get('/nearby', MerchantAdsController.nearby);
router.post('/:id/events', MerchantAdsController.recordEvent);

// Seller-authenticated management
router.get('/', authenticate, MerchantAdsController.index);
router.get('/:id/analytics', authenticate, MerchantAdsController.analytics);
router.post('/', authenticate, MerchantAdsController.create);
router.put('/:id', authenticate, MerchantAdsController.update);
router.delete('/:id', authenticate, MerchantAdsController.destroy);
router.patch('/:id', authenticate, MerchantAdsController.toggle);

export default router;
