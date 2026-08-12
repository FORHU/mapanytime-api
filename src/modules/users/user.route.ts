import express from 'express';
import UserController from './user.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/admin.middleware';

const router = express.Router();

router.get('/me', authenticate, UserController.getMe);
router.get('/:userId', authenticate, requireAdmin, UserController.show);
router.get('/', UserController.index);
router.post('/', UserController.create);
router.put('/:userId/roles', authenticate, requireAdmin, UserController.updateUserRoles);
router.post('/assign-role', authenticate, requireAdmin, UserController.assignRole);
export default router;
