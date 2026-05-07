import { Router } from 'express';
import { body } from 'express-validator';
import { SprintController } from '../controllers/sprint.controller';
import { authenticate, requireProjectAccess } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';

const router = Router({ mergeParams: true });

// All sprint routes require authentication
router.use(authenticate);

/**
 * @swagger
 * /projects/{projectId}/sprints:
 *   get:
 *     tags: [Sprints]
 *     summary: List sprints for a project
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: string
 *         description: Project identifier
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Optional sprint status filter
 */
router.get('/', requireProjectAccess('VIEWER'), SprintController.list);

/**
 * @swagger
 * /projects/{projectId}/sprints:
 *   post:
 *     tags: [Sprints]
 *     summary: Create a new sprint
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: string
 *         description: Project identifier
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *               goal:
 *                 type: string
 *               startDate:
 *                 type: string
 *                 format: date
 *               endDate:
 *                 type: string
 *                 format: date
 */
router.post(
  '/',
  requireProjectAccess('MEMBER'),
  [
    body('name').trim().notEmpty().withMessage('Sprint name is required'),
    body('startDate').optional().isISO8601(),
    body('endDate').optional().isISO8601(),
    validateRequest,
  ],
  SprintController.create
);

/**
 * @swagger
 * /projects/{projectId}/velocity:
 *   get:
 *     tags: [Sprints]
 *     summary: Get velocity report for a project
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: string
 *         description: Project identifier
 */
router.get('/velocity', requireProjectAccess('VIEWER'), SprintController.getVelocity);

/**
 * @swagger
 * /projects/{projectId}/backlog:
 *   get:
 *     tags: [Sprints]
 *     summary: Get backlog issues (no sprint assigned)
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: string
 *         description: Project identifier
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Cursor for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Page size
 */
router.get('/backlog', requireProjectAccess('VIEWER'), SprintController.getBacklog);

// Sprint-level routes (standalone /sprints/:sprintId)
const sprintRouter = Router();

sprintRouter.use(authenticate);

/**
 * @swagger
 * /sprints/{sprintId}:
 *   get:
 *     tags: [Sprints]
 *     summary: Get sprint by ID
 *     parameters:
 *       - in: path
 *         name: sprintId
 *         required: true
 *         schema:
 *           type: string
 *         description: Sprint identifier
 */
sprintRouter.get('/:sprintId', SprintController.getById);

/**
 * @swagger
 * /sprints/{sprintId}:
 *   patch:
 *     tags: [Sprints]
 *     summary: Update sprint
 *     parameters:
 *       - in: path
 *         name: sprintId
 *         required: true
 *         schema:
 *           type: string
 *         description: Sprint identifier
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               goal:
 *                 type: string
 *               startDate:
 *                 type: string
 *                 format: date
 *               endDate:
 *                 type: string
 *                 format: date
 */
sprintRouter.patch(
  '/:sprintId',
  [
    body('name').optional().trim().notEmpty(),
    body('startDate').optional().isISO8601(),
    body('endDate').optional().isISO8601(),
    validateRequest,
  ],
  SprintController.update
);

sprintRouter.delete('/:sprintId', SprintController.delete);

/**
 * @swagger
 * /sprints/{sprintId}/start:
 *   post:
 *     tags: [Sprints]
 *     summary: Start a sprint
 *     parameters:
 *       - in: path
 *         name: sprintId
 *         required: true
 *         schema:
 *           type: string
 *         description: Sprint identifier
 */
sprintRouter.post('/:sprintId/start', SprintController.start);

/**
 * @swagger
 * /sprints/{sprintId}/complete:
 *   post:
 *     tags: [Sprints]
 *     summary: Complete a sprint (with optional carry-over)
 *     parameters:
 *       - in: path
 *         name: sprintId
 *         required: true
 *         schema:
 *           type: string
 *         description: Sprint identifier
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               carryOverIssueIds:
 *                 type: array
 *                 items:
 *                   type: string
 *               targetSprintId:
 *                 type: string
 */
sprintRouter.post(
  '/:sprintId/complete',
  [
    body('carryOverIssueIds').optional().isArray(),
    body('targetSprintId').optional().isString(),
    validateRequest,
  ],
  SprintController.complete
);

export { router as projectSprintRouter, sprintRouter };
