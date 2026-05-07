# WebSocket API (Socket.IO)

The API server exposes Socket.IO on the same host/port as HTTP.

## Authentication

Connections must include a valid JWT:

```ts
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: { token: '<JWT_TOKEN>' },
});
```

## Client → Server events

- `join:project` `{ projectId: string, lastEventId?: number }`
  - Subscribes the client to the project room.
  - If `lastEventId` is sent, server replays missed events in order.
- `leave:project` `{ projectId: string }`
- `join:issue` `{ projectId: string, issueId: string }`
- `leave:issue` `{ projectId: string, issueId: string }`
- `view:issue` `{ projectId: string, issueId: string }` (legacy alias for `join:issue`)

## Server → Client events

- `issue_created`
- `issue_updated`
- `issue_moved`
- `comment_added`
- `sprint_updated`
- `presence_updated` (canonical)
- `presence:update` (legacy alias)
- `missed_events`

### Replay payload example

```json
{
  "type": "missed_events",
  "projectId": "project-1",
  "timestamp": "2026-05-07T00:00:00.000Z",
  "payload": {
    "events": [
      {
        "eventId": 1041,
        "type": "issue_updated",
        "projectId": "project-1",
        "timestamp": "2026-05-07T00:00:00.000Z",
        "payload": { "issueId": "issue-1" }
      }
    ]
  }
}
```

## Presence model

- Online users are tracked per active socket.
- Presence is tracked by project and location:
  - `board:<projectId>`
  - `issue:<issueId>`
- `presence_updated` is emitted when users join/leave projects and when they switch board/issue context.

## Ordering and replay

- Every project event published through Redis gets an incremental `eventId`.
- Events are stored in a Redis sorted set per project and published via Redis pub/sub.
- On reconnect, clients pass `lastEventId` to receive ordered replay of missed events.
