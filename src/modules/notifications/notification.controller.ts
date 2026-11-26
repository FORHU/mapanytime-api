import { Request, Response, NextFunction } from 'express';
import NotificationService from './notification.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';

export default class NotificationController {
  /** The caller's own feed. Takes no user id from the client. */
  static async index(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const unreadOnly = req.query.unreadOnly === 'true';
      const pageQuery = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
      const limitQuery = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const page = pageQuery && !Number.isNaN(pageQuery) ? pageQuery : undefined;
      const limit = limitQuery && !Number.isNaN(limitQuery) ? limitQuery : undefined;

      const notifications = await NotificationService.getUserNotifications(userId, {
        unreadOnly,
        page,
        limit,
      });
      return responseSuccess(res, 200, notifications, 'Notifications fetched successfully');
    } catch (error) {
      next(error);
    }
  }

  /** Badge count. Cheap enough to poll, unlike fetching the whole feed. */
  static async unreadCount(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const count = await NotificationService.getUnreadCount(userId);
      return responseSuccess(res, 200, { count }, 'Unread count fetched successfully');
    } catch (error) {
      next(error);
    }
  }

  static async markAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      // Scoped to the caller — marking someone else's notification read is not
      // damaging, but it is not theirs to touch either.
      const result = await NotificationService.markAsRead(req.params.id, userId);
      if (result.count === 0) return responseError(res, 404, 'Notification not found.');

      return responseSuccess(res, 200, result, 'Notification marked as read');
    } catch (error) {
      next(error);
    }
  }

  static async markAllAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const result = await NotificationService.markAllAsRead(userId);
      return responseSuccess(res, 200, result, 'All notifications marked as read');
    } catch (error) {
      next(error);
    }
  }
}
