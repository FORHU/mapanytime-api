import { Router } from 'express';
import AdminInviteController from './admin-invite.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { PERMISSIONS } from '../../constants/permissions.constant';

const router = Router();

/* ── Public Onboarding Routes (Token Validation & Acceptance) ─────────────── */

router.get('/validate', AdminInviteController.validate);
router.post('/accept', AdminInviteController.accept);

/* ── Protected Management Routes (Administrators Only) ─────────────────────── */

const adminGate = [authenticate, requirePermission(PERMISSIONS.USERS_MANAGE)];

router.post('/', ...adminGate, AdminInviteController.create);
router.get('/', ...adminGate, AdminInviteController.index);
router.post('/:id/revoke', ...adminGate, AdminInviteController.revoke);
router.delete('/:id', ...adminGate, AdminInviteController.revoke);

export default router;
