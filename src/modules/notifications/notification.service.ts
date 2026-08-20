import { prisma } from '../../utils/prisma';
import { emitNotificationToUser } from '../../infrastructure/socket';
import { Prisma } from '@prisma/client';

export default class NotificationService {
  static async sendNotification(payload: {
    userId: string;
    title: string;
    body: string;
    metadata?: Record<string, unknown>;
  }) {
    const notification = await prisma.notifications.create({
      data: {
        userId: payload.userId,
        title: payload.title,
        body: payload.body,
        metadata: payload.metadata ? (payload.metadata as Prisma.InputJsonObject) : undefined,
      },
    });

    try {
      emitNotificationToUser(payload.userId, {
        id: notification.id,
        title: notification.title,
        body: notification.body,
        metadata: (notification.metadata as Record<string, unknown>) ?? undefined,
        sentAt: notification.createdAt.toISOString(),
      });
    } catch {
      // Socket transport error fallback
    }

    return notification;
  }

  static async getUserNotifications(userId: string, options: { unreadOnly?: boolean } = {}) {
    return prisma.notifications.findMany({
      where: { userId, ...(options.unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /** Badge count, so a client does not have to pull the feed to render one. */
  static async getUnreadCount(userId: string) {
    return prisma.notifications.count({ where: { userId, readAt: null } });
  }

  static async markAsRead(id: string, userId: string) {
    // `updateMany` with the userId in the filter is what scopes this to the
    // caller: a bare `update` by id would let anyone mark anyone's read.
    return prisma.notifications.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });
  }

  static async markAllAsRead(userId: string) {
    return prisma.notifications.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
