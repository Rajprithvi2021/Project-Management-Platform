import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

export interface PaginationParams {
  cursor?: string;
  limit: number;
  direction?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    hasMore: boolean;
    nextCursor?: string;
    prevCursor?: string;
    total?: number;
  };
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  meta?: Record<string, unknown>;
}

export interface WebSocketEvent {
  type: WebSocketEventType;
  projectId: string;
  payload: Record<string, unknown>;
  timestamp: string;
  eventId?: number;
  userId?: string;
}

export type WebSocketEventType =
  | 'issue_created'
  | 'issue_updated'
  | 'issue_moved'
  | 'comment_added'
  | 'sprint_updated'
  | 'presence_updated'
  | 'presence_update'
  | 'missed_events';

export interface PresenceInfo {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  location: string; // e.g., "board:proj_abc" or "issue:PROJ-123"
  connectedAt: string;
}
