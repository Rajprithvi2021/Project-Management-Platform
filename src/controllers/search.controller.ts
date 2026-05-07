import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { SearchService } from '../services/search.service';

export class SearchController {
  static async search(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const {
        q,
        projectId,
        status,
        statusId,
        assignee,
        assigneeId,
        priority,
        type,
        sprintId,
        labels,
        cursor,
        limit,
        sortBy,
        sortDir,
      } = req.query;

      const result = await SearchService.search({
        q: q as string,
        projectId: projectId as string,
        status: status as string,
        statusId: statusId as string,
        assignee: assignee as string,
        assigneeId: assigneeId as string,
        priority: priority as string,
        type: type as string,
        sprintId: sprintId as string,
        labels: labels ? (labels as string).split(',') : undefined,
        cursor: cursor as string,
        limit: limit ? parseInt(limit as string) : 20,
        sortBy: sortBy as string,
        sortDir: (sortDir as 'asc' | 'desc') || 'desc',
      });

      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  static async searchComments(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { q, projectId, cursor, limit } = req.query;

      if (!q) {
        res.status(400).json({ success: false, error: 'Search query "q" is required' });
        return;
      }

      const result = await SearchService.searchComments({
        q: q as string,
        projectId: projectId as string,
        cursor: cursor as string,
        limit: limit ? parseInt(limit as string) : 20,
      });

      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }
}
