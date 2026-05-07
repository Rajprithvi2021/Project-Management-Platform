import { prisma } from '../config/database';

export class NotificationService {
  static async create(params: {
    userId: string;
    type: string;
    title: string;
    body: string;
    issueId?: string;
    projectId?: string;
  }) {
    return prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type as any,
        title: params.title,
        body: params.body,
        issueId: params.issueId,
        projectId: params.projectId,
      },
    });
  }

  static async notifyWatchers(params: {
    issueId: string;
    projectId: string;
    excludeUserId: string;
    type: string;
    title: string;
    body: string;
  }) {
    const watchers = await prisma.issueWatcher.findMany({
      where: {
        issueId: params.issueId,
        userId: { not: params.excludeUserId },
      },
      select: { userId: true },
    });

    if (watchers.length === 0) return;

    await prisma.notification.createMany({
      data: watchers.map((w: { userId: string }) => ({
        userId: w.userId,
        type: params.type as any,
        title: params.title,
        body: params.body,
        issueId: params.issueId,
        projectId: params.projectId,
      })),
    });
  }

  static async getForUser(userId: string, cursor?: string, limit = 20) {
    const where: Record<string, unknown> = { userId };
    if (cursor) {
      where.id = { lt: cursor };
    }

    const notifications = await prisma.notification.findMany({
      where,
      take: limit + 1,
      orderBy: { createdAt: 'desc' },
    });

    const hasMore = notifications.length > limit;
    if (hasMore) notifications.pop();

    return {
      data: notifications,
      pagination: {
        hasMore,
        nextCursor: hasMore ? notifications[notifications.length - 1]?.id : undefined,
      },
    };
  }

  static async markRead(notificationIds: string[], userId: string) {
    return prisma.notification.updateMany({
      where: { id: { in: notificationIds }, userId },
      data: { isRead: true },
    });
  }

  static async getUnreadCount(userId: string) {
    return prisma.notification.count({ where: { userId, isRead: false } });
  }
}
