# Project Management Platform

A production-grade Jira-like project management backend built with Node.js, TypeScript, PostgreSQL, Redis, and WebSockets.

---

## Table of Contents
1. [Requirements Checklist](#requirements-checklist)
2. [Architecture](#architecture)
3. [Data Model](#data-model)
4. [API Documentation](#api-documentation)
5. [Setup & Running](#setup--running)
6. [WebSocket Events](#websocket-events)
7. [Design Decisions & Trade-offs](#design-decisions--trade-offs)
8. [Scenario Validation](#scenario-validation)

---

## Requirements Checklist

| Requirement | Covered | Implementation |
|---|---|---|
| Relational schema: Projects, Issues, Sprints, Users | ✅ Yes | `prisma/schema.prisma` |
| Issue types (Epic, Story, Task, Bug, Sub-task) | ✅ Yes | `IssueType` enum in schema |
| Parent-child hierarchy (Epic → Story → Sub-task) | ✅ Yes | `parentId` self-relation on Issue |
| Full audit trail / activity history | ✅ Yes | `ActivityLog` model + `ActivityService` |
| Custom fields per project (text, number, dropdown, date) | ✅ Yes | `CustomField` + `CustomFieldValue` models |
| Configurable workflow statuses per project | ✅ Yes | `WorkflowStatus` model + `WorkflowService` |
| Transition rules (allowed transitions only) | ✅ Yes | `WorkflowTransition` model, 422 on violation |
| Automation hooks (auto-assign on transition) | ✅ Yes | `AutomationRule` model + `executeActions()` |
| Validation hooks (block if conditions unmet) | ✅ Yes | `validateConditions()` in WorkflowService |
| 422 for invalid transitions with allowed list | ✅ Yes | `WorkflowService.transition()` |
| Sprint CRUD with date ranges | ✅ Yes | `SprintService` + sprint routes |
| Move issues between backlog & sprint | ✅ Yes | `IssueService.moveToSprint()` |
| Sprint start & completion | ✅ Yes | `SprintService.start()` + `complete()` |
| Sprint carry-over of incomplete issues | ✅ Yes | `SprintService.complete()` w/ carryOverIssueIds |
| Sprint velocity tracking | ✅ Yes | Velocity calculated on completion, `getVelocityReport()` |
| Threaded comments with @mentions | ✅ Yes | `Comment` model w/ parentId + mention parsing |
| Activity feed (paginated, filterable) | ✅ Yes | `ActivityService.getProjectFeed()` |
| Notification system (assignments, mentions, status) | ✅ Yes | `NotificationService` |
| Watch/unwatch issues | ✅ Yes | `IssueWatcher` model + watch endpoints |
| WebSocket: issue_created, issue_updated, etc. | ✅ Yes | `socket.server.ts` + Redis pub/sub |
| Presence tracking | ✅ Yes | `join:project`, `view:issue` events |
| Reconnection & missed event replay | ✅ Yes | `eventReplayStore` in socket server |
| Full-text search (title, description, comments) | ✅ Yes | `SearchService` with `contains` + `insensitive` |
| Structured queries (status, assignee, priority) | ✅ Yes | `SearchService.search()` with composable filters |
| Cursor-based pagination | ✅ Yes | All list APIs use cursor pagination |
| Optimistic locking (version field) | ✅ Yes | `version` field on Issue, 409 on conflict |
| REST API with proper status codes | ✅ Yes | All controllers with correct HTTP codes |
| Dockerfile | ✅ Yes | `Dockerfile` + `Dockerfile.dev` |
| docker-compose.yml | ✅ Yes | Full stack with PostgreSQL + Redis |
| Swagger API documentation | ✅ Yes | Available at `/docs` |

---

## Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                               │
│         Web App / Mobile / API Consumers / WebSocket              │
└───────────────────────┬───────────────────────────────────────────┘
                        │ HTTP + WebSocket
┌───────────────────────▼───────────────────────────────────────────┐
│                      API LAYER (Express.js)                       │
│                                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │  Auth    │  │ Projects │  │  Issues  │  │   Sprints        │  │
│  │ Routes   │  │  Routes  │  │  Routes  │  │   Routes         │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬─────────┘  │
│       │              │             │                   │           │
│  ┌────▼──────────────▼─────────────▼───────────────────▼──────┐   │
│  │          Middleware (Auth, RateLimit, Validation)           │   │
│  └──────────────────────────────────────────────────────────── ┘   │
└───────────────────────┬───────────────────────────────────────────┘
                        │
┌───────────────────────▼───────────────────────────────────────────┐
│                    SERVICE LAYER                                   │
│                                                                   │
│  IssueService  WorkflowService  SprintService  CommentService     │
│  ActivityService  NotificationService  SearchService  AuthService │
└──────────┬──────────────────┬────────────────────────────────────-┘
           │                  │
  ┌────────▼────┐    ┌────────▼────────┐
  │  PostgreSQL │    │   Redis          │
  │  (Prisma)   │    │   Cache + PubSub │
  └─────────────┘    └─────────────────┘
                              │
               ┌──────────────▼──────────┐
               │  Socket.IO WebSocket    │
               │  Server (broadcasts)    │
               └─────────────────────────┘
```

### Key Design Decisions

1. **Prisma ORM** — Type-safe database access with auto-generated migrations
2. **Redis Pub/Sub** — Enables horizontal scaling: any instance can publish events, all WebSocket instances broadcast to their connected clients
3. **Optimistic Locking** — `version` integer on Issue prevents lost updates without pessimistic row locks
4. **Cursor Pagination** — All list endpoints use `id`-based cursors for consistent, efficient pagination
5. **Graceful Redis Degradation** — Redis is optional; the system continues working without it (no caching/pub-sub)

### Scaling to 500+ Concurrent Users

- **Stateless HTTP API** — Multiple instances behind a load balancer
- **Redis Pub/Sub** — WebSocket events published to Redis, all instances subscribe and forward to their clients
- **Connection Pooling** — Prisma manages a pool of DB connections
- **Rate Limiting** — Per-IP rate limiting prevents abuse
- **Index Strategy** — All foreign keys, status, assignee, and createdAt are indexed for fast queries

---

## Data Model

### ER Diagram

```mermaid
erDiagram
    User {
        uuid id PK
        string email UK
        string password
        string displayName
        UserRole role
        boolean isActive
    }
    Project {
        uuid id PK
        string key UK
        string name
        string description
        ProjectStatus status
    }
    ProjectMember {
        uuid id PK
        uuid projectId FK
        uuid userId FK
        ProjectRole role
    }
    WorkflowStatus {
        uuid id PK
        uuid projectId FK
        string name
        StatusCategory category
        string color
        int position
    }
    WorkflowTransition {
        uuid id PK
        uuid projectId FK
        uuid fromStatusId FK
        uuid toStatusId FK
        json conditions
        json actions
    }
    Sprint {
        uuid id PK
        uuid projectId FK
        string name
        SprintStatus status
        datetime startDate
        datetime endDate
        float velocity
    }
    Issue {
        uuid id PK
        string key UK
        uuid projectId FK
        uuid sprintId FK
        uuid parentId FK
        uuid statusId FK
        IssueType type
        string title
        string description
        Priority priority
        float storyPoints
        uuid assigneeId FK
        uuid reporterId FK
        string[] labels
        int version
    }
    Comment {
        uuid id PK
        uuid issueId FK
        uuid authorId FK
        uuid parentId FK
        string content
        string[] mentions
    }
    ActivityLog {
        uuid id PK
        uuid projectId FK
        uuid issueId FK
        uuid userId FK
        ActivityAction action
        string entityType
        json changes
    }
    Notification {
        uuid id PK
        uuid userId FK
        NotificationType type
        string title
        string body
        boolean isRead
    }
    IssueWatcher {
        uuid id PK
        uuid issueId FK
        uuid userId FK
    }
    CustomField {
        uuid id PK
        uuid projectId FK
        string name
        CustomFieldType type
        json options
    }
    CustomFieldValue {
        uuid id PK
        uuid customFieldId FK
        uuid issueId FK
        json value
    }

    User ||--o{ ProjectMember : "belongs to"
    Project ||--o{ ProjectMember : "has"
    Project ||--o{ WorkflowStatus : "configures"
    Project ||--o{ WorkflowTransition : "defines"
    Project ||--o{ Sprint : "has"
    Project ||--o{ Issue : "contains"
    Sprint ||--o{ Issue : "groups"
    Issue ||--o{ Issue : "parent-child"
    Issue ||--o{ Comment : "has"
    Issue ||--o{ ActivityLog : "tracked by"
    Issue ||--o{ IssueWatcher : "watched by"
    Issue ||--o{ CustomFieldValue : "has"
    WorkflowStatus ||--o{ Issue : "applied to"
    Comment ||--o{ Comment : "threaded"
    User ||--o{ ActivityLog : "performs"
    User ||--o{ Notification : "receives"
    User ||--o{ IssueWatcher : "watches"
```

### Indexing Strategy

| Table | Indexed Columns | Reason |
|---|---|---|
| issues | projectId | All project-scoped queries |
| issues | sprintId | Board/sprint queries |
| issues | statusId | Board column grouping |
| issues | assigneeId | Assignee filtering |
| issues | parentId | Hierarchy traversal |
| issues | type, priority | Search/filter operations |
| issues | createdAt | Sort by date |
| activity_logs | projectId, issueId | Feed queries |
| activity_logs | userId, createdAt | User-specific feeds |
| notifications | userId, isRead | Unread count |
| comments | issueId | Comment listing |

---

## API Documentation

### Interactive Docs

Once running, visit: **http://localhost:3000/docs**

### Quick Reference

#### Authentication
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register` | Register a new user |
| POST | `/api/auth/login` | Login → returns JWT |
| GET | `/api/auth/profile` | Get current user |

#### Projects
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/projects` | Create project (auto-creates default workflow) |
| GET | `/api/projects` | List my projects |
| GET | `/api/projects/:projectId` | Get project details |
| PATCH | `/api/projects/:projectId` | Update project |
| POST | `/api/projects/:projectId/members` | Add member |
| DELETE | `/api/projects/:projectId/members/:userId` | Remove member |

#### Issues
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/projects/:projectId/issues` | Create issue |
| GET | `/api/projects/:projectId/board` | Get board state (active sprint) |
| GET | `/api/issues/:issueId` | Get issue by ID or key (e.g., PROJ-1) |
| PATCH | `/api/issues/:issueId` | Update issue (requires `version` for optimistic locking) |
| DELETE | `/api/issues/:issueId` | Delete issue |
| POST | `/api/issues/:issueId/transitions` | Transition status (422 if invalid) |
| GET | `/api/issues/:issueId/transitions` | Get available transitions |
| POST | `/api/issues/:issueId/move` | Move to sprint/backlog |
| POST | `/api/issues/:issueId/watch` | Watch issue |
| DELETE | `/api/issues/:issueId/watch` | Unwatch issue |

#### Comments
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/issues/:issueId/comments` | List comments (threaded) |
| POST | `/api/issues/:issueId/comments` | Add comment (supports @mentions) |
| PATCH | `/api/issues/:issueId/comments/:commentId` | Edit comment |
| DELETE | `/api/issues/:issueId/comments/:commentId` | Delete comment |

#### Sprints
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/projects/:projectId/sprints` | List sprints |
| POST | `/api/projects/:projectId/sprints` | Create sprint |
| GET | `/api/projects/:projectId/backlog` | Get backlog issues |
| GET | `/api/projects/:projectId/velocity` | Velocity report |
| GET | `/api/sprints/:sprintId` | Get sprint details |
| PATCH | `/api/sprints/:sprintId` | Update sprint |
| DELETE | `/api/sprints/:sprintId` | Delete sprint |
| POST | `/api/sprints/:sprintId/start` | Start sprint |
| POST | `/api/sprints/:sprintId/complete` | Complete sprint (with carry-over) |

#### Activity & Notifications
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/projects/:projectId/activity` | Activity feed (paginated) |
| GET | `/api/issues/:issueId/activity` | Issue activity |
| GET | `/api/notifications` | My notifications |
| GET | `/api/notifications/unread-count` | Unread count |
| PATCH | `/api/notifications/read` | Mark notifications as read |

#### Search
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/search` | Search issues (full-text + structured) |
| GET | `/api/search/comments` | Search comments |

#### Workflow
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/projects/:projectId/workflow` | Get workflow config |
| POST | `/api/projects/:projectId/workflow/statuses` | Add status |
| POST | `/api/projects/:projectId/workflow/transitions` | Add transition rule |

---

## Setup & Running

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- (Optional) PostgreSQL 15 & Redis 7 for local dev without Docker

### Option A: Docker (Recommended)

```bash
# Clone and setup
git clone <repo-url>
cd project-management-platform
cp .env.example .env

# Start all services
docker-compose up -d db redis

# Run migrations and seed data
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/project_management \
  npm run db:migrate

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/project_management \
  npm run db:seed

# Start the API
npm run dev
```

### Option B: Full Docker Stack

```bash
cp .env.example .env
# Edit .env and set JWT_SECRET

docker-compose up -d
# API available at http://localhost:3000
# Docs at http://localhost:3000/docs
```

### Development

```bash
npm install
cp .env.example .env
# Configure DATABASE_URL and REDIS_URL in .env

npx prisma migrate dev --name init
npm run db:seed

npm run dev
# API: http://localhost:3000
# Docs: http://localhost:3000/docs
```

### Test Credentials (after seeding)

| Email | Password | Role |
|---|---|---|
| alice@example.com | Password123! | Admin |
| bob@example.com | Password123! | Member |
| jane@example.com | Password123! | Member |

### WebSocket Client Example

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: { token: 'YOUR_JWT_TOKEN' }
});

let lastEventId = 0;
socket.emit('join:project', { projectId: 'your-project-id', lastEventId });
socket.emit('join:issue', { projectId: 'your-project-id', issueId: 'issue-id' });

socket.on('issue_created', (event) => console.log('New issue:', event));
socket.on('issue_updated', (event) => console.log('Issue updated:', event));
socket.on('sprint_updated', (event) => console.log('Sprint updated:', event));
socket.on('comment_added', (event) => console.log('New comment:', event));
socket.on('presence_updated', (event) => console.log('Presence:', event));
socket.on('missed_events', (event) => {
  for (const e of event.payload.events) {
    lastEventId = Math.max(lastEventId, e.eventId || 0);
  }
  console.log('Replaying missed events:', event);
});
```

See full WebSocket docs in [`docs/websocket.md`](docs/websocket.md).

## WebSocket Events

### Client events

- `join:project` `{ projectId, lastEventId? }`
- `leave:project` `{ projectId }`
- `join:issue` `{ projectId, issueId }`
- `leave:issue` `{ projectId, issueId }`
- `view:issue` (legacy alias for `join:issue`)

### Server events

- `issue_created`
- `issue_updated`
- `issue_moved`
- `comment_added`
- `sprint_updated`
- `presence_updated` (also emitted as legacy alias `presence:update`)
- `missed_events` (ordered replay for reconnecting clients)

---

## Design Decisions & Trade-offs

### What We Optimized For

1. **Correctness** — Optimistic locking prevents lost updates; workflow engine prevents invalid transitions
2. **Developer Experience** — TypeScript throughout, Swagger docs, clear error messages
3. **Flexibility** — Workflow engine is fully configurable per project; custom fields for any domain
4. **Observability** — Full audit trail for every mutation, structured activity feed

### Trade-offs

| Decision | Pro | Con |
|---|---|---|
| PostgreSQL over MongoDB | ACID, relational integrity, full-text search | Less flexible schema evolution |
| Prisma 5 over raw SQL | Type safety, migrations, DX | ORM overhead, N+1 if misused |
| Optimistic locking | No DB-level locks, scales well | Clients must handle 409 and retry |
| Socket.IO | Built-in rooms, namespace support, fallback | Larger bundle vs raw WS |
| Redis pub/sub (optional) | Multi-instance WebSocket sync | Requires Redis; graceful fallback if unavailable |

### Current Limitations

- **Full-text search** uses `ILIKE` (PostgreSQL `contains`). For production, use `tsvector` indices or Elasticsearch for sub-100ms response on millions of records
- **No rate limiting per user** — current rate limiting is per IP; add per-JWT-token limiting for API abuse prevention
- **Single PostgreSQL** — add read replicas for read-heavy workloads at scale

### Future Improvements

- [ ] Add `tsvector` full-text search indices to PostgreSQL
- [ ] Add file attachment support (S3/GCS)
- [ ] Add email notification delivery (SendGrid/SES)
- [ ] Add OAuth 2.0 login
- [ ] Add per-project permission matrix
- [ ] Add issue linking (blocks, is-blocked-by, relates-to)
- [ ] Add time tracking
- [ ] Add board swimlanes and epics roadmap view

---

## Scenario Validation

### Scenario 1: Concurrent Issue Updates

**Setup:** User A and User B both fetch issue PROJ-1 (version=3).

| Step | Actor | Action | Result |
|---|---|---|---|
| 1 | User A | `PATCH /api/issues/PROJ-1` with `{ "assigneeId": "user-b", "version": 3 }` | ✅ 200 OK, issue version becomes 4 |
| 2 | User B | `PATCH /api/issues/PROJ-1` with `{ "priority": "HIGH", "version": 3 }` | ❌ 409 Conflict: "issue was modified by another user" |
| 3 | User B | Refreshes issue, gets version=4, retries with `{ "priority": "HIGH", "version": 4 }` | ✅ 200 OK, issue version becomes 5 |
| 4 | Both | Receive `issue_updated` WebSocket events | ✅ Final state: assigneeId=user-b AND priority=HIGH |

Both changes preserved, no data loss.

### Scenario 2: Sprint Completion with Carry-Over

**Setup:** Sprint 1 has 5 issues: 2 Done (8 points), 3 Incomplete (8 points).

```http
POST /api/sprints/sprint-1/complete
{
  "carryOverIssueIds": ["issue-3", "issue-4"],
  "targetSprintId": "sprint-2"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sprint": { "status": "COMPLETED", "velocity": 8 },
    "velocity": 8,
    "completedIssues": 2,
    "incompleteIssues": [
      { "id": "issue-3", "key": "PROJ-3", "storyPoints": 3 },
      { "id": "issue-4", "key": "PROJ-4", "storyPoints": 3 },
      { "id": "issue-5", "key": "PROJ-5", "storyPoints": 2 }
    ],
    "movedToBacklog": 1,
    "carriedOver": 2
  }
}
```

- Issue-3, Issue-4 → sprint-2 ✅
- Issue-5 → backlog ✅
- Velocity = 8 points logged ✅
- Activity logs record carry-over ✅
- `sprint_updated` WebSocket event emitted ✅

### Scenario 3: Workflow Violation

**Setup:** Default workflow: To Do → In Progress → In Review → Done.

```http
POST /api/issues/PROJ-1/transitions
{ "toStatusId": "done-status-id" }
```

**Response (422):**
```json
{
  "success": false,
  "error": "Transition from \"To Do\" to \"Done\" is not allowed",
  "allowedTransitions": [
    { "statusId": "in-progress-id", "statusName": "In Progress" }
  ]
}
```

✅ Invalid transition blocked with 422  
✅ Allowed transitions listed in response  
✅ Valid path: To Do → In Progress → In Review → Done  
