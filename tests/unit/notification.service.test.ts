import NotificationService from '../../src/modules/notifications/notification.service';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/infrastructure/socket', () => ({ emitNotificationToUser: jest.fn() }));
jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    notifications: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as unknown as Record<string, Record<string, jest.Mock>>;

const USER_ID = 'user-1';

/**
 * `NotificationService` had these methods all along with no route mounting
 * them, so the in-app feed was unreachable. See FLAGS.md NTF-2.
 */
describe('NotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.notifications.findMany.mockResolvedValue([]);
    mockPrisma.notifications.updateMany.mockResolvedValue({ count: 1 });
  });

  it('returns the caller feed newest first, capped', async () => {
    await NotificationService.getUserNotifications(USER_ID);

    const call = mockPrisma.notifications.findMany.mock.calls[0][0];
    expect(call.where).toEqual({ userId: USER_ID });
    expect(call.orderBy).toEqual({ createdAt: 'desc' });
    expect(call.take).toBe(50);
  });

  it('can filter to unread only', async () => {
    await NotificationService.getUserNotifications(USER_ID, { unreadOnly: true });

    expect(mockPrisma.notifications.findMany.mock.calls[0][0].where).toEqual({
      userId: USER_ID,
      readAt: null,
    });
  });

  it('counts only unread for the badge', async () => {
    mockPrisma.notifications.count.mockResolvedValue(3);

    expect(await NotificationService.getUnreadCount(USER_ID)).toBe(3);
    expect(mockPrisma.notifications.count).toHaveBeenCalledWith({
      where: { userId: USER_ID, readAt: null },
    });
  });

  // A bare `update` by id would let anyone mark anyone's notification read.
  it('scopes marking-as-read to the caller', async () => {
    await NotificationService.markAsRead('notif-1', USER_ID);

    expect(mockPrisma.notifications.updateMany).toHaveBeenCalledWith({
      where: { id: 'notif-1', userId: USER_ID },
      data: { readAt: expect.any(Date) },
    });
  });

  it('marks all unread as read for the caller only', async () => {
    await NotificationService.markAllAsRead(USER_ID);

    expect(mockPrisma.notifications.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });

  it('persists a notification and pushes it over the socket', async () => {
    mockPrisma.notifications.create.mockResolvedValue({
      id: 'notif-1',
      title: 'Order ready',
      body: 'Collect it at the stall.',
      metadata: null,
      createdAt: new Date(),
    });

    const result = await NotificationService.sendNotification({
      userId: USER_ID,
      title: 'Order ready',
      body: 'Collect it at the stall.',
    });

    expect(result.id).toBe('notif-1');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { emitNotificationToUser } = require('../../src/infrastructure/socket');
    expect(emitNotificationToUser).toHaveBeenCalled();
  });
});
