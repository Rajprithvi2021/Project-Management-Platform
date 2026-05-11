import { Router } from 'express';
import { body, param } from 'express-validator';
import { IssueController } from '../controllers/issue.controller';
import { authenticate, requireProjectAccess } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';

const router = Router({ mergeParams: true });

// All issue routes require authentication
router.use(authenticate);

/**
 * @swagger
 * /projects/{projectId}/issues:
 *   post:
 *     tags: [Issues]
 *     summary: Create a new issue
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
 *             required: [type, title]
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [EPIC, STORY, TASK, BUG, SUBTASK]
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               priority:
 *                 type: string
 *                 enum: [CRITICAL, HIGH, MEDIUM, LOW]
 *               assigneeId:
 *                 type: string
 *               parentId:
 *                 type: string
 *               sprintId:
 *                 type: string
 *               storyPoints:
 *                 type: integer
 *               labels:
 *                 type: array
 *                 items:
 *                   type: string
 *               dueDate:
 *                 type: string
 *                 format: date-time
  *     responses:
  *       201:
  *         description: Issue created successfully
  *       400:
  *         description: Validation error
  *       401:
  *         description: Unauthorized
  *       404:
  *         description: Project not found
  *       422:
  *         description: Unprocessable Entity
 */
router.post(
  '/',
  requireProjectAccess('MEMBER'),
  [
    body('type').isIn(['EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK']),
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('priority').optional().isIn(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
    body('workspaceId').optional().isUUID().withMessage('workspaceId must be a valid UUID'),
    validateRequest,
  ],
  IssueController.create
);

router.patch(
  '/bulk',
  requireProjectAccess('MEMBER'),
  [
    body('issueIds').isArray({ min: 1 }).withMessage('issueIds is required'),
    body('issueIds.*').isString().notEmpty(),
    body('statusId').optional().isString(),
    body('assigneeId').optional().isString(),
    body('priority').optional().isIn(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
    validateRequest,
  ],
  IssueController.bulkUpdate
);

/**
 * @swagger
 * /projects/{projectId}/board:
 *   get:
 *     tags: [Issues]
 *     summary: Get board state (active sprint issues grouped by status)
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: string
 *         description: Project identifier
  *     responses:
  *       200:
  *         description: Board state fetched successfully
  *       401:
  *         description: Unauthorized
  *       404:
  *         description: Project not found
 */
router.get('/board', requireProjectAccess('VIEWER'), IssueController.getBoardState);

/**
 * @swagger
 * /projects/{projectId}/activity:
 *   get:
 *     tags: [Activity]
 *     summary: Get project activity feed
 */

// Issue-level routes (by ID)
const issueRouter = Router({ mergeParams: true });

issueRouter.use(authenticate);

/**
 * @swagger
 * /issues/{issueId}:
 *   get:
 *     tags: [Issues]
 *     summary: Get issue by ID or key
 *     parameters:
 *       - in: path
 *         name: issueId
 *         required: true
 *         schema:
 *           type: string
 *         description: Issue ID or key
  *     responses:
  *       200:
  *         description: Issue fetched successfully
  *       401:
  *         description: Unauthorized
  *       404:
  *         description: Issue not found
 */
issueRouter.get('/:issueId', IssueController.getById);

/**
 * @swagger
 * /issues/{issueId}:
 *   patch:
 *     tags: [Issues]
 *     summary: Update issue fields (with optimistic locking)
 *     parameters:
 *       - in: path
 *         name: issueId
 *         required: true
 *         schema:
 *           type: string
 *         description: Issue ID or key
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [version]
 *             properties:
 *               version:
 *                 type: integer
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               priority:
 *                 type: string
 *                 enum: [CRITICAL, HIGH, MEDIUM, LOW]
 *               assigneeId:
 *                 type: string
 *               storyPoints:
 *                 type: integer
 *               labels:
 *                 type: array
 *                 items:
 *                   type: string
 *               dueDate:
 *                 type: string
 *                 format: date-time
  *     responses:
  *       200:
  *         description: Issue updated successfully
  *       400:
  *         description: Validation error
  *       401:
  *         description: Unauthorized
  *       404:
  *         description: Issue not found
  *       409:
  *         description: Version conflict
 */
issueRouter.patch(
  '/:issueId',
  [
    body('version').isInt({ min: 1 }).withMessage('Version is required for optimistic locking'),
    body('title').optional().trim().notEmpty(),
    body('priority').optional().isIn(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
    validateRequest,
  ],
  IssueController.update
);

/**
 * @swagger
 * /issues/{issueId}:
 *   delete:
 *     tags: [Issues]
 *     summary: Delete an issue
 *     parameters:
 *       - in: path
 *         name: issueId
 *         required: true
 *         schema:
 *           type: string
 *         description: Issue ID or key
  *     responses:
  *       204:
  *         description: Issue deleted successfully
  *       401:
  *         description: Unauthorized
  *       404:
  *         description: Issue not found
 */
issueRouter.delete('/:issueId', IssueController.delete);

/**
 * @swagger
 * /issues/{issueId}/transitions:
 *   post:
 *     tags: [Workflow]
 *     summary: Transition issue to a new status
 *     description: Returns 422 if transition is not allowed, with list of allowed transitions
 *     parameters:
 *       - in: path
 *         name: issueId
 *         required: true
 *         schema:
 *           type: string
 *         description: Issue ID or key
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [toStatusId]
 *             properties:
 *               toStatusId:
 *                 type: string
 *               comment:
 *                 type: string
 */
issueRouter.post(
  '/:issueId/transitions',
  [
    body('toStatusId').notEmpty().withMessage('toStatusId is required'),
    validateRequest,
  ],
  IssueController.transition
);

issueRouter.get('/:issueId/transitions', IssueController.getAvailableTransitions);

issueRouter.get('/:issueId/relationships', IssueController.getRelationships);

issueRouter.post(
  '/:issueId/relationships',
  [
    body('relatedIssueId').notEmpty().withMessage('relatedIssueId is required'),
    body('type').isIn(['RELATES_TO', 'BLOCKS', 'BLOCKED_BY', 'DUPLICATES', 'DUPLICATED_BY']),
    validateRequest,
  ],
  IssueController.linkRelationship
);

issueRouter.post(
  '/:issueId/move',
  [
    body('sprintId').optional().isString(),
    validateRequest,
  ],
  IssueController.moveToSprint
);

issueRouter.post('/:issueId/watch', IssueController.watch);
issueRouter.delete('/:issueId/watch', IssueController.unwatch);

// Comments
issueRouter.get('/:issueId/comments', IssueController.getComments);

issueRouter.post(
  '/:issueId/comments',
  [
    body('content').trim().notEmpty().withMessage('Comment content is required'),
    validateRequest,
  ],
  IssueController.addComment
);

issueRouter.patch(
  '/:issueId/comments/:commentId',
  [
    body('content').trim().notEmpty(),
    validateRequest,
  ],
  IssueController.updateComment
);

issueRouter.delete('/:issueId/comments/:commentId', IssueController.deleteComment);

// Activity
issueRouter.get('/:issueId/activity', IssueController.getActivity);

// Custom field values
issueRouter.put(
  '/:issueId/custom-fields/:fieldId',
  [
    body('value').exists().withMessage('Value is required'),
    validateRequest,
  ],
  IssueController.setCustomFieldValue
);

export { router as projectIssueRouter, issueRouter };
