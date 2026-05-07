import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Project Management Platform API',
      version: '1.0.0',
      description: `
# Project Management Platform — Production-Grade Backend

A Jira-like project management API with:
- Issue tracking with parent-child hierarchy (Epic → Story → Sub-task)
- Configurable workflow engine with transition rules
- Sprint management with velocity tracking
- Real-time WebSocket updates
- Full-text search
- Threaded comments with @mentions
- Activity feed and notification system
- Optimistic locking for concurrent updates

## Authentication
Use the \`/auth/login\` endpoint to get a JWT token, then include it in subsequent requests as:
\`\`\`
Authorization: Bearer <token>
\`\`\`

## WebSocket
Connect to the WebSocket server at the same host/port and authenticate with the same JWT token.

### Events
- \`issue_created\` — New issue created in project
- \`issue_updated\` — Issue fields updated
- \`issue_moved\` — Issue moved between sprints
- \`comment_added\` — Comment added to issue
- \`sprint_updated\` — Sprint started/completed
- \`presence_updated\` — User joined/left/viewing board or issue
- \`missed_events\` — Ordered replay payload after reconnect

### Client-to-Server Messages
- \`join:project\` — Join a project room: \`{ projectId, lastEventId? }\`
- \`join:issue\` — Join an issue room: \`{ issueId, projectId }\`
- \`leave:issue\` — Leave an issue room: \`{ issueId, projectId }\`
- \`view:issue\` — Backward-compatible alias for \`join:issue\`
- \`leave:project\` — Leave project room: \`{ projectId }\`
       `,
    },
    servers: [
      { url: '/api', description: 'API Server' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: { type: 'string' },
          },
        },
        Issue: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            key: { type: 'string', example: 'PROJ-123' },
            projectId: { type: 'string' },
            type: { type: 'string', enum: ['EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK'] },
            title: { type: 'string' },
            description: { type: 'string' },
            status: { $ref: '#/components/schemas/WorkflowStatus' },
            priority: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
            assignee: { $ref: '#/components/schemas/UserRef' },
            reporter: { $ref: '#/components/schemas/UserRef' },
            sprint: { $ref: '#/components/schemas/SprintRef' },
            storyPoints: { type: 'number' },
            labels: { type: 'array', items: { type: 'string' } },
            version: { type: 'integer', description: 'Optimistic locking version' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        WorkflowStatus: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            category: { type: 'string', enum: ['TODO', 'IN_PROGRESS', 'DONE'] },
            color: { type: 'string' },
          },
        },
        UserRef: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            displayName: { type: 'string' },
            avatarUrl: { type: 'string' },
          },
        },
        SprintRef: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            status: { type: 'string' },
          },
        },
        Sprint: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            goal: { type: 'string' },
            status: { type: 'string', enum: ['PLANNING', 'ACTIVE', 'COMPLETED'] },
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' },
            velocity: { type: 'number' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Auth', description: 'Authentication endpoints' },
      { name: 'Projects', description: 'Project management' },
      { name: 'Issues', description: 'Issue tracking' },
      { name: 'Workflow', description: 'Workflow engine (statuses & transitions)' },
      { name: 'Sprints', description: 'Sprint management' },
      { name: 'Activity', description: 'Activity feed and notifications' },
      { name: 'Search', description: 'Full-text and structured search' },
      { name: 'Notifications', description: 'User notifications' },
    ],
  },
  apis: ['./src/routes/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
