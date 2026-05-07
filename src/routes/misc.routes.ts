import { Router } from 'express';
import { authenticate, requireProjectAccess } from '../middleware/auth';
import { ActivityController } from '../controllers/activity.controller';
import { SearchController } from '../controllers/search.controller';

const router = Router();

/**
 * @swagger
 * /search:
 *   get:
 *     tags: [Search]
 *     summary: Full-text and structured search for issues
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search query text
 *       - in: query
 *         name: projectId
 *         schema:
 *           type: string
 *         description: Project identifier
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Status name
 *       - in: query
 *         name: statusId
 *         schema:
 *           type: string
 *         description: Status identifier
 *       - in: query
 *         name: assignee
 *         schema:
 *           type: string
 *         description: Assignee name
 *       - in: query
 *         name: assigneeId
 *         schema:
 *           type: string
 *         description: Assignee identifier
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *           enum: [CRITICAL, HIGH, MEDIUM, LOW]
 *         description: Priority filter
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Issue type
 *       - in: query
 *         name: sprintId
 *         schema:
 *           type: string
 *         description: Sprint identifier
 *       - in: query
 *         name: labels
 *         schema:
 *           type: string
 *         description: Comma-separated labels filter
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Pagination cursor
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Page size
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [createdAt, updatedAt, priority, title]
 *         description: Sort field
 *       - in: query
 *         name: sortDir
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *         description: Sort order
 */
router.get('/search', authenticate, SearchController.search);

/**
 * @swagger
 * /search/comments:
 *   get:
 *     tags: [Search]
 *     summary: Full-text search inside issue comments
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query text
 *       - in: query
 *         name: projectId
 *         schema:
 *           type: string
 *         description: Project identifier
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Pagination cursor
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Page size
 */
router.get('/search/comments', authenticate, SearchController.searchComments);

/**
 * @swagger
 * /notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: Get notifications for current user
 *     parameters:
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Pagination cursor
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Page size
 */
router.get('/notifications', authenticate, ActivityController.getNotifications);

/**
 * @swagger
 * /notifications/unread-count:
 *   get:
 *     tags: [Notifications]
 *     summary: Get unread notification count for current user
 */
router.get('/notifications/unread-count', authenticate, ActivityController.getUnreadCount);

/**
 * @swagger
 * /notifications/read:
 *   patch:
 *     tags: [Notifications]
 *     summary: Mark notifications as read
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [notificationIds]
 *             properties:
 *               notificationIds:
 *                 type: array
 *                 items:
 *                   type: string
 */
router.patch('/notifications/read', authenticate, ActivityController.markNotificationsRead);

/**
 * @swagger
 * /projects/{projectId}/activity:
 *   get:
 *     tags: [Activity]
 *     summary: Get project activity feed (paginated)
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
 *         description: Page size
 */
router.get(
  '/projects/:projectId/activity',
  authenticate,
  requireProjectAccess('VIEWER'),
  ActivityController.getProjectFeed
);

/**
 * @swagger
 * /projects/{projectId}/workflow:
 *   get:
 *     tags: [Workflow]
 *     summary: Get project workflow (statuses and transitions)
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: string
 *         description: Project identifier
 */
router.get(
  '/projects/:projectId/workflow',
  authenticate,
  requireProjectAccess('VIEWER'),
  ActivityController.getWorkflow
);

/**
 * @swagger
 * /projects/{projectId}/workflow/statuses:
 *   post:
 *     tags: [Workflow]
 *     summary: Create a new workflow status
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
 *             required: [name, category]
 *             properties:
 *               name:
 *                 type: string
 *               category:
 *                 type: string
 *               color:
 *                 type: string
 *               position:
 *                 type: integer
 */
router.post(
  '/projects/:projectId/workflow/statuses',
  authenticate,
  requireProjectAccess('ADMIN'),
  ActivityController.createStatus
);

/**
 * @swagger
 * /projects/{projectId}/workflow/transitions:
 *   post:
 *     tags: [Workflow]
 *     summary: Create a new workflow transition
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
 *             required: [fromStatusId, toStatusId]
 *             properties:
 *               fromStatusId:
 *                 type: string
 *               toStatusId:
 *                 type: string
 *               name:
 *                 type: string
 *               conditions:
 *                 type: array
 *                 items:
 *                   type: object
 *               actions:
 *                 type: array
 *                 items:
 *                   type: object
 */
router.post(
  '/projects/:projectId/workflow/transitions',
  authenticate,
  requireProjectAccess('ADMIN'),
  ActivityController.createTransition
);

export default router;
