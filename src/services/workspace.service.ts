import { prisma } from '../config/database';
import { createError } from '../middleware/errorHandler';

export class WorkspaceService {
  static async create(params: { name: string; description?: string; ownerId: string }) {
    const existing = await prisma.workspace.findFirst({ where: { name: params.name, deletedAt: null } });
    if (existing) throw createError('Workspace name already exists', 409);

    const workspace = await prisma.workspace.create({
      data: {
        name: params.name,
        description: params.description,
        ownerId: params.ownerId,
      },
      include: {
        members: { include: { user: { select: { id: true, email: true, displayName: true, avatarUrl: true } } } },
      },
    });

    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: params.ownerId, role: 'OWNER' },
    });

    return workspace;
  }

  static async getById(workspaceId: string) {
    const workspace = await prisma.workspace.findFirst({
      where: { id: workspaceId, deletedAt: null },
      include: {
        members: { include: { user: { select: { id: true, email: true, displayName: true, avatarUrl: true } } } },
        projects: { select: { id: true, key: true, name: true } },
      },
    });
    if (!workspace) throw createError('Workspace not found', 404);
    return workspace;
  }

  static async getForUser(userId: string) {
    return prisma.workspace.findMany({
      where: {
        members: { some: { userId } },
        deletedAt: null,
      },
      include: {
        members: { include: { user: { select: { id: true, displayName: true, email: true, avatarUrl: true } } } },
        projects: { select: { id: true, name: true, key: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }
}
