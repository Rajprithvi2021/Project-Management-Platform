import { prisma } from '../config/database';
import { redisPublish } from '../config/redis';
import { WebSocketEvent } from '../types';

export class ActivityService {
  static async log(params: {
    projectId: string;
    issueId?: string;
    userId: string;
    action: string;
    entityType: string;
    entityId: string;
    changes?: Record<string, { old: unknown; new: unknown }>;
    metadata?: Record<string, unknown>;
  }) {
    const log = await prisma.activityLog.create({
      data: {
        projectId: params.projectId,
        issueId: params.issueId,
        userId: params.userId,
        action: params.action as any,
        entityType: params.entityType,
        entityId: params.entityId,
        changes: params.changes as any,
        metadata: params.metadata as any,
      },
      include: {
        user: { select: { id: true, displayName: true, avatarUrl: true } },
      },
    });

    // Publish to real-time channel
    await this.publishEvent(params.projectId, log);
    return log;
  }

  static async getProjectFeed(params: {
    projectId: string;
    cursor?: string;
    limit?: number;
    userId?: string;
    issueId?: string;
    action?: string;
  }) {
    const limit = Math.min(params.limit || 20, 100);

    const where: Record<string, unknown> = { projectId: params.projectId };
    if (params.issueId) where.issueId = params.issueId;
    if (params.userId) where.userId = params.userId;
    if (params.action) where.action = params.action;

    if (params.cursor) {
      where.id = { lt: params.cursor };
    }

    const logs = await prisma.activityLog.findMany({
      where,
      take: limit + 1,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, displayName: true, avatarUrl: true } },
        issue: { select: { id: true, key: true, title: true } },
      },
    });

    const hasMore = logs.length > limit;
    if (hasMore) logs.pop();

    return {
      data: logs,
      pagination: {
        hasMore,
        nextCursor: hasMore ? logs[logs.length - 1]?.id : undefined,
      },
    };
  }

  private static async publishEvent(projectId: string, log: any) {
    const event: WebSocketEvent = {
      type: 'issue_updated',
      projectId,
      payload: { activityLog: log },
      timestamp: new Date().toISOString(),
    };
    await redisPublish(`project:${projectId}`, JSON.stringify(event));
  }
}
