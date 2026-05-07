// import express from 'express';
// import cors from 'cors';
// import helmet from 'helmet';
// import morgan from 'morgan';
// import compression from 'compression';
// import rateLimit from 'express-rate-limit';
// import swaggerUi from 'swagger-ui-express';

// import { config } from './config';
// import { swaggerSpec } from './config/swagger';
// import { errorHandler, notFound } from './middleware/errorHandler';

// // Routes
// import authRoutes from './routes/auth.routes';
// import projectRoutes from './routes/project.routes';
// import { projectIssueRouter, issueRouter } from './routes/issue.routes';
// import { projectSprintRouter, sprintRouter } from './routes/sprint.routes';
// import workspaceRoutes from './routes/workspace.routes';
// import miscRoutes from './routes/misc.routes';

// export function createApp() {
//   const app = express();

//   // Security & utilities
//   app.use(helmet({ contentSecurityPolicy: false }));
//   app.use(cors({ origin: '*', credentials: true }));
//   app.use(compression());
//   app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));
//   app.use(express.json({ limit: '10mb' }));
//   app.use(express.urlencoded({ extended: true }));

//   // Rate limiting
//   const limiter = rateLimit({
//     windowMs: config.rateLimit.windowMs,
//     max: config.rateLimit.max,
//     standardHeaders: true,
//     legacyHeaders: false,
//     message: { success: false, error: 'Too many requests, please try again later.' },
//   });
//   app.use(config.apiPrefix, limiter);

//   // Health check
//   app.get('/health', (_req, res) => {
//     res.json({
//       status: 'healthy',
//       timestamp: new Date().toISOString(),
//       version: '1.0.0',
//       environment: config.nodeEnv,
//     });
//   });

//   // Swagger documentation
//   app.use(
//     '/docs',
//     swaggerUi.serve,
//     swaggerUi.setup(swaggerSpec, {
//       customSiteTitle: 'Project Management Platform API',
//       customCss: '.swagger-ui .topbar { display: none }',
//     })
//   );

//   // Raw swagger JSON
//   app.get('/docs.json', (_req, res) => {
//     res.setHeader('Content-Type', 'application/json');
//     res.send(swaggerSpec);
//   });

//   const api = config.apiPrefix;

//   // Mount routes
//   app.use(`${api}/auth`, authRoutes);
//   app.use(`${api}/projects`, projectRoutes);
//   app.use(`${api}/workspaces`, workspaceRoutes);
//   app.use(`${api}/projects/:projectId/issues`, projectIssueRouter);
//   app.use(`${api}/projects/:projectId/sprints`, projectSprintRouter);
//   app.use(`${api}/issues`, issueRouter);
//   app.use(`${api}/sprints`, sprintRouter);
//   app.use(api, miscRoutes);

//   // 404 handler
//   app.use(notFound);

//   // Error handler
//   app.use(errorHandler);

//   return app;
// }

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';

import { config } from './config';
import { swaggerSpec } from './config/swagger';
import { errorHandler, notFound } from './middleware/errorHandler';

// Routes
import authRoutes from './routes/auth.routes';
import projectRoutes from './routes/project.routes';
import { projectIssueRouter, issueRouter } from './routes/issue.routes';
import { projectSprintRouter, sprintRouter } from './routes/sprint.routes';
import workspaceRoutes from './routes/workspace.routes';
import miscRoutes from './routes/misc.routes';

export function createApp() {
  const app = express();

  // Security & utilities
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: '*', credentials: true }));
  app.use(compression());
  app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // ✅ Optional root route (for sanity check)
  app.get('/', (_req, res) => {
    res.json({
      success: true,
      message: 'Project Management API is live 🚀',
    });
  });

  // Rate limiting
  const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests, please try again later.' },
  });

  app.use(config.apiPrefix, limiter);

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: config.nodeEnv,
    });
  });

  // Swagger docs
  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customSiteTitle: 'Project Management Platform API',
      customCss: '.swagger-ui .topbar { display: none }',
    })
  );

  // Raw JSON
  app.get('/docs.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  const api = config.apiPrefix;

  // Routes
  app.use(`${api}/auth`, authRoutes);
  app.use(`${api}/projects`, projectRoutes);
  app.use(`${api}/workspaces`, workspaceRoutes);
  app.use(`${api}/projects/:projectId/issues`, projectIssueRouter);
  app.use(`${api}/projects/:projectId/sprints`, projectSprintRouter);
  app.use(`${api}/issues`, issueRouter);
  app.use(`${api}/sprints`, sprintRouter);
  app.use(api, miscRoutes);

  // 404 + error
  app.use(notFound);
  app.use(errorHandler);

  return app;
}