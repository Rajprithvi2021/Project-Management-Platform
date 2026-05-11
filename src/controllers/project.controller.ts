import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { ProjectService } from '../services/project.service';

function projectId(req: AuthenticatedRequest): string {
  return (req.params.projectId || req.params.id) as string;
}

export class ProjectController {
  static async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const project = await ProjectService.create({ ...req.body, ownerId: req.user!.id });
      res.status(201).json({ success: true, data: project });
    } catch (error) { next(error); }
  }

  static async getById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const project = await ProjectService.getById(projectId(req));
      res.json({ success: true, data: project });
    } catch (error) { next(error); }
  }

  static async getMyProjects(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const projects = await ProjectService.getForUser(req.user!.id);
      res.json({ success: true, data: projects });
    } catch (error) { next(error); }
  }

  static async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const project = await ProjectService.update(projectId(req), req.body);
      res.json({ success: true, data: project });
    } catch (error) { next(error); }
  }

  static async addMember(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const member = await ProjectService.addMember(projectId(req), req.body.userId, req.body.role);
      res.status(201).json({ success: true, data: member });
    } catch (error) { next(error); }
  }

  static async removeMember(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await ProjectService.removeMember(projectId(req), req.params.userId as string);
      res.json({ success: true, message: 'Member removed' });
    } catch (error) { next(error); }
  }

  static async getCustomFields(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const fields = await ProjectService.getCustomFields(projectId(req));
      res.json({ success: true, data: fields });
    } catch (error) { next(error); }
  }

  static async createCustomField(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const field = await ProjectService.createCustomField(projectId(req), req.body);
      res.status(201).json({ success: true, data: field });
    } catch (error) { next(error); }
  }
  static async getBoard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const board = await ProjectService.getBoard(projectId(req));

      return res.json({
        success: true,
        data: board,
      });
    } catch (error) {
      next(error);
    }
  }
}
