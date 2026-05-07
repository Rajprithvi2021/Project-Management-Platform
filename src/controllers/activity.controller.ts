import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { ActivityService } from '../services/activity.service';
import { NotificationService } from '../services/notification.service';
import { WorkflowService } from '../services/workflow.service';

export class ActivityController {
  static async getProjectFeed(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await ActivityService.getProjectFeed({
        projectId: req.params.projectId as string,
        cursor: req.query.cursor as string,
        limit: parseInt(req.query.limit as string) || 20,
        userId: req.query.userId as string,
        issueId: req.query.issueId as string,
        action: req.query.action as string,
      });
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  static async getNotifications(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await NotificationService.getForUser(
        req.user!.id,
        req.query.cursor as string,
        parseInt(req.query.limit as string) || 20
      );
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  static async markNotificationsRead(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { notificationIds } = req.body;
      await NotificationService.markRead(notificationIds, req.user!.id);
      res.json({ success: true, message: 'Notifications marked as read' });
    } catch (error) {
      next(error);
    }
  }

  static async getUnreadCount(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const count = await NotificationService.getUnreadCount(req.user!.id);
      res.json({ success: true, data: { count } });
    } catch (error) {
      next(error);
    }
  }

  static async getWorkflow(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const workflow = await WorkflowService.getProjectWorkflow(req.params.projectId as string);
      res.json({ success: true, data: workflow });
    } catch (error) {
      next(error);
    }
  }

  static async createStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const status = await WorkflowService.createStatus(req.params.projectId as string, req.body);
      res.status(201).json({ success: true, data: status });
    } catch (error) {
      next(error);
    }
  }

  static async createTransition(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const transition = await WorkflowService.createTransition(req.params.projectId as string, req.body);
      res.status(201).json({ success: true, data: transition });
    } catch (error) {
      next(error);
    }
  }
}
