import express from 'express';
import PricingController from './pricing.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = express.Router();

// Public / Buyer-facing checkout pricing preview
router.post('/calculate', PricingController.calculate);
router.get('/active', PricingController.active);

// Admin pricing tier management
router.get('/configurations', authenticate, PricingController.index);
router.post('/configurations', authenticate, PricingController.create);

export default router;
