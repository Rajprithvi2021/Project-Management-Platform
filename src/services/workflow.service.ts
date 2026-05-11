import { prisma } from '../config/database';
import { createError } from '../middleware/errorHandler';
import { ActivityService } from './activity.service';
import { NotificationService } from './notification.service';
import { redisPublish } from '../config/redis';
import { WebSocketEvent } from '../types';
import { IssueService } from './issue.service';

export class WorkflowService {
  /**
   * Validates and executes a status transition for an issue.
   * Returns 422 if the transition is not allowed.
   */
  static async transition(params: {
    issueId: string;
    toStatusId: string;
    userId: string;
    comment?: string;
  }) {
    const resolvedIssue = await IssueService.resolveIssueIdentifier(params.issueId);

    const issue = await prisma.issue.findUnique({
      where: { id: resolvedIssue.id },
      include: {
        status: true,
        project: true,
        assignee: { select: { id: true, displayName: true } },
      },
    });

    if (!issue) throw createError('Issue not found', 404);

    const toStatus = await prisma.workflowStatus.findUnique({
      where: { id: params.toStatusId },
    });

    if (!toStatus || toStatus.projectId !== issue.projectId) {
      throw createError('Target status not found in this project', 404);
    }

    // Check if transition is allowed
    const transition = await prisma.workflowTransition.findUnique({
      where: {
        projectId_fromStatusId_toStatusId: {
          projectId: issue.projectId,
          fromStatusId: issue.statusId,
          toStatusId: params.toStatusId,
        },
      },
    });

    if (!transition) {
      // Build allowed transitions for the error message
      const allowedTransitions = await prisma.workflowTransition.findMany({
        where: { projectId: issue.projectId, fromStatusId: issue.statusId },
        include: { toStatus: { select: { id: true, name: true } } },
      });

      throw Object.assign(
        createError(
          `Transition from "${issue.status.name}" to "${toStatus.name}" is not allowed`,
          422
        ),
        {
          allowedTransitions: allowedTransitions.map((t) => ({
            statusId: t.toStatus.id,
            statusName: t.toStatus.name,
          })),
        }
      );
    }

    // Validate conditions
    if (transition.conditions) {
      await this.validateConditions(issue, transition.conditions as any[]);
    }

    const oldStatus = issue.status;

    // Update issue status with optimistic locking
    const updated = await prisma.issue.update({
      where: { id: resolvedIssue.id },
      data: {
        statusId: params.toStatusId,
        version: { increment: 1 },
        resolvedAt: toStatus.category === 'DONE' ? new Date() : null,
      },
      include: {
        status: true,
        assignee: { select: { id: true, displayName: true, email: true } },
        reporter: { select: { id: true, displayName: true } },
        project: { select: { id: true, key: true, name: true } },
      },
    });

    // Log activity
    await ActivityService.log({
      projectId: issue.projectId,
      issueId: issue.id,
      userId: params.userId,
      action: 'STATUS_CHANGED',
      entityType: 'Issue',
      entityId: issue.id,
      changes: {
        status: { old: oldStatus.name, new: toStatus.name },
      },
    });

    // Execute automation actions
    if (transition.actions) {
      await this.executeActions(updated, transition.actions as any[], params.userId);
    }

    // Check automation rules
    await this.checkAutomationRules(updated, issue.statusId, params.toStatusId, params.userId);

    // Notify watchers
    await NotificationService.notifyWatchers({
      issueId: issue.id,
      projectId: issue.projectId,
      excludeUserId: params.userId,
      type: 'STATUS_CHANGED',
      title: `${issue.key} status updated`,
      body: `"${issue.title}" moved from ${oldStatus.name} to ${toStatus.name}`,
    });

    // Emit WebSocket event
    const event: WebSocketEvent = {
      type: 'issue_updated',
      projectId: issue.projectId,
      payload: { issue: updated, changeType: 'status_changed' },
      timestamp: new Date().toISOString(),
      userId: params.userId,
    };
    await redisPublish(`project:${issue.projectId}`, JSON.stringify(event));

    return updated;
  }

  static async getAvailableTransitions(issueId: string) {
    const resolvedIssue = await IssueService.resolveIssueIdentifier(issueId);

    const issue = await prisma.issue.findUnique({
      where: { id: resolvedIssue.id },
      select: { projectId: true, statusId: true, status: { select: { name: true } } },
    });
    if (!issue) throw createError('Issue not found', 404);

    return prisma.workflowTransition.findMany({
      where: { projectId: issue.projectId, fromStatusId: issue.statusId },
      include: { toStatus: { select: { id: true, name: true, color: true, category: true } } },
    });
  }

  static async getProjectWorkflow(projectId: string) {
    const [statuses, transitions] = await Promise.all([
      prisma.workflowStatus.findMany({
        where: { projectId },
        orderBy: { position: 'asc' },
      }),
      prisma.workflowTransition.findMany({
        where: { projectId },
        include: {
          fromStatus: { select: { id: true, name: true } },
          toStatus: { select: { id: true, name: true } },
        },
      }),
    ]);
    return { statuses, transitions };
  }

  static async createStatus(projectId: string, data: {
    name: string;
    category: string;
    color?: string;
    position?: number;
  }) {
    return prisma.workflowStatus.create({
      data: {
        projectId,
        name: data.name,
        category: data.category as any,
        color: data.color || '#6B7280',
        position: data.position || 0,
      },
    });
  }

  static async createTransition(projectId: string, data: {
    fromStatusId: string;
    toStatusId: string;
    name?: string;
    conditions?: object[];
    actions?: object[];
  }) {
    const existingTransition = await prisma.workflowTransition.findUnique({
      where: {
        projectId_fromStatusId_toStatusId: {
          projectId,
          fromStatusId: data.fromStatusId,
          toStatusId: data.toStatusId,
        },
      },
    });

    if (existingTransition) {
      throw createError('A workflow transition with the same source and destination already exists', 409);
    }

    return prisma.workflowTransition.create({
      data: {
        projectId,
        fromStatusId: data.fromStatusId,
        toStatusId: data.toStatusId,
        name: data.name,
        conditions: data.conditions as any,
        actions: data.actions as any,
      },
    });
  }

  private static async validateConditions(issue: any, conditions: any[]) {
    for (const condition of conditions) {
      if (condition.type === 'REQUIRED_FIELD') {
        const fieldValue = issue[condition.field];
        if (!fieldValue) {
          throw createError(
            `Transition blocked: field "${condition.field}" is required`,
            422
          );
        }
      }
      if (condition.type === 'REQUIRED_CUSTOM_FIELD') {
        const customValue = await prisma.customFieldValue.findFirst({
          where: { issueId: issue.id, customFieldId: condition.customFieldId },
        });
        if (!customValue) {
          throw createError(
            `Transition blocked: custom field is required before this transition`,
            422
          );
        }
      }
    }
  }

  private static async executeActions(issue: any, actions: any[], userId: string) {
    for (const action of actions) {
      if (action.type === 'ASSIGN_USER' && action.userId) {
        await prisma.issue.update({
          where: { id: issue.id },
          data: { assigneeId: action.userId },
        });
        await NotificationService.create({
          userId: action.userId,
          type: 'ASSIGNED',
          title: `You were assigned to ${issue.key}`,
          body: `Auto-assigned to "${issue.title}"`,
          issueId: issue.id,
          projectId: issue.projectId,
        });
      }
      if (action.type === 'SET_PRIORITY' && action.priority) {
        await prisma.issue.update({
          where: { id: issue.id },
          data: { priority: action.priority },
        });
      }
    }
  }

  private static async checkAutomationRules(
    issue: any,
    fromStatusId: string,
    toStatusId: string,
    userId: string
  ) {
    const rules = await prisma.automationRule.findMany({
      where: {
        projectId: issue.projectId,
        isActive: true,
      },
    });

    for (const rule of rules) {
      const trigger = rule.trigger as any;
      if (
        trigger.type === 'TRANSITION' &&
        trigger.fromStatusId === fromStatusId &&
        trigger.toStatusId === toStatusId
      ) {
        await this.executeActions(issue, rule.actions as any[], userId);
      }
    }
  }
}
