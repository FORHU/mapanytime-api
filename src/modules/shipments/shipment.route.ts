import { Router } from 'express';
import ShipmentController from './shipment.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

router.post('/', authenticate, ShipmentController.createShipment);
router.get('/order/:orderId', authenticate, ShipmentController.getShipmentByOrderId);
router.patch('/:id/status', authenticate, ShipmentController.updateShipmentStatus);

export default router;
