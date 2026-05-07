import { prisma } from '../config/database';
import { redisGet, redisSet } from '../config/redis';
import { Prisma } from '@prisma/client';

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

    const where: Record<string, unknown> = {};
    if (params.projectId) where.projectId = params.projectId;
    if (params.statusId) where.statusId = params.statusId;
    if (params.assigneeId) where.assigneeId = params.assigneeId;
    if (params.type) where.type = params.type;
    if (params.sprintId) where.sprintId = params.sprintId;
    if (params.labels?.length) where.labels = { hasSome: params.labels };
    if (params.priority) {
      const priorityMap: Record<string, string[]> = {
        CRITICAL: ['CRITICAL'],
        HIGH: ['CRITICAL', 'HIGH'],
        MEDIUM: ['CRITICAL', 'HIGH', 'MEDIUM'],
        LOW: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
      };
      where.priority = { in: priorityMap[params.priority.toUpperCase()] || [params.priority.toUpperCase()] };
    }

    let issueIds: string[] | null = null;
    if (params.q) {
      const raw = await prisma.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT DISTINCT i.id
          FROM issues i
          LEFT JOIN comments c ON c.issue_id = i.id
          WHERE (
            to_tsvector('english', coalesce(i.title, '') || ' ' || coalesce(i.description, '')) @@ plainto_tsquery('english', ${params.q})
            OR to_tsvector('english', coalesce(c.content, '')) @@ plainto_tsquery('english', ${params.q})
          )
          ORDER BY i.${Prisma.raw(sortField)} ${Prisma.raw(sortDir.toUpperCase())}
          LIMIT ${limit + 1}
        `
      );
      issueIds = raw.map((row) => row.id);
      if (!issueIds.length) {
        const emptyResult = { data: [], pagination: { hasMore: false, nextCursor: undefined } };
        await redisSet(cacheKey, JSON.stringify(emptyResult), 30);
        return emptyResult;
      }
      where.id = { in: issueIds };
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
