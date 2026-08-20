import express from 'express';
import PricingController from './pricing.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/admin.middleware';

const router = express.Router();

// Public / buyer-facing checkout pricing preview.
router.post('/calculate', PricingController.calculate);
router.get('/active', PricingController.active);

// Admin pricing management. These decide what every order is charged, so they
// are admin-only — `authenticate` alone let any signed-in user write the
// platform's rate card.
router.get('/configurations', authenticate, requireAdmin, PricingController.index);
router.post('/configurations', authenticate, requireAdmin, PricingController.create);
router.get('/configurations/:id', authenticate, requireAdmin, PricingController.show);
router.patch('/configurations/:id', authenticate, requireAdmin, PricingController.update);

// Components
router.post(
  '/configurations/:id/components',
  authenticate,
  requireAdmin,
  PricingController.addComponent,
);
router.patch(
  '/configurations/:id/components/:componentId',
  authenticate,
  requireAdmin,
  PricingController.updateComponent,
);
router.delete(
  '/configurations/:id/components/:componentId',
  authenticate,
  requireAdmin,
  PricingController.deleteComponent,
);

// Lifecycle. `validate` is the dry run; `activate` refuses anything invalid.
router.get('/configurations/:id/validate', authenticate, requireAdmin, PricingController.validate);
router.post('/configurations/:id/activate', authenticate, requireAdmin, PricingController.activate);
router.post('/configurations/:id/archive', authenticate, requireAdmin, PricingController.archive);

export default router;
