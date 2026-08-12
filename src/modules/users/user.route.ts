import express from 'express';
import UserController from './user.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { PERMISSIONS } from '../../constants/permissions.constant';

const router = express.Router();

// `users.manage` covers reading another user's profile; rewriting a user's
// roles is an RBAC operation, so it takes `users.roles` — the same code that
// gates the /v1/rbac router. Both are administrator-only today, so these gates
// match the requireAdmin checks they replaced.
router.get('/me', authenticate, UserController.getMe);
router.get(
  '/:userId',
  authenticate,
  requirePermission(PERMISSIONS.USERS_MANAGE),
  UserController.show,
);
router.get('/', UserController.index);
router.post('/', UserController.create);
router.put(
  '/:userId/roles',
  authenticate,
  requirePermission(PERMISSIONS.USERS_ROLES),
  UserController.updateUserRoles,
);
router.post(
  '/assign-role',
  authenticate,
  requirePermission(PERMISSIONS.USERS_ROLES),
  UserController.assignRole,
);
export default router;
