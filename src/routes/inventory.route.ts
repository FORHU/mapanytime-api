import { Router } from 'express';
import InventoryController from '../controllers/inventory.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Endpoint for sellers to add physical stock to their product
router.patch('/:productId/restock', authenticate, InventoryController.restock);

export default router;
