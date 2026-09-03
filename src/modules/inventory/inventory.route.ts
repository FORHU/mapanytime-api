import { Router } from 'express';
import InventoryController from './inventory.controller';
import InventoryReservationController from './inventoryReservation.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireSellerFeature } from '../../middleware/sellerOrg.middleware';

const router = Router();

// Stock is part of the products feature — a member who cannot see the catalog
// has no business changing its stock levels. The store scope is still enforced
// per-request inside InventoryService via assertStoreInScope.
// Endpoint to fetch current inventory stock
router.get(
  '/:productId',
  authenticate,
  requireSellerFeature('products'),
  InventoryController.getInventory,
);
// Endpoint for sellers to add physical stock to their product
router.patch(
  '/:productId/restock',
  authenticate,
  requireSellerFeature('products'),
  InventoryController.restock,
);
// Endpoint for sellers to set an absolute stock level (increase or decrease)
router.patch(
  '/:productId/adjust',
  authenticate,
  requireSellerFeature('products'),
  InventoryController.adjust,
);

// Inventory Reservation endpoints — buyer-facing checkout flow, not gated on a
// seller feature.
router.post('/reserve', authenticate, InventoryReservationController.reserve);
router.get(
  '/reservations/active',
  authenticate,
  InventoryReservationController.getActiveReservations,
);
router.post('/reservations/:id/confirm', authenticate, InventoryReservationController.confirm);
router.post('/reservations/:id/release', authenticate, InventoryReservationController.release);

export default router;
