import { PresenceInfo } from '../types';

interface PresenceUser {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
}

interface SocketPresenceSession {
  socketId: string;
  user: PresenceUser;
  connectedAt: string;
  projectLocations: Map<string, string>;
}

export class PresenceService {
  private readonly sessions = new Map<string, SocketPresenceSession>();
  private readonly socketsByUser = new Map<string, Set<string>>();

  registerSocket(socketId: string, user: PresenceUser): void {
    this.sessions.set(socketId, {
      socketId,
      user,
      connectedAt: new Date().toISOString(),
      projectLocations: new Map(),
    });

    const sockets = this.socketsByUser.get(user.id) || new Set<string>();
    sockets.add(socketId);
    this.socketsByUser.set(user.id, sockets);
  }

  joinProject(socketId: string, projectId: string): PresenceInfo | null {
    return this.setLocation(socketId, projectId, `board:${projectId}`);
  }

  viewIssue(socketId: string, projectId: string, issueId: string): PresenceInfo | null {
    return this.setLocation(socketId, projectId, `issue:${issueId}`);
  }

  viewBoard(socketId: string, projectId: string): PresenceInfo | null {
    return this.setLocation(socketId, projectId, `board:${projectId}`);
  }

  leaveProject(socketId: string, projectId: string): PresenceInfo | null {
    const session = this.sessions.get(socketId);
    if (!session) return null;
    const location = session.projectLocations.get(projectId);
    session.projectLocations.delete(projectId);
    if (!location) return null;
    return this.toPresenceInfo(session, location);
  }

  getSocketProjects(socketId: string): string[] {
    const session = this.sessions.get(socketId);
    if (!session) return [];
    return [...session.projectLocations.keys()];
  }

  getProjectPresence(projectId: string): PresenceInfo[] {
    const byUser = new Map<string, PresenceInfo>();

    for (const session of this.sessions.values()) {
      const location = session.projectLocations.get(projectId);
      if (!location) continue;
      byUser.set(session.user.id, this.toPresenceInfo(session, location));
    }

    return [...byUser.values()];
  }

  getOnlineUsers(): Array<{ userId: string; displayName: string; avatarUrl?: string | null }> {
    const users = new Map<string, { userId: string; displayName: string; avatarUrl?: string | null }>();
    for (const session of this.sessions.values()) {
      users.set(session.user.id, {
        userId: session.user.id,
        displayName: session.user.displayName,
        avatarUrl: session.user.avatarUrl,
      });
    }
    return [...users.values()];
  }

  disconnect(socketId: string): { userId: string; projectIds: string[]; nowOffline: boolean } | null {
    const session = this.sessions.get(socketId);
    if (!session) return null;

    this.sessions.delete(socketId);
    const sockets = this.socketsByUser.get(session.user.id);
    if (sockets) {
      sockets.delete(socketId);
      if (sockets.size === 0) {
        this.socketsByUser.delete(session.user.id);
      }
    }

    return {
      userId: session.user.id,
      projectIds: [...session.projectLocations.keys()],
      nowOffline: !this.socketsByUser.has(session.user.id),
    };
  }

  private setLocation(socketId: string, projectId: string, location: string): PresenceInfo | null {
    const session = this.sessions.get(socketId);
    if (!session) return null;
    session.projectLocations.set(projectId, location);
    return this.toPresenceInfo(session, location);
  }

  private toPresenceInfo(session: SocketPresenceSession, location: string): PresenceInfo {
    return {
      userId: session.user.id,
      displayName: session.user.displayName,
      avatarUrl: session.user.avatarUrl || undefined,
      location,
      connectedAt: session.connectedAt,
    };
  }
}
