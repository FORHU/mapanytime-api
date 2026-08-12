import { Router } from 'express';
import RbacController from './rbac.controller';

const router = Router();

router.get('/permissions', RbacController.getPermissions);
router.get('/roles', RbacController.getRoles);
router.put('/roles/:roleId/permissions', RbacController.updateRolePermissions);
router.post('/roles', RbacController.createRole);

export default router;
