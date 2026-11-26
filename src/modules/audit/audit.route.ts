import { Router } from 'express';
import AuditController from './audit.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/admin.middleware';

const router = Router();

router.use(authenticate, requireAdmin);

router.get('/', AuditController.list);

export default router;
