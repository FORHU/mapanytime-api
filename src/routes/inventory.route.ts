import { Router } from 'express';
import InventoryController from '../controllers/inventory.controller';
import InventoryReservationController from '../controllers/inventoryReservation.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Endpoint to fetch current inventory stock
router.get('/:productId', authenticate, InventoryController.getInventory);
// Endpoint for sellers to add physical stock to their product
router.patch('/:productId/restock', authenticate, InventoryController.restock);

// Inventory Reservation endpoints
router.post('/reserve', authenticate, InventoryReservationController.reserve);
router.get(
  '/reservations/active',
  authenticate,
  InventoryReservationController.getActiveReservations,
);
router.post('/reservations/:id/confirm', authenticate, InventoryReservationController.confirm);
router.post('/reservations/:id/release', authenticate, InventoryReservationController.release);

export default router;
