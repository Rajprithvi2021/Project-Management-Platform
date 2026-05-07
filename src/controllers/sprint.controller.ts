import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { SprintService } from '../services/sprint.service';

function sprintId(req: AuthenticatedRequest): string {
  return (req.params.sprintId || req.params.id) as string;
}

export class SprintController {
  static async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const sprint = await SprintService.create({
        ...req.body,
        projectId: req.params.projectId as string,
        userId: req.user!.id,
        startDate: req.body.startDate ? new Date(req.body.startDate) : undefined,
        endDate: req.body.endDate ? new Date(req.body.endDate) : undefined,
      });
      res.status(201).json({ success: true, data: sprint });
    } catch (error) { next(error); }
  }

  static async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const sprints = await SprintService.getByProject(
        req.params.projectId as string,
        req.query.status as string
      );
      res.json({ success: true, data: sprints });
    } catch (error) { next(error); }
  }

  static async getById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const sprint = await SprintService.getById(sprintId(req));
      res.json({ success: true, data: sprint });
    } catch (error) { next(error); }
  }

  static async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const sprint = await SprintService.update(sprintId(req), req.user!.id, {
        ...req.body,
        startDate: req.body.startDate ? new Date(req.body.startDate) : undefined,
        endDate: req.body.endDate ? new Date(req.body.endDate) : undefined,
      });
      res.json({ success: true, data: sprint });
    } catch (error) { next(error); }
  }

  static async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await SprintService.delete(sprintId(req), req.user!.id);
      res.json({ success: true, message: 'Sprint deleted' });
    } catch (error) { next(error); }
  }

  static async start(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const sprint = await SprintService.start(sprintId(req), req.user!.id);
      res.json({ success: true, data: sprint });
    } catch (error) { next(error); }
  }

  static async complete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await SprintService.complete({
        sprintId: sprintId(req),
        userId: req.user!.id,
        carryOverIssueIds: req.body.carryOverIssueIds,
        targetSprintId: req.body.targetSprintId,
      });
      res.json({ success: true, data: result });
    } catch (error) { next(error); }
  }

  static async getVelocity(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const report = await SprintService.getVelocityReport(req.params.projectId as string);
      res.json({ success: true, data: report });
    } catch (error) { next(error); }
  }

  static async getBacklog(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await SprintService.getBacklog(
        req.params.projectId as string,
        req.query.cursor as string,
        parseInt(req.query.limit as string) || 50
      );
      res.json({ success: true, ...result });
    } catch (error) { next(error); }
  }
}
