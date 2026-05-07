import { prisma } from '../config/database';
import { createError } from '../middleware/errorHandler';
import { ActivityService } from './activity.service';
import { NotificationService } from './notification.service';
import { redisPublish } from '../config/redis';
import { WebSocketEvent } from '../types';

export class CommentService {
  static async create(params: {
    issueId: string;
    authorId: string;
    content: string;
    parentId?: string;
  }) {
    const issue = await prisma.issue.findFirst({
      where: { id: params.issueId, deletedAt: null },
      select: { id: true, key: true, title: true, projectId: true },
    });
    if (!issue) throw createError('Issue not found', 404);

    if (params.parentId) {
      const parent = await prisma.comment.findFirst({
        where: { id: params.parentId, deletedAt: null },
      });
      if (!parent || parent.issueId !== params.issueId) {
        throw createError('Parent comment not found', 404);
      }
    }

    // Extract @mentions from content
    const mentionPattern = /@\[([^\]]+)\]\(([^)]+)\)/g;
    const mentions: string[] = [];
    let match;
    while ((match = mentionPattern.exec(params.content)) !== null) {
      mentions.push(match[2]); // user ID
    }

    const comment = await prisma.comment.create({
      data: {
        issueId: params.issueId,
        authorId: params.authorId,
        content: params.content,
        parentId: params.parentId,
        mentions,
      },
      include: {
        author: { select: { id: true, displayName: true, avatarUrl: true } },
        replies: {
          include: {
            author: { select: { id: true, displayName: true, avatarUrl: true } },
          },
        },
      },
    });

    await prisma.issueWatcher.upsert({
      where: { issueId_userId: { issueId: params.issueId, userId: params.authorId } },
      create: { issueId: params.issueId, userId: params.authorId },
      update: {},
    });

    // Log activity
    await ActivityService.log({
      projectId: issue.projectId,
      issueId: issue.id,
      userId: params.authorId,
      action: 'COMMENTED',
      entityType: 'Comment',
      entityId: comment.id,
      metadata: { issueKey: issue.key },
    });

    // Notify mentioned users
    for (const mentionedUserId of mentions) {
      if (mentionedUserId !== params.authorId) {
        await NotificationService.create({
          userId: mentionedUserId,
          type: 'MENTIONED',
          title: `You were mentioned in ${issue.key}`,
          body: `Someone mentioned you in a comment on "${issue.title}"`,
          issueId: issue.id,
          projectId: issue.projectId,
        });
      }
    }

    // Notify watchers
    await NotificationService.notifyWatchers({
      issueId: issue.id,
      projectId: issue.projectId,
      excludeUserId: params.authorId,
      type: 'COMMENT_ADDED',
      title: `New comment on ${issue.key}`,
      body: `A new comment was added to "${issue.title}"`,
    });

    // Emit WebSocket event
    const event: WebSocketEvent = {
      type: 'comment_added',
      projectId: issue.projectId,
      payload: { comment, issueId: issue.id },
      timestamp: new Date().toISOString(),
      userId: params.authorId,
    };
    await redisPublish(`project:${issue.projectId}`, JSON.stringify(event));

    return comment;
  }

  static async update(commentId: string, userId: string, content: string) {
    const comment = await prisma.comment.findFirst({
      where: { id: commentId, deletedAt: null },
      include: { issue: { select: { projectId: true } } },
    });
    if (!comment) throw createError('Comment not found', 404);
    if (comment.authorId !== userId) throw createError('Not authorized to edit this comment', 403);

    return prisma.comment.update({
      where: { id: commentId },
      data: { content, isEdited: true },
      include: {
        author: { select: { id: true, displayName: true, avatarUrl: true } },
      },
    });
  }

  static async delete(commentId: string, userId: string) {
    const comment = await prisma.comment.findFirst({
      where: { id: commentId, deletedAt: null },
      select: { id: true, authorId: true, issueId: true },
    });
    if (!comment) throw createError('Comment not found', 404);
    if (comment.authorId !== userId) throw createError('Not authorized to delete this comment', 403);

    // Soft delete: just clear content
    await prisma.comment.update({
      where: { id: commentId },
      data: { content: '[deleted]', isEdited: true, deletedAt: new Date() },
    });
  }

  static async getByIssue(issueId: string, cursor?: string, limit = 20) {
    const where: Record<string, unknown> = { issueId, parentId: null, deletedAt: null }; // Only top-level
    if (cursor) {
      where.id = { gt: cursor };
    }

    const comments = await prisma.comment.findMany({
      where,
      take: limit + 1,
      orderBy: { createdAt: 'asc' },
      include: {
        author: { select: { id: true, displayName: true, avatarUrl: true } },
        replies: {
          where: { deletedAt: null },
          include: {
            author: { select: { id: true, displayName: true, avatarUrl: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    const hasMore = comments.length > limit;
    if (hasMore) comments.pop();

    return {
      data: comments,
      pagination: { hasMore, nextCursor: hasMore ? comments[comments.length - 1]?.id : undefined },
    };
  }
}
