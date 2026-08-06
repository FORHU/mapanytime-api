import express from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import PropertyController from './property.controller';

const router = express.Router();

router.use(authenticate);
router.get('/my-properties', PropertyController.getMine);
router.get('/:id', PropertyController.getById);
router.post('/', PropertyController.create);

export default router;
