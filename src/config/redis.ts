import { createClient } from 'redis';
import { config } from './index';
import { WebSocketEvent } from '../types';

let redisClient: ReturnType<typeof createClient> | null = null;
let isRedisAvailable = false;
const MAX_REPLAY_EVENTS = 500;

export async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({ url: config.redis.url });

    redisClient.on('error', (err) => {
      console.warn('Redis client error (continuing without cache):', err.message);
      isRedisAvailable = false;
    });

    redisClient.on('connect', () => {
      console.log('Redis connected');
      isRedisAvailable = true;
    });

    redisClient.on('reconnecting', () => {
      console.log('Redis reconnecting...');
    });

    try {
      await redisClient.connect();
      isRedisAvailable = true;
    } catch (err) {
      console.warn('Redis connection failed (continuing without cache):', (err as Error).message);
      isRedisAvailable = false;
    }
  }
  return { client: redisClient, isAvailable: isRedisAvailable };
}

export async function redisGet(key: string): Promise<string | null> {
  try {
    const { client, isAvailable } = await getRedisClient();
    if (!isAvailable) return null;
    return await client.get(key);
  } catch {
    return null;
  }
}

export async function redisSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  try {
    const { client, isAvailable } = await getRedisClient();
    if (!isAvailable) return;
    if (ttlSeconds) {
      await client.setEx(key, ttlSeconds, value);
    } else {
      await client.set(key, value);
    }
  } catch {
    // Ignore cache errors
  }
}

export async function redisDel(key: string): Promise<void> {
  try {
    const { client, isAvailable } = await getRedisClient();
    if (!isAvailable) return;
    await client.del(key);
  } catch {
    // Ignore cache errors
  }
}

export async function redisPublish(channel: string, message: string): Promise<void> {
  try {
    const { client, isAvailable } = await getRedisClient();
    if (!isAvailable) return;

    const projectChannel = channel.match(/^project:(.+)$/);
    if (projectChannel) {
      const projectId = projectChannel[1];
      try {
        const parsed = JSON.parse(message) as WebSocketEvent;
        const replaySeqKey = `project:${projectId}:events:seq`;
        const replayEventsKey = `project:${projectId}:events`;
        const eventId = await client.incr(replaySeqKey);
        const event: WebSocketEvent = {
          ...parsed,
          projectId,
          eventId,
          timestamp: parsed.timestamp || new Date().toISOString(),
        };
        const encoded = JSON.stringify(event);
        await client.zAdd(replayEventsKey, {
          score: eventId,
          value: encoded,
        });
        // Trim oldest entries beyond MAX_REPLAY_EVENTS: remove ranks 0..-(MAX_REPLAY_EVENTS+1).
        await client.zRemRangeByRank(replayEventsKey, 0, -MAX_REPLAY_EVENTS - 1);
        await client.publish(channel, encoded);
        return;
      } catch {
        // If message is not JSON, publish raw payload
      }
    }

    await client.publish(channel, message);
  } catch {
    // Ignore pub/sub errors
  }
}

export async function redisReplayEvents(projectId: string, afterEventId: number): Promise<WebSocketEvent[]> {
  try {
    const { client, isAvailable } = await getRedisClient();
    if (!isAvailable) return [];

    const replayEventsKey = `project:${projectId}:events`;
    const values = await client.zRangeByScore(replayEventsKey, `(${afterEventId}`, '+inf');
    return values
      .map((value) => {
        try {
          return JSON.parse(value) as WebSocketEvent;
        } catch {
          return null;
        }
      })
      .filter((event): event is WebSocketEvent => event !== null);
  } catch {
    return [];
  }
}
