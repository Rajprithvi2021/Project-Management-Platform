import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { WorkspaceService } from '../services/workspace.service';

export class WorkspaceController {
  static async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const workspaces = await WorkspaceService.getForUser(req.user!.id);
      res.json({ success: true, data: workspaces });
    } catch (error) {
      next(error);
    }
  }

  static async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const workspace = await WorkspaceService.create({
        name: req.body.name,
        description: req.body.description,
        ownerId: req.user!.id,
      });
      res.status(201).json({ success: true, data: workspace });
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const workspace = await WorkspaceService.getById(req.params.workspaceId as string);
      res.json({ success: true, data: workspace });
    } catch (error) {
      next(error);
    }
  }
}
