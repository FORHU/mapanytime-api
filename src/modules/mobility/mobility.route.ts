import express from 'express';
import MobilityController from './mobility.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/admin.middleware';

const router = express.Router();
const admin = [authenticate, requireAdmin];

// Public: what the map needs to render God's Eye.
router.get('/vehicle-types', MobilityController.listVehicleTypes);
router.get('/vehicles/live', MobilityController.liveVehicles);

// Driver: the vehicle is resolved from the caller, never from the body.
router.get('/me/vehicle', authenticate, MobilityController.myVehicle);
router.post('/tracking/location', authenticate, MobilityController.recordLocation);
router.post('/tracking/stop', authenticate, MobilityController.stopTracking);

// Admin: fleet management (no web UI yet — API + seeder for the pilot).
router.post('/vehicle-types', ...admin, MobilityController.createVehicleType);
router.patch('/vehicle-types/:id', ...admin, MobilityController.updateVehicleType);
router.get('/operators', ...admin, MobilityController.listOperators);
router.post('/operators', ...admin, MobilityController.createOperator);
router.patch('/operators/:id', ...admin, MobilityController.updateOperator);
router.post('/operators/:id/members', ...admin, MobilityController.addOperatorMember);
router.get('/vehicles', ...admin, MobilityController.listVehicles);
router.post('/vehicles', ...admin, MobilityController.createVehicle);
router.patch('/vehicles/:id', ...admin, MobilityController.updateVehicle);

export default router;
