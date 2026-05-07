import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { getRedisClient } from '../config/redis';
import { prisma } from '../config/database';
import { WebSocketEvent } from '../types';
import { PresenceService } from './presence.service';
import { ReplayService } from './replay.service';

interface SocketUser {
  id: string;
  email: string;
  role: string;
  displayName: string;
  avatarUrl?: string | null;
}

const presenceService = new PresenceService();
const replayService = new ReplayService();

const projectRoom = (projectId: string) => `project:${projectId}`;
const issueRoom = (issueId: string) => `issue:${issueId}`;

export function setupWebSocket(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth.token ||
        socket.handshake.headers.authorization?.replace('Bearer ', '');

      if (!token) return next(new Error('Authentication token required'));

      const decoded = jwt.verify(token, config.jwt.secret) as {
        id: string;
        email: string;
        role: string;
      };

      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, displayName: true, avatarUrl: true, isActive: true },
      });

      if (!user || !user.isActive) return next(new Error('User not found or inactive'));

      (socket as Socket & { user: SocketUser }).user = { ...decoded, ...user };
      next();
    } catch {
      next(new Error('Invalid authentication token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = (socket as Socket & { user: SocketUser }).user;
    presenceService.registerSocket(socket.id, {
      id: user.id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    });

    socket.on('join:project', async (data: { projectId: string; lastEventId?: number }) => {
      const projectId = data?.projectId;
      if (!projectId) return;

      if (!(await verifyProjectMembership(projectId, user))) {
        socket.emit('error', { message: 'Access denied: not a project member' });
        return;
      }

      socket.join(projectRoom(projectId));

      const presence = presenceService.joinProject(socket.id, projectId);
      if (presence) {
        emitPresenceUpdate(io, projectId, {
          action: 'joined',
          user: presence,
          projectId,
          onlineUsers: presenceService.getOnlineUsers(),
        });
      }

      const missedEvents = await replayService.getMissedEvents(projectId, data.lastEventId);
      if (missedEvents.length > 0) {
        socket.emit('missed_events', {
          type: 'missed_events',
          projectId,
          payload: { events: missedEvents },
          timestamp: new Date().toISOString(),
        });
      }

      socket.emit('presence:list', {
        projectId,
        users: presenceService.getProjectPresence(projectId),
        onlineUsers: presenceService.getOnlineUsers(),
      });
    });

    const handleJoinIssue = async (data: { issueId: string; projectId: string }) => {
      const projectId = data?.projectId;
      const issueId = data?.issueId;
      if (!projectId || !issueId) return;

      if (!(await verifyProjectMembership(projectId, user))) {
        socket.emit('error', { message: 'Access denied: not a project member' });
        return;
      }

      const issue = await prisma.issue.findUnique({
        where: { id: issueId },
        select: { id: true, projectId: true },
      });
      if (!issue || issue.projectId !== projectId) {
        socket.emit('error', { message: 'Issue not found in this project' });
        return;
      }

      socket.join(issueRoom(issueId));

      const presence = presenceService.viewIssue(socket.id, projectId, issueId);
      if (presence) {
        emitPresenceUpdate(io, projectId, {
          action: 'viewing_issue',
          user: presence,
          projectId,
          issueId,
          onlineUsers: presenceService.getOnlineUsers(),
        });
      }
    };

    socket.on('join:issue', handleJoinIssue);

    // Backward-compatible alias for existing clients
    socket.on('view:issue', (data: { issueId: string; projectId: string }) => {
      void handleJoinIssue(data);
    });

    socket.on('leave:issue', (data: { issueId: string; projectId: string }) => {
      const projectId = data?.projectId;
      const issueId = data?.issueId;
      if (!projectId || !issueId) return;

      socket.leave(issueRoom(issueId));
      const presence = presenceService.viewBoard(socket.id, projectId);
      if (presence) {
        emitPresenceUpdate(io, projectId, {
          action: 'viewing_board',
          user: presence,
          projectId,
          onlineUsers: presenceService.getOnlineUsers(),
        });
      }
    });

    socket.on('leave:project', (data: { projectId: string }) => {
      const projectId = data?.projectId;
      if (!projectId) return;
      socket.leave(projectRoom(projectId));
      presenceService.leaveProject(socket.id, projectId);
      emitPresenceUpdate(io, projectId, {
        action: 'left',
        userId: user.id,
        projectId,
        onlineUsers: presenceService.getOnlineUsers(),
      });
    });

    socket.on('disconnect', () => {
      const disconnected = presenceService.disconnect(socket.id);
      if (!disconnected) return;
      for (const projectId of disconnected.projectIds) {
        emitPresenceUpdate(io, projectId, {
          action: 'left',
          userId: disconnected.userId,
          projectId,
          onlineUsers: presenceService.getOnlineUsers(),
          nowOffline: disconnected.nowOffline,
        });
      }
    });
  });

  setupRedisPubSub(io);

  return io;
}

async function verifyProjectMembership(projectId: string, user: SocketUser): Promise<boolean> {
  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: user.id } },
  });
  return Boolean(member || user.role === 'ADMIN');
}

function emitPresenceUpdate(io: SocketIOServer, projectId: string, payload: Record<string, unknown>) {
  io.to(projectRoom(projectId)).emit('presence_updated', payload);
  io.to(projectRoom(projectId)).emit('presence:update', payload);
}

async function setupRedisPubSub(io: SocketIOServer) {
  try {
    const { client: publisher } = await getRedisClient();
    if (!publisher) return;

    const subscriber = publisher.duplicate();
    await subscriber.connect();

    await subscriber.pSubscribe('project:*', (message: string, channel: string) => {
      try {
        const event: WebSocketEvent = JSON.parse(message);
        const projectId = channel.replace('project:', '');

        replayService.store(projectId, event);
        io.to(projectRoom(projectId)).emit(event.type, event);

        const issueId = getIssueId(event);
        if (issueId) {
          io.to(issueRoom(issueId)).emit(event.type, event);
        }
      } catch (err) {
        console.error('Error processing Redis pub/sub message:', err);
      }
    });

    console.log('Redis pub/sub subscriber ready');
  } catch (err) {
    console.warn('Redis pub/sub not available, using direct emission:', (err as Error).message);
  }
}

function getIssueId(event: WebSocketEvent): string | null {
  if (!event.payload || typeof event.payload !== 'object') return null;

  const issueFromPayload = event.payload.issue as { id?: string } | undefined;
  if (issueFromPayload?.id) return issueFromPayload.id;
  const issueId = event.payload.issueId;
  return typeof issueId === 'string' ? issueId : null;
}

export function broadcastToProject(io: SocketIOServer, projectId: string, event: WebSocketEvent) {
  replayService.store(projectId, event);
  io.to(projectRoom(projectId)).emit(event.type, event);
}
