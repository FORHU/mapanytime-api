import { Router } from 'express';
import RbacController from './rbac.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { PERMISSIONS } from '../../constants/permissions.constant';

const router = Router();

// Every RBAC endpoint reads or rewrites the role/permission model itself, so
// the whole router is gated. Guarding at the router rather than per-route means
// a new endpoint added below cannot accidentally ship unauthenticated.
//
// `users.roles` ("Manage Roles & RBAC") is the code that describes exactly this
// surface. Only administrators hold it today, and requirePermission passes any
// administrator through regardless, so this is equivalent to the previous
// requireAdmin gate — but it is now delegable without a code change.
router.use(authenticate, requirePermission(PERMISSIONS.USERS_ROLES));

router.get('/permissions', RbacController.getPermissions);
router.get('/roles', RbacController.getRoles);
router.put('/roles/:roleId/permissions', RbacController.updateRolePermissions);
router.post('/roles', RbacController.createRole);

export default router;
