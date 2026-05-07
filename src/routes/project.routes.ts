import { Router } from 'express';
import { body } from 'express-validator';
import { ProjectController } from '../controllers/project.controller';
import { authenticate, requireProjectAccess } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';

const router = Router();

// All project routes require authentication
router.use(authenticate);

/**
 * @swagger
 * /projects:
 *   post:
 *     tags: [Projects]
 *     summary: Create a new project
 */
router.post(
  '/',
  [
    body('key').trim().notEmpty().withMessage('Project key is required'),
    body('name').trim().notEmpty().withMessage('Project name is required'),
    validateRequest,
  ],
  ProjectController.create
);

router.get('/', ProjectController.getMyProjects);

router.get('/:projectId', requireProjectAccess('VIEWER'), ProjectController.getById);

router.patch(
  '/:projectId',
  requireProjectAccess('ADMIN'),
  [
    body('name').optional().trim().notEmpty(),
    validateRequest,
  ],
  ProjectController.update
);

router.post(
  '/:projectId/members',
  requireProjectAccess('ADMIN'),
  [
    body('userId').notEmpty().withMessage('User ID is required'),
    validateRequest,
  ],
  ProjectController.addMember
);

router.delete(
  '/:projectId/members/:userId',
  requireProjectAccess('ADMIN'),
  ProjectController.removeMember
);

router.get('/:projectId/custom-fields', requireProjectAccess('VIEWER'), ProjectController.getCustomFields);

router.post(
  '/:projectId/custom-fields',
  requireProjectAccess('ADMIN'),
  [
    body('name').trim().notEmpty(),
    body('type').isIn(['TEXT', 'NUMBER', 'DROPDOWN', 'DATE']),
    validateRequest,
  ],
  ProjectController.createCustomField
);

export default router;
