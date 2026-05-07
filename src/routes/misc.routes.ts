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
 */
router.get('/search', authenticate, SearchController.search);
router.get('/search/comments', authenticate, SearchController.searchComments);

/**
 * @swagger
 * /notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: Get notifications for current user
 */
router.get('/notifications', authenticate, ActivityController.getNotifications);
router.get('/notifications/unread-count', authenticate, ActivityController.getUnreadCount);
router.patch('/notifications/read', authenticate, ActivityController.markNotificationsRead);

/**
 * @swagger
 * /projects/{projectId}/activity:
 *   get:
 *     tags: [Activity]
 *     summary: Get project activity feed (paginated)
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
 */
router.get(
  '/projects/:projectId/workflow',
  authenticate,
  requireProjectAccess('VIEWER'),
  ActivityController.getWorkflow
);

router.post(
  '/projects/:projectId/workflow/statuses',
  authenticate,
  requireProjectAccess('ADMIN'),
  ActivityController.createStatus
);

router.post(
  '/projects/:projectId/workflow/transitions',
  authenticate,
  requireProjectAccess('ADMIN'),
  ActivityController.createTransition
);

export default router;
