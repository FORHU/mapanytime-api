import express from 'express';
import MerchantAdsController from './merchantAds.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireSellerFeature } from '../../middleware/sellerOrg.middleware';

const router = express.Router();

// Public, buyer-facing — discovery & deal inspection
router.get('/nearby', MerchantAdsController.nearby);
router.post('/:id/events', MerchantAdsController.recordEvent);

// Seller-authenticated management. `requireSellerFeature` gates the feature
// only — the store scope is settled per-request by assertStoreInScope inside
// MerchantAdsService, so a member still reaches only their assigned stores.
// No `requireSellerOrg` here on purpose: it would 403 a pre-organization seller
// who owns their stores outright, and the gate resolves its own context.
router.get('/', authenticate, requireSellerFeature('promotions'), MerchantAdsController.index);
// Above /:id/* so 'badges' isn't swallowed as an ad id.
router.get(
  '/badges',
  authenticate,
  requireSellerFeature('promotions'),
  MerchantAdsController.badges,
);
router.get(
  '/:id/analytics',
  authenticate,
  requireSellerFeature('promotions'),
  MerchantAdsController.analytics,
);
router.post('/', authenticate, requireSellerFeature('promotions'), MerchantAdsController.create);
router.put('/:id', authenticate, requireSellerFeature('promotions'), MerchantAdsController.update);
router.delete(
  '/:id',
  authenticate,
  requireSellerFeature('promotions'),
  MerchantAdsController.destroy,
);
router.patch(
  '/:id',
  authenticate,
  requireSellerFeature('promotions'),
  MerchantAdsController.toggle,
);

export default router;
