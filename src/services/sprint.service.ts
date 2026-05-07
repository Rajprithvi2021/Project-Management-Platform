import { prisma } from '../config/database';
import { createError } from '../middleware/errorHandler';
import { ActivityService } from './activity.service';
import { redisPublish } from '../config/redis';
import { WebSocketEvent } from '../types';

export class SprintService {
  static async create(params: {
    projectId: string;
    name: string;
    goal?: string;
    startDate?: Date;
    endDate?: Date;
    userId: string;
  }) {
    const project = await prisma.project.findUnique({ where: { id: params.projectId } });
    if (!project) throw createError('Project not found', 404);

    const sprint = await prisma.sprint.create({
      data: {
        projectId: params.projectId,
        name: params.name,
        goal: params.goal,
        startDate: params.startDate,
        endDate: params.endDate,
        createdById: params.userId,
      },
    });

    await ActivityService.log({
      projectId: params.projectId,
      userId: params.userId,
      action: 'CREATED',
      entityType: 'Sprint',
      entityId: sprint.id,
      metadata: { sprintName: params.name },
    });

    return sprint;
  }

  static async update(sprintId: string, userId: string, data: {
    name?: string;
    goal?: string;
    startDate?: Date;
    endDate?: Date;
  }) {
    const sprint = await prisma.sprint.findFirst({ where: { id: sprintId, deletedAt: null } });
    if (!sprint) throw createError('Sprint not found', 404);
    if (sprint.status === 'COMPLETED') throw createError('Cannot update a completed sprint', 400);

    const updated = await prisma.sprint.update({
      where: { id: sprintId },
      data,
    });

    const event: WebSocketEvent = {
      type: 'sprint_updated',
      projectId: sprint.projectId,
      payload: { sprint: updated },
      timestamp: new Date().toISOString(),
      userId,
    };
    await redisPublish(`project:${sprint.projectId}`, JSON.stringify(event));

    return updated;
  }

  static async delete(sprintId: string, userId: string) {
    const sprint = await prisma.sprint.findFirst({
      where: { id: sprintId, deletedAt: null },
      include: { _count: { select: { issues: true } } },
    });
    if (!sprint) throw createError('Sprint not found', 404);
    if (sprint.status === 'ACTIVE') throw createError('Cannot delete an active sprint', 400);

    // Move all issues back to backlog
    await prisma.issue.updateMany({
      where: { sprintId },
      data: { sprintId: null },
    });

    await prisma.sprint.update({
      where: { id: sprintId },
      data: { deletedAt: new Date() },
    });

    await ActivityService.log({
      projectId: sprint.projectId,
      userId,
      action: 'DELETED',
      entityType: 'Sprint',
      entityId: sprintId,
    });
  }

  static async start(sprintId: string, userId: string) {
    const sprint = await prisma.sprint.findFirst({
      where: { id: sprintId, deletedAt: null },
      include: { _count: { select: { issues: true } } },
    });
    if (!sprint) throw createError('Sprint not found', 404);
    if (sprint.status !== 'PLANNING') throw createError('Only planning sprints can be started', 400);

    // Check no other sprint is active for this project
    const activeSprint = await prisma.sprint.findFirst({
      where: { projectId: sprint.projectId, status: 'ACTIVE', deletedAt: null },
    });
    if (activeSprint) throw createError('Another sprint is already active for this project', 400);

    const updated = await prisma.sprint.update({
      where: { id: sprintId },
      data: {
        status: 'ACTIVE',
        startDate: sprint.startDate || new Date(),
      },
      include: { _count: { select: { issues: true } } },
    });

    await ActivityService.log({
      projectId: sprint.projectId,
      userId,
      action: 'SPRINT_STARTED',
      entityType: 'Sprint',
      entityId: sprintId,
      metadata: { sprintName: sprint.name },
    });

    const event: WebSocketEvent = {
      type: 'sprint_updated',
      projectId: sprint.projectId,
      payload: { sprint: updated, action: 'started' },
      timestamp: new Date().toISOString(),
      userId,
    };
    await redisPublish(`project:${sprint.projectId}`, JSON.stringify(event));

    return updated;
  }

  static async complete(params: {
    sprintId: string;
    userId: string;
    carryOverIssueIds?: string[];
    targetSprintId?: string;
  }) {
    const sprint = await prisma.sprint.findFirst({
      where: { id: params.sprintId, deletedAt: null },
      include: {
        issues: {
          where: { deletedAt: null },
          include: {
            status: { select: { category: true, name: true } },
          },
        },
      },
    });

    if (!sprint) throw createError('Sprint not found', 404);
    if (sprint.status !== 'ACTIVE') throw createError('Only active sprints can be completed', 400);

    // Separate completed vs incomplete issues
    const completedIssues = sprint.issues.filter((i) => i.status.category === 'DONE');
    const incompleteIssues = sprint.issues.filter((i) => i.status.category !== 'DONE');

    // Calculate velocity (sum of story points of completed issues)
    const velocity = completedIssues.reduce((sum, issue) => sum + (issue.storyPoints || 0), 0);

    // Handle carry-over
    const carryOverIds = params.carryOverIssueIds || [];
    if (carryOverIds.length > 0) {
      const targetSprintId = params.targetSprintId || null;
      // Validate carry-over issues belong to this sprint
      const validCarryOver = carryOverIds.filter((id) =>
        incompleteIssues.some((i) => i.id === id)
      );

      if (validCarryOver.length > 0) {
        await prisma.issue.updateMany({
          where: { id: { in: validCarryOver } },
          data: { sprintId: targetSprintId, version: { increment: 1 } },
        });

        // Log carry-over activity
        for (const issueId of validCarryOver) {
          await ActivityService.log({
            projectId: sprint.projectId,
            issueId,
            userId: params.userId,
            action: 'SPRINT_MOVED',
            entityType: 'Issue',
            entityId: issueId,
            changes: { sprint: { old: params.sprintId, new: targetSprintId } },
            metadata: { reason: 'carry-over', fromSprint: sprint.name },
          });
        }
      }
    }

    // Move remaining incomplete issues to backlog (no sprint)
    const moveToBacklog = incompleteIssues
      .filter((i) => !carryOverIds.includes(i.id))
      .map((i) => i.id);

    if (moveToBacklog.length > 0) {
      await prisma.issue.updateMany({
        where: { id: { in: moveToBacklog } },
        data: { sprintId: null },
      });
    }

    // Complete the sprint
    const completed = await prisma.sprint.update({
      where: { id: params.sprintId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        velocity,
      },
    });

    await ActivityService.log({
      projectId: sprint.projectId,
      userId: params.userId,
      action: 'SPRINT_COMPLETED',
      entityType: 'Sprint',
      entityId: params.sprintId,
      metadata: {
        sprintName: sprint.name,
        velocity,
        completedIssues: completedIssues.length,
        incompleteIssues: incompleteIssues.length,
        carriedOver: carryOverIds.length,
      },
    });

    const event: WebSocketEvent = {
      type: 'sprint_updated',
      projectId: sprint.projectId,
      payload: { sprint: completed, action: 'completed', velocity },
      timestamp: new Date().toISOString(),
      userId: params.userId,
    };
    await redisPublish(`project:${sprint.projectId}`, JSON.stringify(event));

    return {
      sprint: completed,
      velocity,
      completedIssues: completedIssues.length,
      incompleteIssues: incompleteIssues.map((i) => ({
        id: i.id,
        key: i.key,
        title: i.title,
        storyPoints: i.storyPoints,
        status: i.status.name,
      })),
      movedToBacklog: moveToBacklog.length,
      carriedOver: carryOverIds.length,
    };
  }

  static async getByProject(projectId: string, status?: string) {
    return prisma.sprint.findMany({
      where: {
        projectId,
        deletedAt: null,
        ...(status ? { status: status as any } : {}),
      },
      include: {
        _count: { select: { issues: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async getById(sprintId: string) {
    const sprint = await prisma.sprint.findFirst({
      where: { id: sprintId, deletedAt: null },
      include: {
        issues: {
          where: { deletedAt: null },
          include: {
            status: true,
            assignee: { select: { id: true, displayName: true, avatarUrl: true } },
          },
        },
        _count: { select: { issues: true } },
      },
    });
    if (!sprint) throw createError('Sprint not found', 404);
    return sprint;
  }

  static async getVelocityReport(projectId: string) {
    const completedSprints = await prisma.sprint.findMany({
      where: { projectId, status: 'COMPLETED', deletedAt: null },
      select: {
        id: true,
        name: true,
        velocity: true,
        startDate: true,
        endDate: true,
        completedAt: true,
      },
      orderBy: { completedAt: 'asc' },
    });

    const avgVelocity =
      completedSprints.length > 0
        ? completedSprints.reduce((sum, s) => sum + (s.velocity || 0), 0) / completedSprints.length
        : 0;

    return { sprints: completedSprints, averageVelocity: avgVelocity };
  }

  static async getBacklog(projectId: string, cursor?: string, limit = 50) {
    const where: Record<string, unknown> = { projectId, sprintId: null, deletedAt: null };
    if (cursor) {
      where.id = { lt: cursor };
    }

    const issues = await prisma.issue.findMany({
      where,
      take: limit + 1,
      orderBy: { createdAt: 'desc' },
      include: {
        status: true,
        assignee: { select: { id: true, displayName: true, avatarUrl: true } },
      },
    });

    const hasMore = issues.length > limit;
    if (hasMore) issues.pop();

    return {
      data: issues,
      pagination: { hasMore, nextCursor: hasMore ? issues[issues.length - 1]?.id : undefined },
    };
  }
}
