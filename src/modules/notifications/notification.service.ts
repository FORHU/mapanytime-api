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

  static async getUserNotifications(userId: string) {
    return prisma.notifications.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  static async markAsRead(id: string, userId: string) {
    return prisma.notifications.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });
  }
}
