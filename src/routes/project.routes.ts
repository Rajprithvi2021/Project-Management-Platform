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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - key
 *               - name
 *             properties:
 *               key:
 *                 type: string
 *                 example: "TEST"
 *                 description: "Project key (2-10 uppercase alphanumeric characters)"
 *               name:
 *                 type: string
 *                 example: "Test Project"
 *                 description: "Project name"
 *               description:
 *                 type: string
 *                 example: "My first project"
 *                 description: "Optional project description"
 *               workspaceId:
 *                 type: string
 *                 description: "Optional workspace ID (creates new workspace if not provided)"
 *               workspaceName:
 *                 type: string
 *                 description: "Optional workspace name (used if workspaceId not provided)"
 *     responses:
 *       201:
 *         description: Project created successfully
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

/**
 * @swagger
 * /projects:
 *   get:
 *     tags: [Projects]
 *     summary: Get all projects for current user
 *     responses:
 *       200:
 *         description: List of projects retrieved successfully
 */
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
