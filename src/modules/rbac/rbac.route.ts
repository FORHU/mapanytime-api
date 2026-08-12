import { Router } from 'express';
import RbacController from './rbac.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/admin.middleware';

const router = Router();

// Every RBAC endpoint reads or rewrites the role/permission model itself, so
// the whole router is admin-only. Guarding at the router rather than per-route
// means a new endpoint added below cannot accidentally ship unauthenticated.
router.use(authenticate, requireAdmin);

router.get('/permissions', RbacController.getPermissions);
router.get('/roles', RbacController.getRoles);
router.put('/roles/:roleId/permissions', RbacController.updateRolePermissions);
router.post('/roles', RbacController.createRole);

export default router;
