import express from 'express';
import NotificationController from './notification.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = express.Router();

// `NotificationService` has had these methods all along with no route mounting
// them, so the in-app feed was unreachable. See FLAGS.md NTF-2.
router.get('/', authenticate, NotificationController.index);
router.get('/unread-count', authenticate, NotificationController.unreadCount);
router.patch('/read-all', authenticate, NotificationController.markAllAsRead);
router.patch('/:id/read', authenticate, NotificationController.markAsRead);

export default router;
