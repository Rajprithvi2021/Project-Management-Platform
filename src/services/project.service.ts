import { prisma } from '../config/database';
import { createError } from '../middleware/errorHandler';

export class ProjectService {
  static async create(params: {
    key: string;
    name: string;
    description?: string;
    ownerId: string;
    workspaceId?: string;
    workspaceName?: string;
  }) {
    // Normalize key to uppercase
    const key = params.key.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!key || key.length < 2 || key.length > 10) {
      throw createError('Project key must be 2-10 uppercase alphanumeric characters', 400);
    }

    const existing = await prisma.project.findFirst({ where: { key, deletedAt: null } });
    if (existing) throw createError('Project key already in use', 409);

    const project = await prisma.$transaction(async (tx: any) => {
      let workspaceId = params.workspaceId;

      if (workspaceId) {
        const workspace = await tx.workspace.findFirst({ where: { id: workspaceId, deletedAt: null } });
        if (!workspace) throw createError('Workspace not found', 404);
        const membership = await tx.workspaceMember.findFirst({
          where: { workspaceId, userId: params.ownerId },
        });
        if (!membership) {
          throw createError('User must be a member of the workspace to create a project', 403);
        }
      } else {
        const workspace = await tx.workspace.create({
          data: {
            name: params.workspaceName || `${params.key} Workspace`,
            description: params.description,
            ownerId: params.ownerId,
          },
        });
        await tx.workspaceMember.create({
          data: { workspaceId: workspace.id, userId: params.ownerId, role: 'OWNER' },
        });
        workspaceId = workspace.id;
      }

      const p = await tx.project.create({
        data: { key, name: params.name, description: params.description, workspaceId },
      });

      // Add owner as project member
      await tx.projectMember.create({
        data: { projectId: p.id, userId: params.ownerId, role: 'OWNER' },
      });

      // Create default workflow statuses
      const defaultStatuses = [
        { name: 'To Do', category: 'TODO', color: '#6B7280', position: 0, isDefault: true },
        { name: 'In Progress', category: 'IN_PROGRESS', color: '#3B82F6', position: 1 },
        { name: 'In Review', category: 'IN_PROGRESS', color: '#F59E0B', position: 2 },
        { name: 'Done', category: 'DONE', color: '#10B981', position: 3 },
      ];

      const statuses = [];
      for (const s of defaultStatuses) {
        const status = await tx.workflowStatus.create({
          data: { projectId: p.id, ...s as any },
        });
        statuses.push(status);
      }

      // Create default transition rules
      const [todo, inProgress, inReview, done] = statuses;
      const transitions = [
        { fromStatusId: todo.id, toStatusId: inProgress.id, name: 'Start Progress' },
        { fromStatusId: inProgress.id, toStatusId: inReview.id, name: 'Submit for Review' },
        { fromStatusId: inReview.id, toStatusId: inProgress.id, name: 'Request Changes' },
        { fromStatusId: inReview.id, toStatusId: done.id, name: 'Approve & Close' },
        { fromStatusId: inProgress.id, toStatusId: todo.id, name: 'Stop Progress' },
        { fromStatusId: done.id, toStatusId: inProgress.id, name: 'Reopen' },
      ];

      for (const t of transitions) {
        await tx.workflowTransition.create({
          data: { projectId: p.id, ...t },
        });
      }

      return p;
    });

    return this.getById(project.id);
  }

  static async getById(projectId: string) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      include: {
        workspace: { select: { id: true, name: true } },
        members: {
          include: { user: { select: { id: true, displayName: true, email: true, avatarUrl: true } } },
        },
        _count: {
          select: { issues: true, sprints: true },
        },
      },
    });
    if (!project) throw createError('Project not found', 404);
    return project;
  }

  static async getForUser(userId: string) {
    return prisma.project.findMany({
      where: {
        members: { some: { userId } },
        status: { not: 'DELETED' },
        deletedAt: null,
      },
      include: {
        _count: { select: { issues: true, sprints: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  static async addMember(projectId: string, userId: string, role: string = 'MEMBER') {
    const project = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null } });
    if (!project) throw createError('Project not found', 404);

    const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw createError('User not found', 404);

    return prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId } },
      create: { projectId, userId, role: role as any },
      update: { role: role as any },
      include: { user: { select: { id: true, displayName: true, email: true } } },
    });
  }

  static async removeMember(projectId: string, userId: string) {
    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId } },
    });
  }

  static async update(projectId: string, data: {
    name?: string;
    description?: string;
    status?: string;
  }) {
    const project = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null } });
    if (!project) throw createError('Project not found', 404);

    return prisma.project.update({
      where: { id: projectId },
      data: data as any,
    });
  }

  static async getCustomFields(projectId: string) {
    return prisma.customField.findMany({
      where: { projectId },
      orderBy: { position: 'asc' },
    });
  }

  static async createCustomField(projectId: string, data: {
    name: string;
    type: string;
    options?: string[];
    isRequired?: boolean;
    position?: number;
  }) {
    return prisma.customField.create({
      data: {
        projectId,
        name: data.name,
        type: data.type as any,
        options: data.options as any,
        isRequired: data.isRequired || false,
        position: data.position || 0,
      },
    });
  }

  static async setCustomFieldValue(issueId: string, customFieldId: string, value: unknown) {
    const issue = await prisma.issue.findFirst({
      where: { id: issueId, deletedAt: null },
      select: { projectId: true },
    });
    if (!issue) throw createError('Issue not found', 404);

    const field = await prisma.customField.findFirst({
      where: { id: customFieldId, projectId: issue.projectId },
    });
    if (!field) throw createError('Custom field not found', 404);

    return prisma.customFieldValue.upsert({
      where: { customFieldId_issueId: { customFieldId, issueId } },
      create: { customFieldId, issueId, value: value as any },
      update: { value: value as any },
    });
  }
}
