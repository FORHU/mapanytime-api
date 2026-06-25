import express from 'express';
import UserController from '../controllers/user.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = express.Router();

router.get('/me', authenticate, UserController.getMe);
router.get('/', UserController.index);
router.post('/', UserController.create);
router.post('/assign-role', authenticate, UserController.assignRole);
export default router;
