import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AuthenticatedRequest } from '../types';
import { prisma } from '../config/database';

export async function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, config.jwt.secret) as {
      id: string;
      email: string;
      role: string;
    };

    // Verify user still exists and is active
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ success: false, error: 'User not found or inactive' });
      return;
    }

    req.user = { id: user.id, email: user.email, role: user.role };
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ success: false, error: 'Invalid token' });
    } else if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ success: false, error: 'Token expired' });
    } else {
      res.status(500).json({ success: false, error: 'Authentication error' });
    }
  }
}

export function requireProjectAccess(minRole: 'VIEWER' | 'MEMBER' | 'ADMIN' | 'OWNER' = 'VIEWER') {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const projectId = (req.params.projectId || req.params.id) as string;

      if (!projectId) {
        res.status(400).json({ success: false, error: 'Project ID required' });
        return;
      }

      // System admins bypass project-level access checks
      if (req.user!.role === 'ADMIN') {
        next();
        return;
      }

      const member = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
      });

      if (!member) {
        res.status(403).json({ success: false, error: 'Access denied: not a project member' });
        return;
      }

      const roleHierarchy: Record<string, number> = { VIEWER: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };
      if (roleHierarchy[member.role] < roleHierarchy[minRole]) {
        res.status(403).json({ success: false, error: `Requires ${minRole} role or higher` });
        return;
      }

      next();
    } catch {
      res.status(500).json({ success: false, error: 'Authorization error' });
    }
  };
}
