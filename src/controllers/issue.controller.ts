import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { IssueService } from '../services/issue.service';
import { WorkflowService } from '../services/workflow.service';
import { CommentService } from '../services/comment.service';
import { ActivityService } from '../services/activity.service';
import { ProjectService } from '../services/project.service';

function p(req: AuthenticatedRequest, ...keys: string[]): string {
  for (const key of keys) {
    const v = req.params[key];
    if (v) return v as string;
  }
  return '';
}

export class IssueController {
  static async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const issue = await IssueService.create({
        ...req.body,
        projectId: p(req, 'projectId'),
        reporterId: req.user!.id,
      });
      res.status(201).json({ success: true, data: issue });
    } catch (error) { next(error); }
  }

  static async getById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const identifier = p(req, 'issueId', 'id');
      const issue = identifier.includes('-')
        ? await IssueService.getByKey(identifier)
        : await IssueService.getById(identifier);
      res.json({ success: true, data: issue });
    } catch (error) { next(error); }
  }

  static async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { version, ...data } = req.body;
      const issue = await IssueService.update({
        issueId: p(req, 'issueId', 'id'),
        userId: req.user!.id,
        version: version || 1,
        data,
      });
      res.json({ success: true, data: issue });
    } catch (error) { next(error); }
  }

  static async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await IssueService.delete(p(req, 'issueId', 'id'), req.user!.id);
      res.json({ success: true, message: 'Issue deleted' });
    } catch (error) { next(error); }
  }

  static async getBoardState(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const board = await IssueService.getBoardState(p(req, 'projectId'));
      res.json({ success: true, data: board });
    } catch (error) { next(error); }
  }

  static async transition(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const issue = await WorkflowService.transition({
        issueId: p(req, 'issueId', 'id'),
        toStatusId: req.body.toStatusId,
        userId: req.user!.id,
        comment: req.body.comment,
      });
      res.json({ success: true, data: issue });
    } catch (error) {
      const appError = error as any;
      if (appError.statusCode === 422 && appError.allowedTransitions) {
        res.status(422).json({
          success: false,
          error: appError.message,
          allowedTransitions: appError.allowedTransitions,
        });
        return;
      }
      next(error);
    }
  }

  static async getAvailableTransitions(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const transitions = await WorkflowService.getAvailableTransitions(p(req, 'issueId', 'id'));
      res.json({ success: true, data: transitions });
    } catch (error) { next(error); }
  }

  static async moveToSprint(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const issue = await IssueService.moveToSprint(
        p(req, 'issueId', 'id'),
        req.body.sprintId,
        req.user!.id
      );
      res.json({ success: true, data: issue });
    } catch (error) { next(error); }
  }

  static async watch(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await IssueService.watchIssue(p(req, 'issueId', 'id'), req.user!.id);
      res.json({ success: true, data: result });
    } catch (error) { next(error); }
  }

  static async unwatch(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await IssueService.unwatchIssue(p(req, 'issueId', 'id'), req.user!.id);
      res.json({ success: true, data: result });
    } catch (error) { next(error); }
  }

  static async getComments(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await CommentService.getByIssue(
        p(req, 'issueId', 'id'),
        req.query.cursor as string,
        parseInt(req.query.limit as string) || 20
      );
      res.json({ success: true, ...result });
    } catch (error) { next(error); }
  }

  static async addComment(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const comment = await CommentService.create({
        issueId: p(req, 'issueId', 'id'),
        authorId: req.user!.id,
        content: req.body.content,
        parentId: req.body.parentId,
      });
      res.status(201).json({ success: true, data: comment });
    } catch (error) { next(error); }
  }

  static async updateComment(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const comment = await CommentService.update(
        req.params.commentId as string,
        req.user!.id,
        req.body.content
      );
      res.json({ success: true, data: comment });
    } catch (error) { next(error); }
  }

  static async deleteComment(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await CommentService.delete(req.params.commentId as string, req.user!.id);
      res.json({ success: true, message: 'Comment deleted' });
    } catch (error) { next(error); }
  }

  static async getActivity(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const issueId = p(req, 'issueId', 'id');
      const result = await ActivityService.getProjectFeed({
        projectId: p(req, 'projectId'),
        issueId: issueId || undefined,
        cursor: req.query.cursor as string,
        limit: parseInt(req.query.limit as string) || 20,
      });
      res.json({ success: true, ...result });
    } catch (error) { next(error); }
  }

  static async bulkUpdate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const issueIds = req.body.issueIds as string[];
      const issue = await IssueService.bulkUpdate({
        projectId: p(req, 'projectId'),
        userId: req.user!.id,
        issueIds,
        data: {
          statusId: req.body.statusId,
          assigneeId: req.body.assigneeId,
          priority: req.body.priority,
          sprintId: req.body.sprintId,
          labels: req.body.labels,
        },
      });
      res.json({ success: true, data: issue });
    } catch (error) { next(error); }
  }

  static async getRelationships(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const relationships = await IssueService.getRelationships(p(req, 'issueId', 'id'));
      res.json({ success: true, data: relationships });
    } catch (error) { next(error); }
  }

  static async linkRelationship(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const relationship = await IssueService.linkIssues({
        issueId: p(req, 'issueId', 'id'),
        relatedIssueId: req.body.relatedIssueId,
        type: req.body.type,
        userId: req.user!.id,
      });
      res.status(201).json({ success: true, data: relationship });
    } catch (error) { next(error); }
  }

  static async setCustomFieldValue(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const value = await ProjectService.setCustomFieldValue(
        p(req, 'issueId', 'id'),
        req.params.fieldId as string,
        req.body.value
      );
      res.json({ success: true, data: value });
    } catch (error) { next(error); }
  }
}
