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
 */
router.get('/', requireProjectAccess('VIEWER'), SprintController.list);

/**
 * @swagger
 * /projects/{projectId}/sprints:
 *   post:
 *     tags: [Sprints]
 *     summary: Create a new sprint
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
 */
router.get('/velocity', requireProjectAccess('VIEWER'), SprintController.getVelocity);

/**
 * @swagger
 * /projects/{projectId}/backlog:
 *   get:
 *     tags: [Sprints]
 *     summary: Get backlog issues (no sprint assigned)
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
 */
sprintRouter.get('/:sprintId', SprintController.getById);

/**
 * @swagger
 * /sprints/{sprintId}:
 *   patch:
 *     tags: [Sprints]
 *     summary: Update sprint
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
 */
sprintRouter.post('/:sprintId/start', SprintController.start);

/**
 * @swagger
 * /sprints/{sprintId}/complete:
 *   post:
 *     tags: [Sprints]
 *     summary: Complete a sprint (with optional carry-over)
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
