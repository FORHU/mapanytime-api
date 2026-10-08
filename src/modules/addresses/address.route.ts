import express from 'express';
import AddressController from './address.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = express.Router();

// Per-buyer: the buyer always comes from the token, and an :id is only looked
// up among that buyer's own addresses.
router.get('/', authenticate, AddressController.index);
router.post('/', authenticate, AddressController.create);
router.patch('/:id', authenticate, AddressController.update);
router.post('/:id/default', authenticate, AddressController.setDefault);
router.delete('/:id', authenticate, AddressController.remove);

export default router;
