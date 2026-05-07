import http from 'http';
import { createApp } from './app';
import { config } from './config';
import { setupWebSocket } from './websocket/socket.server';
import { prisma } from './config/database';
import { getRedisClient } from './config/redis';

async function main() {
  // Initialize database connection
  try {
    await prisma.$connect();
    console.log('Database connected');
  } catch (err) {
    console.error('Database connection failed:', err);
    process.exit(1);
  }

  // Initialize Redis (non-blocking)
  try {
    await getRedisClient();
  } catch (err) {
    console.warn('Redis unavailable, continuing without cache/pub-sub:', (err as Error).message);
  }

  const app = createApp();
  const httpServer = http.createServer(app);

  // Setup WebSocket
  const io = setupWebSocket(httpServer);
  (app as any).io = io;

  httpServer.listen(config.port, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║   Project Management Platform API                ║
║                                                  ║
║   HTTP:  http://localhost:${config.port}               ║
║   Docs:  http://localhost:${config.port}/docs          ║
║   Env:   ${config.nodeEnv.padEnd(38)}║
╚══════════════════════════════════════════════════╝
    `);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down gracefully...');
    await prisma.$disconnect();
    httpServer.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
