import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';

const isProd = process.env.NODE_ENV === 'production';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Project Management Platform API',
      version: '1.0.0',
      description: `
# Project Management Platform — Production-Grade Backend

A Jira-like project management API with:
- Issue tracking
- Workflow engine
- Sprint management
- Real-time updates (WebSocket)
- Search & notifications

## Authentication
Use /auth/login → get JWT → send:
Authorization: Bearer <token>
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
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Auth' },
      { name: 'Projects' },
      { name: 'Issues' },
      { name: 'Workflow' },
      { name: 'Sprints' },
    ],
  },

  // 🔥 THIS IS THE MAIN FIX
  apis: isProd
    ? [
        path.join(__dirname, '../routes/*.js'),
        path.join(__dirname, '../routes/**/*.js'),
      ]
    : [
        path.join(__dirname, '../routes/*.ts'),
        path.join(__dirname, '../routes/**/*.ts'),
      ],
};

export const swaggerSpec = swaggerJsdoc(options);