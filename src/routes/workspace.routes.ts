import { Router } from 'express';
import { body, param } from 'express-validator';
import { WorkspaceController } from '../controllers/workspace.controller';
import { authenticate } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';

const router = Router();

router.use(authenticate);

router.get('/', WorkspaceController.list);

router.post(
  '/',
  [
    body('name').trim().notEmpty().withMessage('Workspace name is required'),
    body('description').optional().trim(),
    validateRequest,
  ],
  WorkspaceController.create
);

router.get('/:workspaceId', [param('workspaceId').isUUID().withMessage('workspaceId must be a UUID'), validateRequest], WorkspaceController.getById);

export default router;
