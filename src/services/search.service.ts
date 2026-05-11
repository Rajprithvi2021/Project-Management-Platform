import { prisma } from '../config/database';
import { redisGet, redisSet } from '../config/redis';

function normalizeCacheKey(params: Record<string, unknown>) {
  return `search:${Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort()
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join('&')}`;
}

function safeSortField(field?: string) {
  const allowed = ['createdAt', 'updatedAt', 'priority', 'title'];
  return allowed.includes(field || '') ? field! : 'createdAt';
}

export class SearchService {
  static async search(params: {
    projectId?: string;
    q?: string;
    status?: string;
    statusId?: string;
    assignee?: string;
    assigneeId?: string;
    priority?: string;
    type?: string;
    sprintId?: string;
    labels?: string[];
    cursor?: string;
    limit?: number;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
  }) {
    const limit = Math.min(params.limit || 20, 100);
    const sortDir = params.sortDir || 'desc';
    const sortField = safeSortField(params.sortBy);
    const cacheKey = normalizeCacheKey({ ...params, limit, sortField, sortDir });

    const cachePayload = await redisGet(cacheKey);
    if (cachePayload) {
      return JSON.parse(cachePayload) as any;
    }

    const where: Record<string, unknown> = { deletedAt: null };
    const andFilters: Record<string, unknown>[] = [];

    if (params.projectId) where.projectId = params.projectId;
    if (params.statusId) where.statusId = params.statusId;
    if (params.assigneeId) where.assigneeId = params.assigneeId;
    if (params.type) where.type = params.type;
    if (params.sprintId) where.sprintId = params.sprintId;
    if (params.labels?.length) where.labels = { hasSome: params.labels };

    if (params.status) {
      where.status = {
        name: {
          equals: params.status,
          mode: 'insensitive',
        },
      };
    }

    if (params.assignee) {
      where.assignee = {
        OR: [
          { displayName: { contains: params.assignee, mode: 'insensitive' } },
          { email: { contains: params.assignee, mode: 'insensitive' } },
        ],
      };
    }

    if (params.priority) {
      const priorityMap: Record<string, string[]> = {
        CRITICAL: ['CRITICAL'],
        HIGH: ['CRITICAL', 'HIGH'],
        MEDIUM: ['CRITICAL', 'HIGH', 'MEDIUM'],
        LOW: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
      };
      where.priority = { in: priorityMap[params.priority.toUpperCase()] || [params.priority.toUpperCase()] };
    }

    if (params.q) {
      where.OR = [
        { title: { contains: params.q, mode: 'insensitive' } },
        { description: { contains: params.q, mode: 'insensitive' } },
        { comments: { some: { content: { contains: params.q, mode: 'insensitive' } } } },
        { key: { contains: params.q, mode: 'insensitive' } },
      ];
    }

    if (params.cursor) {
      andFilters.push({
        id: {
          lt: params.cursor,
        },
      });
    }

    if (andFilters.length > 0) {
      where.AND = andFilters;
    }

    const issues = await prisma.issue.findMany({
      where,
      take: limit + 1,
      orderBy: { [sortField]: sortDir },
      include: {
        status: { select: { id: true, name: true, color: true, category: true } },
        assignee: { select: { id: true, displayName: true, avatarUrl: true } },
        reporter: { select: { id: true, displayName: true } },
        sprint: { select: { id: true, name: true } },
        project: { select: { id: true, key: true, name: true } },
        _count: { select: { comments: true, children: true, watchers: true } },
      },
    });

    const hasMore = issues.length > limit;
    if (hasMore) issues.pop();

    const result = {
      data: issues,
      pagination: {
        hasMore,
        nextCursor: hasMore ? issues[issues.length - 1]?.id : undefined,
      },
    };

    await redisSet(cacheKey, JSON.stringify(result), 30);
    return result;
  }

  static async searchComments(params: {
    projectId?: string;
    q: string;
    cursor?: string;
    limit?: number;
  }) {
    const limit = Math.min(params.limit || 20, 100);

    const where: Record<string, unknown> = {
      content: { contains: params.q, mode: 'insensitive' },
    };

    if (params.projectId) {
      where.issue = { projectId: params.projectId };
    }

    if (params.cursor) {
      where.id = { lt: params.cursor };
    }

    const comments = await prisma.comment.findMany({
      where,
      take: limit + 1,
      orderBy: { createdAt: 'desc' },
      include: {
        author: { select: { id: true, displayName: true } },
        issue: { select: { id: true, key: true, title: true, projectId: true } },
      },
    });

    const hasMore = comments.length > limit;
    if (hasMore) comments.pop();

    return {
      data: comments,
      pagination: {
        hasMore,
        nextCursor: hasMore ? comments[comments.length - 1]?.id : undefined,
      },
    };
  }
}
