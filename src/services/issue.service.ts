import { prisma } from '../config/database';
import { createError } from '../middleware/errorHandler';
import { ActivityService } from './activity.service';
import { NotificationService } from './notification.service';
import { redisPublish } from '../config/redis';
import { WebSocketEvent } from '../types';

export class IssueService {
  private static isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  static async resolveIssueIdentifier(identifier: string) {
    const issue = await prisma.issue.findFirst({
      where: this.isUuid(identifier)
        ? {
            id: identifier,
            deletedAt: null,
          }
        : {
            key: identifier,
            deletedAt: null,
          },
      select: {
        id: true,
        key: true,
        projectId: true,
      },
    });

    if (!issue) {
      throw createError('Issue not found', 404);
    }

    return issue;
  }

  static async create(params: {
    projectId: string;
    type: string;
    title: string;
    description?: string;
    priority?: string;
    assigneeId?: string;
    reporterId: string;
    parentId?: string;
    sprintId?: string;
    storyPoints?: number;
    labels?: string[];
    dueDate?: Date;
    statusId?: string;
  }) {
    const project = await prisma.project.findUnique({ where: { id: params.projectId } });
    if (!project) throw createError('Project not found', 404);

    // Get default status if not specified
    let statusId = params.statusId;
    if (!statusId) {
      const defaultStatus = await prisma.workflowStatus.findFirst({
        where: { projectId: params.projectId, isDefault: true },
        orderBy: { position: 'asc' },
      });
      if (!defaultStatus) {
        const firstStatus = await prisma.workflowStatus.findFirst({
          where: { projectId: params.projectId },
          orderBy: { position: 'asc' },
        });
        if (!firstStatus) throw createError('No workflow statuses configured for this project', 422);
        statusId = firstStatus.id;
      } else {
        statusId = defaultStatus.id;
      }
    }

    // Generate issue key
    const issueCount = await prisma.issue.count({ where: { projectId: params.projectId } });
    const key = `${project.key}-${issueCount + 1}`;

    const issue = await prisma.issue.create({
      data: {
        key,
        projectId: params.projectId,
        type: params.type as any,
        title: params.title,
        description: params.description,
        priority: (params.priority as any) || 'MEDIUM',
        assigneeId: params.assigneeId,
        reporterId: params.reporterId,
        parentId: params.parentId,
        sprintId: params.sprintId,
        storyPoints: params.storyPoints,
        labels: params.labels || [],
        statusId: statusId!,
        dueDate: params.dueDate,
      },
      include: this.defaultInclude(),
    });

    // Auto-watch reporter and assignee
    await prisma.issueWatcher.createMany({
      data: [
        { issueId: issue.id, userId: params.reporterId },
        ...(params.assigneeId && params.assigneeId !== params.reporterId
          ? [{ issueId: issue.id, userId: params.assigneeId }]
          : []),
      ],
      skipDuplicates: true,
    });

    // Log activity
    await ActivityService.log({
      projectId: params.projectId,
      issueId: issue.id,
      userId: params.reporterId,
      action: 'CREATED',
      entityType: 'Issue',
      entityId: issue.id,
      metadata: { issueKey: key, issueType: params.type },
    });

    // Notify assignee
    if (params.assigneeId && params.assigneeId !== params.reporterId) {
      await NotificationService.create({
        userId: params.assigneeId,
        type: 'ASSIGNED',
        title: `You were assigned to ${key}`,
        body: `"${params.title}" has been assigned to you`,
        issueId: issue.id,
        projectId: params.projectId,
      });
    }

    // Emit WebSocket event
    const event: WebSocketEvent = {
      type: 'issue_created',
      projectId: params.projectId,
      payload: { issue },
      timestamp: new Date().toISOString(),
      userId: params.reporterId,
    };
    await redisPublish(`project:${params.projectId}`, JSON.stringify(event));

    return issue;
  }

  static async update(params: {
    issueId: string;
    userId: string;
    version: number;
    data: {
      title?: string;
      description?: string;
      priority?: string;
      assigneeId?: string;
      storyPoints?: number;
      labels?: string[];
      dueDate?: Date | null;
    };
  }) {
    const resolvedIssue = await this.resolveIssueIdentifier(params.issueId);

    // Optimistic locking: verify version matches
    const existing = await prisma.issue.findFirst({
      where: { id: resolvedIssue.id, deletedAt: null },
      include: { status: true, project: true },
    });

    if (!existing) throw createError('Issue not found', 404);

    if (existing.version !== params.version) {
      throw Object.assign(
        createError('Conflict: issue was modified by another user. Refresh and retry.', 409),
        { currentVersion: existing.version }
      );
    }

    const changes: Record<string, { old: unknown; new: unknown }> = {};
    const updateData: Record<string, unknown> = { version: { increment: 1 } };

    // Build change tracking
    const fields = ['title', 'description', 'priority', 'assigneeId', 'storyPoints', 'labels', 'dueDate'] as const;
    for (const field of fields) {
      if (params.data[field] !== undefined && params.data[field] !== existing[field]) {
        changes[field] = { old: existing[field], new: params.data[field] };
        updateData[field] = params.data[field];
      }
    }

    if (Object.keys(updateData).length <= 1) {
      return existing; // No actual changes
    }

    const updated = await prisma.issue.update({
      where: { id: resolvedIssue.id },
      data: updateData,
      include: this.defaultInclude(),
    });

    // Log activity
    await ActivityService.log({
      projectId: existing.projectId,
      issueId: existing.id,
      userId: params.userId,
      action: 'UPDATED',
      entityType: 'Issue',
      entityId: existing.id,
      changes,
    });

    // Notify new assignee
    if (changes.assigneeId?.new && changes.assigneeId.new !== params.userId) {
      await NotificationService.create({
        userId: changes.assigneeId.new as string,
        type: 'ASSIGNED',
        title: `You were assigned to ${existing.key}`,
        body: `"${updated.title}" has been assigned to you`,
        issueId: existing.id,
        projectId: existing.projectId,
      });
    }

    // Notify watchers
    await NotificationService.notifyWatchers({
      issueId: existing.id,
      projectId: existing.projectId,
      excludeUserId: params.userId,
      type: 'WATCHED_ISSUE_UPDATED',
      title: `${existing.key} was updated`,
      body: `"${updated.title}" has been updated`,
    });

    // Emit WebSocket event
    const event: WebSocketEvent = {
      type: 'issue_updated',
      projectId: existing.projectId,
      payload: { issue: updated, changes },
      timestamp: new Date().toISOString(),
      userId: params.userId,
    };
    await redisPublish(`project:${existing.projectId}`, JSON.stringify(event));

    return updated;
  }

  static async getById(issueId: string) {
    const issue = await prisma.issue.findFirst({
      where: { id: issueId, deletedAt: null },
      include: {
        ...this.defaultInclude(),
        children: {
          where: { deletedAt: null },
          include: { status: true, assignee: { select: { id: true, displayName: true } } },
        },
        customValues: { include: { customField: true } },
        watchers: { include: { user: { select: { id: true, displayName: true, avatarUrl: true } } } },
      },
    });
    if (!issue) throw createError('Issue not found', 404);
    return issue;
  }

  static async getByKey(key: string) {
    const issue = await prisma.issue.findFirst({
      where: { key, deletedAt: null },
      include: {
        ...this.defaultInclude(),
        children: {
          where: { deletedAt: null },
          include: { status: true, assignee: { select: { id: true, displayName: true } } },
        },
        customValues: { include: { customField: true } },
        watchers: { include: { user: { select: { id: true, displayName: true, avatarUrl: true } } } },
      },
    });
    if (!issue) throw createError('Issue not found', 404);
    return issue;
  }

  static async delete(issueId: string, userId: string) {
    const resolvedIssue = await this.resolveIssueIdentifier(issueId);

    const issue = await prisma.issue.findFirst({
      where: { id: resolvedIssue.id, deletedAt: null },
      select: { id: true, key: true, projectId: true, title: true },
    });
    if (!issue) throw createError('Issue not found', 404);

    await prisma.issue.update({
      where: { id: resolvedIssue.id },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });

    await ActivityService.log({
      projectId: issue.projectId,
      userId,
      action: 'DELETED',
      entityType: 'Issue',
      entityId: issue.id,
      metadata: { issueKey: issue.key },
    });

    const event: WebSocketEvent = {
      type: 'issue_updated',
      projectId: issue.projectId,
      payload: { issueId: issue.id, deleted: true },
      timestamp: new Date().toISOString(),
      userId,
    };
    await redisPublish(`project:${issue.projectId}`, JSON.stringify(event));
  }

  static async getBoardState(projectId: string) {
    const [statuses, issues] = await Promise.all([
      prisma.workflowStatus.findMany({
        where: { projectId },
        orderBy: { position: 'asc' },
      }),
      prisma.issue.findMany({
        where: { projectId, deletedAt: null, sprint: { status: 'ACTIVE', deletedAt: null } },
        include: this.defaultInclude(),
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // Group issues by status
    const board: Record<string, typeof issues> = {};
    for (const status of statuses) {
      board[status.id] = issues.filter((i) => i.statusId === status.id);
    }

    return { statuses, board };
  }

  static async moveToSprint(issueId: string, sprintId: string | null, userId: string) {
    const resolvedIssue = await this.resolveIssueIdentifier(issueId);

    const issue = await prisma.issue.findFirst({
      where: { id: resolvedIssue.id, deletedAt: null },
      select: { id: true, key: true, projectId: true, sprintId: true, title: true },
    });
    if (!issue) throw createError('Issue not found', 404);

    if (sprintId) {
      const sprint = await prisma.sprint.findUnique({ where: { id: sprintId } });
      if (!sprint) throw createError('Sprint not found', 404);
    }

    const updated = await prisma.issue.update({
      where: { id: resolvedIssue.id },
      data: { sprintId, version: { increment: 1 } },
      include: this.defaultInclude(),
    });

    await ActivityService.log({
      projectId: issue.projectId,
      issueId: issue.id,
      userId,
      action: 'SPRINT_MOVED',
      entityType: 'Issue',
      entityId: issue.id,
      changes: { sprint: { old: issue.sprintId, new: sprintId } },
    });

    const event: WebSocketEvent = {
      type: 'issue_moved',
      projectId: issue.projectId,
      payload: { issue: updated, fromSprintId: issue.sprintId, toSprintId: sprintId },
      timestamp: new Date().toISOString(),
      userId,
    };
    await redisPublish(`project:${issue.projectId}`, JSON.stringify(event));

    return updated;
  }

  static async watchIssue(issueId: string, userId: string) {
    const resolvedIssue = await this.resolveIssueIdentifier(issueId);

    const issue = await prisma.issue.findFirst({
      where: { id: resolvedIssue.id, deletedAt: null },
      select: { id: true, projectId: true },
    });
    if (!issue) throw createError('Issue not found', 404);

    await prisma.issueWatcher.upsert({
      where: { issueId_userId: { issueId: issue.id, userId } },
      create: { issueId: issue.id, userId },
      update: {},
    });

    await ActivityService.log({
      projectId: issue.projectId,
      issueId: issue.id,
      userId,
      action: 'WATCHED',
      entityType: 'Issue',
      entityId: issue.id,
    });

    return { watching: true };
  }

  static async unwatchIssue(issueId: string, userId: string) {
    const resolvedIssue = await this.resolveIssueIdentifier(issueId);

    const issue = await prisma.issue.findFirst({
      where: { id: resolvedIssue.id, deletedAt: null },
      select: { id: true, projectId: true },
    });
    if (!issue) throw createError('Issue not found', 404);

    await prisma.issueWatcher.deleteMany({ where: { issueId: issue.id, userId } });

    await ActivityService.log({
      projectId: issue.projectId,
      issueId: issue.id,
      userId,
      action: 'UNWATCHED',
      entityType: 'Issue',
      entityId: issue.id,
    });

    return { watching: false };
  }

  static async bulkUpdate(params: {
    projectId: string;
    userId: string;
    issueIds: string[];
    data: {
      statusId?: string;
      assigneeId?: string;
      priority?: string;
      sprintId?: string | null;
      labels?: string[];
    };
  }) {
    const { projectId, issueIds, data, userId } = params;
    if (!issueIds.length) throw createError('No issueIds provided', 400);

    const validIssues = await prisma.issue.findMany({
      where: { id: { in: issueIds }, projectId, deletedAt: null },
      select: { id: true, key: true, title: true },
    });
    if (!validIssues.length) throw createError('No matching issues found for bulk update', 404);

    const updateData: Record<string, unknown> = { version: { increment: 1 } };
    if (data.statusId) updateData.statusId = data.statusId;
    if (data.assigneeId !== undefined) updateData.assigneeId = data.assigneeId;
    if (data.priority) updateData.priority = data.priority;
    if (data.sprintId !== undefined) updateData.sprintId = data.sprintId;
    if (data.labels) updateData.labels = data.labels;

    if (Object.keys(updateData).length <= 1) throw createError('No changes specified for bulk update', 400);

    await prisma.issue.updateMany({
      where: { id: { in: issueIds }, projectId, deletedAt: null },
      data: updateData,
    });

    const updatedIssues = await prisma.issue.findMany({
      where: { id: { in: issueIds }, deletedAt: null },
      include: this.defaultInclude(),
    });

    await ActivityService.log({
      projectId,
      issueId: validIssues[0].id,
      userId,
      action: 'UPDATED',
      entityType: 'Issue',
      entityId: validIssues[0].id,
      metadata: {
        issueIds: validIssues.map((issue) => issue.id),
        changes: data,
      },
    });

    await Promise.all(
      updatedIssues.map((updated) =>
        redisPublish(`project:${projectId}`,
          JSON.stringify({
            type: 'issue_updated',
            projectId,
            payload: { issue: updated },
            timestamp: new Date().toISOString(),
            userId,
          } as WebSocketEvent)
        )
      )
    );

    return updatedIssues;
  }

  static async linkIssues(params: {
    issueId: string;
    relatedIssueId: string;
    type: string;
    userId: string;
  }) {
    const [resolvedIssue, resolvedRelatedIssue] = await Promise.all([
      this.resolveIssueIdentifier(params.issueId),
      this.resolveIssueIdentifier(params.relatedIssueId),
    ]);

    const issue = await prisma.issue.findFirst({ where: { id: resolvedIssue.id, deletedAt: null } });
    const relatedIssue = await prisma.issue.findFirst({ where: { id: resolvedRelatedIssue.id, deletedAt: null } });
    if (!issue || !relatedIssue) throw createError('One or both related issues were not found', 404);
    if (issue.projectId !== relatedIssue.projectId) {
      throw createError('Issue relationships must exist within the same project', 400);
    }

    const relationship = await prisma.issueRelationship.upsert({
      where: {
        issueId_relatedIssueId_relationshipType: {
          issueId: resolvedIssue.id,
          relatedIssueId: resolvedRelatedIssue.id,
          relationshipType: params.type as any,
        },
      },
      create: {
        issueId: resolvedIssue.id,
        relatedIssueId: resolvedRelatedIssue.id,
        projectId: issue.projectId,
        relationshipType: params.type as any,
      },
      update: {},
      include: {
        relatedIssue: { select: { id: true, key: true, title: true, type: true, statusId: true } },
      },
    });

    await ActivityService.log({
      projectId: issue.projectId,
      issueId: issue.id,
      userId: params.userId,
      action: 'UPDATED',
      entityType: 'IssueRelationship',
      entityId: relationship.id,
      metadata: {
        relationshipType: params.type,
        relatedIssueId: relatedIssue.id,
      },
    });

    return relationship;
  }

  static async getRelationships(issueId: string) {
    const resolvedIssue = await this.resolveIssueIdentifier(issueId);

    return prisma.issueRelationship.findMany({
      where: {
        OR: [{ issueId: resolvedIssue.id }, { relatedIssueId: resolvedIssue.id }],
      },
      include: {
        issue: { select: { id: true, key: true, title: true } },
        relatedIssue: { select: { id: true, key: true, title: true } },
      },
    });
  }

  private static defaultInclude() {
    return {
      status: true,
      assignee: { select: { id: true, displayName: true, avatarUrl: true, email: true } },
      reporter: { select: { id: true, displayName: true, avatarUrl: true } },
      sprint: { select: { id: true, name: true, status: true, startDate: true, endDate: true } },
      parent: { select: { id: true, key: true, title: true, type: true } },
      project: { select: { id: true, key: true, name: true } },
    };
  }
}
