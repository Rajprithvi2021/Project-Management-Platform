import { redisReplayEvents } from '../config/redis';
import { WebSocketEvent } from '../types';

const MAX_FALLBACK_EVENTS = 100;

export class ReplayService {
  private readonly fallbackStore = new Map<string, WebSocketEvent[]>();

  store(projectId: string, event: WebSocketEvent): void {
    const events = this.fallbackStore.get(projectId) || [];
    events.push(event);
    if (events.length > MAX_FALLBACK_EVENTS) {
      events.splice(0, events.length - MAX_FALLBACK_EVENTS);
    }
    this.fallbackStore.set(projectId, events);
  }

  async getMissedEvents(projectId: string, lastEventId?: number): Promise<WebSocketEvent[]> {
    if (typeof lastEventId === 'number' && Number.isFinite(lastEventId)) {
      const replayFromRedis = await redisReplayEvents(projectId, lastEventId);
      if (replayFromRedis.length > 0) return replayFromRedis;
    }

    if (lastEventId === undefined) return [];

    const fallback = this.fallbackStore.get(projectId) || [];
    const filtered = fallback.filter((event) => {
      if (typeof event.eventId === 'number') return event.eventId > lastEventId;
      return true;
    });

    return filtered.sort((a, b) => {
      const aScore = a.eventId ?? Number.MAX_SAFE_INTEGER;
      const bScore = b.eventId ?? Number.MAX_SAFE_INTEGER;
      if (aScore === bScore) return a.timestamp.localeCompare(b.timestamp);
      return aScore - bScore;
    });
  }
}
