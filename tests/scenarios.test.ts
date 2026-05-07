/**
 * Integration tests for the Project Management Platform
 *
 * Tests the three mandatory scenarios from the requirements:
 * 1. Concurrent issue updates with optimistic locking
 * 2. Sprint completion with carry-over
 * 3. Workflow violation (invalid transition returns 422)
 */

import { WorkflowService } from '../src/services/workflow.service';
import { IssueService } from '../src/services/issue.service';
import { SprintService } from '../src/services/sprint.service';
import { ActivityService } from '../src/services/activity.service';
import { SearchService } from '../src/services/search.service';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

jest.mock('../src/config/database', () => ({
  prisma: {
    issue: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
    project: { findUnique: jest.fn() },
    sprint: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    workflowStatus: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    workflowTransition: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
    },
    activityLog: { create: jest.fn(), findMany: jest.fn() },
    notification: { create: jest.fn(), createMany: jest.fn() },
    issueWatcher: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    automationRule: { findMany: jest.fn() },
    customFieldValue: { findFirst: jest.fn() },
  },
}));

jest.mock('../src/config/redis', () => ({
  redisPublish: jest.fn().mockResolvedValue(undefined),
  redisGet: jest.fn().mockResolvedValue(null),
  redisSet: jest.fn().mockResolvedValue(undefined),
  redisDel: jest.fn().mockResolvedValue(undefined),
}));

import { prisma } from '../src/config/database';
import { redisPublish } from '../src/config/redis';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockRedisPublish = redisPublish as jest.MockedFunction<typeof redisPublish>;

// Helper: find calls to redisPublish that match a given event type
function findRedisEvents(type: string) {
  return mockRedisPublish.mock.calls
    .map(([, msg]) => { try { return JSON.parse(msg as string); } catch { return null; } })
    .filter((e) => e && e.type === type);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: Concurrent Issue Updates (Optimistic Locking)
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 1: Concurrent Issue Updates', () => {
  const baseIssue = {
    id: 'issue-1',
    key: 'PROJ-1',
    version: 3,
    title: 'Original Title',
    description: 'Original description',
    priority: 'MEDIUM',
    assigneeId: 'user-a',
    storyPoints: 5,
    labels: [],
    dueDate: null,
    projectId: 'project-1',
    statusId: 'status-1',
    status: { name: 'In Progress', category: 'IN_PROGRESS' },
    project: { id: 'project-1', key: 'PROJ', name: 'Test Project' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (mockPrisma.activityLog.create as jest.Mock).mockResolvedValue({});
    (mockPrisma.notification.createMany as jest.Mock).mockResolvedValue({});
    (mockPrisma.issueWatcher.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.automationRule.findMany as jest.Mock).mockResolvedValue([]);
    mockRedisPublish.mockResolvedValue(undefined);
  });

  it('User A successfully updates assignee with correct version', async () => {
    (mockPrisma.issue.findUnique as jest.Mock).mockResolvedValue({ ...baseIssue, version: 3 });
    (mockPrisma.issue.update as jest.Mock).mockResolvedValue({
      ...baseIssue,
      assigneeId: 'user-b',
      version: 4,
    });

    const result = await IssueService.update({
      issueId: 'issue-1',
      userId: 'user-a',
      version: 3,
      data: { assigneeId: 'user-b' },
    });

    expect(result.version).toBe(4);
    expect(mockPrisma.issue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: { increment: 1 } }),
      })
    );
  });

  it('User B update is rejected with 409 Conflict when version is stale', async () => {
    // Issue was already updated by User A (version is now 4)
    (mockPrisma.issue.findUnique as jest.Mock).mockResolvedValue({ ...baseIssue, version: 4 });

    // User B tries to update with stale version (3)
    await expect(
      IssueService.update({
        issueId: 'issue-1',
        userId: 'user-b',
        version: 3,
        data: { priority: 'HIGH' },
      })
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('Conflict') });

    expect(mockPrisma.issue.update).not.toHaveBeenCalled();
  });

  it('Both updates succeed when applied sequentially with correct versions', async () => {
    // User A: changes assignee (v3 → v4)
    (mockPrisma.issue.findUnique as jest.Mock).mockResolvedValueOnce({ ...baseIssue, version: 3 });
    (mockPrisma.issue.update as jest.Mock).mockResolvedValueOnce({
      ...baseIssue, assigneeId: 'user-b', version: 4,
    });

    const firstResult = await IssueService.update({
      issueId: 'issue-1', userId: 'user-a', version: 3,
      data: { assigneeId: 'user-b' },
    });
    expect(firstResult.version).toBe(4);

    // User B: changes priority with fresh version (v4 → v5)
    (mockPrisma.issue.findUnique as jest.Mock).mockResolvedValueOnce({
      ...baseIssue, assigneeId: 'user-b', version: 4,
    });
    (mockPrisma.issue.update as jest.Mock).mockResolvedValueOnce({
      ...baseIssue, assigneeId: 'user-b', priority: 'HIGH', version: 5,
    });

    const secondResult = await IssueService.update({
      issueId: 'issue-1', userId: 'user-b', version: 4,
      data: { priority: 'HIGH' },
    });
    expect(secondResult.version).toBe(5);

    // Both updates emitted issue_updated WebSocket events
    const issueUpdateEvents = findRedisEvents('issue_updated');
    expect(issueUpdateEvents.length).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: Sprint Completion with Carry-Over
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 2: Sprint Completion with Carry-Over', () => {
  const doneStatus = { category: 'DONE', name: 'Done' };
  const inProgressStatus = { category: 'IN_PROGRESS', name: 'In Progress' };
  const todoStatus = { category: 'TODO', name: 'To Do' };

  const sprint = {
    id: 'sprint-1',
    projectId: 'project-1',
    name: 'Sprint 1',
    status: 'ACTIVE',
    issues: [
      { id: 'issue-done-1', key: 'PROJ-1', title: 'Story 1', storyPoints: 5, status: doneStatus },
      { id: 'issue-done-2', key: 'PROJ-2', title: 'Story 2', storyPoints: 3, status: doneStatus },
      { id: 'issue-inc-1', key: 'PROJ-3', title: 'Story 3', storyPoints: 3, status: todoStatus },
      { id: 'issue-inc-2', key: 'PROJ-4', title: 'Story 4', storyPoints: 3, status: inProgressStatus },
      { id: 'issue-inc-3', key: 'PROJ-5', title: 'Story 5', storyPoints: 2, status: todoStatus },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (mockPrisma.issue.updateMany as jest.Mock).mockResolvedValue({ count: 2 });
    (mockPrisma.activityLog.create as jest.Mock).mockResolvedValue({});
    mockRedisPublish.mockResolvedValue(undefined);
  });

  it('completes sprint and calculates velocity from completed issues', async () => {
    (mockPrisma.sprint.findUnique as jest.Mock).mockResolvedValue(sprint);
    (mockPrisma.sprint.update as jest.Mock).mockResolvedValue({
      ...sprint, status: 'COMPLETED', completedAt: new Date(), velocity: 8,
    });

    const result = await SprintService.complete({
      sprintId: 'sprint-1', userId: 'user-1', carryOverIssueIds: [],
    });

    expect(result.velocity).toBe(8); // 5 + 3 story points
    expect(result.completedIssues).toBe(2);
    expect(result.incompleteIssues).toHaveLength(3);
    expect(mockPrisma.sprint.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ velocity: 8, status: 'COMPLETED' }),
      })
    );
  });

  it('carries over selected incomplete issues to next sprint', async () => {
    (mockPrisma.sprint.findUnique as jest.Mock).mockResolvedValue(sprint);
    (mockPrisma.sprint.update as jest.Mock).mockResolvedValue({ ...sprint, status: 'COMPLETED', velocity: 8 });

    const result = await SprintService.complete({
      sprintId: 'sprint-1', userId: 'user-1',
      carryOverIssueIds: ['issue-inc-1', 'issue-inc-2'],
      targetSprintId: 'sprint-2',
    });

    expect(mockPrisma.issue.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['issue-inc-1', 'issue-inc-2'] } },
        data: { sprintId: 'sprint-2', version: { increment: 1 } },
      })
    );
    expect(result.carriedOver).toBe(2);
    expect(result.movedToBacklog).toBe(1); // issue-inc-3 goes to backlog
  });

  it('moves non-carried-over incomplete issues to backlog', async () => {
    (mockPrisma.sprint.findUnique as jest.Mock).mockResolvedValue(sprint);
    (mockPrisma.sprint.update as jest.Mock).mockResolvedValue({ ...sprint, status: 'COMPLETED', velocity: 8 });

    await SprintService.complete({
      sprintId: 'sprint-1', userId: 'user-1',
      carryOverIssueIds: ['issue-inc-1'], // Only carry over one
    });

    expect(mockPrisma.issue.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['issue-inc-2', 'issue-inc-3'] } },
        data: { sprintId: null },
      })
    );
  });

  it('emits sprint_updated WebSocket event on completion', async () => {
    (mockPrisma.sprint.findUnique as jest.Mock).mockResolvedValue(sprint);
    (mockPrisma.sprint.update as jest.Mock).mockResolvedValue({
      ...sprint, status: 'COMPLETED', velocity: 8,
    });

    await SprintService.complete({
      sprintId: 'sprint-1', userId: 'user-1', carryOverIssueIds: [],
    });

    const sprintEvents = findRedisEvents('sprint_updated');
    expect(sprintEvents.length).toBeGreaterThanOrEqual(1);
    const completionEvent = sprintEvents.find((e) => e.payload.action === 'completed');
    expect(completionEvent).toBeDefined();
    expect(completionEvent!.payload.velocity).toBe(8);
  });

  it('rejects completion of a non-active sprint', async () => {
    (mockPrisma.sprint.findUnique as jest.Mock).mockResolvedValue({ ...sprint, status: 'PLANNING' });

    await expect(
      SprintService.complete({ sprintId: 'sprint-1', userId: 'user-1' })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3: Workflow Violation
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 3: Workflow Violation', () => {
  const PROJECT_ID = 'project-1';
  const todoStatus = { id: 'todo-id', name: 'To Do', category: 'TODO', projectId: PROJECT_ID };
  const inProgressStatus = { id: 'in-progress-id', name: 'In Progress', category: 'IN_PROGRESS', projectId: PROJECT_ID };
  const inReviewStatus = { id: 'in-review-id', name: 'In Review', category: 'IN_PROGRESS', projectId: PROJECT_ID };
  const doneStatus = { id: 'done-id', name: 'Done', category: 'DONE', projectId: PROJECT_ID };

  const baseIssue = {
    id: 'issue-1',
    key: 'PROJ-1',
    title: 'Test Issue',
    projectId: PROJECT_ID,
    statusId: todoStatus.id,
    status: todoStatus,
    version: 1,
    assigneeId: null,
    project: { id: PROJECT_ID },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisPublish.mockResolvedValue(undefined);
  });

  it('blocks direct To Do → Done transition and returns 422 with allowed transitions', async () => {
    (mockPrisma.issue.findUnique as jest.Mock).mockResolvedValue(baseIssue);
    (mockPrisma.workflowStatus.findUnique as jest.Mock).mockResolvedValue(doneStatus);
    // No transition from To Do → Done
    (mockPrisma.workflowTransition.findUnique as jest.Mock).mockResolvedValue(null);
    // Allowed transitions from To Do: only In Progress
    (mockPrisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'trans-1',
        fromStatusId: todoStatus.id,
        toStatusId: inProgressStatus.id,
        toStatus: { id: inProgressStatus.id, name: 'In Progress' },
      },
    ]);

    let thrownError: any;
    try {
      await WorkflowService.transition({ issueId: 'issue-1', toStatusId: doneStatus.id, userId: 'user-1' });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeDefined();
    expect(thrownError.statusCode).toBe(422);
    expect(thrownError.message).toContain('To Do');
    expect(thrownError.message).toContain('Done');
    expect(thrownError.allowedTransitions).toEqual([
      { statusId: inProgressStatus.id, statusName: 'In Progress' },
    ]);
  });

  it('allows valid To Do → In Progress transition', async () => {
    (mockPrisma.issue.findUnique as jest.Mock).mockResolvedValue(baseIssue);
    (mockPrisma.workflowStatus.findUnique as jest.Mock).mockResolvedValue(inProgressStatus);
    (mockPrisma.workflowTransition.findUnique as jest.Mock).mockResolvedValue({
      id: 'trans-1',
      projectId: PROJECT_ID,
      fromStatusId: todoStatus.id,
      toStatusId: inProgressStatus.id,
      conditions: null,
      actions: null,
    });
    (mockPrisma.issue.update as jest.Mock).mockResolvedValue({
      ...baseIssue, statusId: inProgressStatus.id, status: inProgressStatus, version: 2,
      assignee: null, reporter: { id: 'user-1', displayName: 'User 1' },
      sprint: null, parent: null,
      project: { id: PROJECT_ID, key: 'PROJ', name: 'Test Project' },
    });
    (mockPrisma.activityLog.create as jest.Mock).mockResolvedValue({});
    (mockPrisma.issueWatcher.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.automationRule.findMany as jest.Mock).mockResolvedValue([]);

    const result = await WorkflowService.transition({
      issueId: 'issue-1', toStatusId: inProgressStatus.id, userId: 'user-1',
    });

    expect(result.statusId).toBe(inProgressStatus.id);
    expect(result.version).toBe(2);
    const issueEvents = findRedisEvents('issue_updated');
    expect(issueEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('blocks transition when validation condition is not met', async () => {
    const issueNoAssignee = { ...baseIssue, statusId: inProgressStatus.id, status: inProgressStatus };
    (mockPrisma.issue.findUnique as jest.Mock).mockResolvedValue(issueNoAssignee);
    (mockPrisma.workflowStatus.findUnique as jest.Mock).mockResolvedValue(inReviewStatus);
    // Transition requires assignee field
    (mockPrisma.workflowTransition.findUnique as jest.Mock).mockResolvedValue({
      id: 'trans-2',
      projectId: PROJECT_ID,
      fromStatusId: inProgressStatus.id,
      toStatusId: inReviewStatus.id,
      conditions: [{ type: 'REQUIRED_FIELD', field: 'assigneeId' }],
      actions: null,
    });

    await expect(
      WorkflowService.transition({ issueId: 'issue-1', toStatusId: inReviewStatus.id, userId: 'user-1' })
    ).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('assigneeId') });
  });

  it('executes automation actions (auto-assign) on transition', async () => {
    (mockPrisma.issue.findUnique as jest.Mock).mockResolvedValue({
      ...baseIssue, statusId: inProgressStatus.id, status: inProgressStatus,
    });
    (mockPrisma.workflowStatus.findUnique as jest.Mock).mockResolvedValue(inReviewStatus);
    // Transition auto-assigns reviewer
    (mockPrisma.workflowTransition.findUnique as jest.Mock).mockResolvedValue({
      id: 'trans-3',
      projectId: PROJECT_ID,
      fromStatusId: inProgressStatus.id,
      toStatusId: inReviewStatus.id,
      conditions: null,
      actions: [{ type: 'ASSIGN_USER', userId: 'reviewer-id' }],
    });
    const updatedIssue = {
      ...baseIssue, statusId: inReviewStatus.id, status: inReviewStatus, version: 2,
      assignee: null, reporter: { id: 'user-1', displayName: 'User 1' },
      sprint: null, parent: null,
      project: { id: PROJECT_ID, key: 'PROJ', name: 'Test Project' },
    };
    (mockPrisma.issue.update as jest.Mock)
      .mockResolvedValueOnce(updatedIssue)         // status transition update
      .mockResolvedValueOnce({ ...updatedIssue, assigneeId: 'reviewer-id' }); // auto-assign update
    (mockPrisma.activityLog.create as jest.Mock).mockResolvedValue({});
    (mockPrisma.issueWatcher.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.automationRule.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.notification.create as jest.Mock).mockResolvedValue({});

    await WorkflowService.transition({
      issueId: 'issue-1', toStatusId: inReviewStatus.id, userId: 'user-1',
    });

    // Auto-assign action executed
    expect(mockPrisma.issue.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assigneeId: 'reviewer-id' }) })
    );
    // Notification sent to reviewer
    expect(mockPrisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'reviewer-id', type: 'ASSIGNED' }) })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Activity Service Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Activity Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisPublish.mockResolvedValue(undefined);
  });

  it('creates activity log with correct fields', async () => {
    const mockLog = {
      id: 'log-1', projectId: 'project-1', issueId: 'issue-1', userId: 'user-1',
      action: 'UPDATED', entityType: 'Issue', entityId: 'issue-1',
      changes: { title: { old: 'Old', new: 'New' } }, createdAt: new Date(),
      user: { id: 'user-1', displayName: 'Alice', avatarUrl: null },
    };
    (mockPrisma.activityLog.create as jest.Mock).mockResolvedValue(mockLog);

    const result = await ActivityService.log({
      projectId: 'project-1', issueId: 'issue-1', userId: 'user-1',
      action: 'UPDATED', entityType: 'Issue', entityId: 'issue-1',
      changes: { title: { old: 'Old', new: 'New' } },
    });

    expect(result).toEqual(mockLog);
    expect(mockPrisma.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'UPDATED', entityType: 'Issue' }) })
    );
  });

  it('paginates activity feed with cursor', async () => {
    const logs = Array.from({ length: 5 }, (_, i) => ({
      id: `log-${i}`, projectId: 'project-1', createdAt: new Date(),
      user: { id: 'user-1', displayName: 'Alice', avatarUrl: null }, issue: null,
    }));
    (mockPrisma.activityLog.findMany as jest.Mock).mockResolvedValue(logs);

    const result = await ActivityService.getProjectFeed({ projectId: 'project-1', limit: 5 });

    expect(result.data).toHaveLength(5);
    expect(result.pagination.hasMore).toBe(false);
  });
});

describe('Search Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('filters by status name when status query param is provided', async () => {
    (mockPrisma.issue.findMany as jest.Mock).mockResolvedValue([]);

    await SearchService.search({
      projectId: 'project-1',
      status: 'In Progress',
    });

    expect(mockPrisma.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: 'project-1',
          status: { name: { equals: 'In Progress', mode: 'insensitive' } },
        }),
      })
    );
  });

  it('supports assignee text filter using display name/email', async () => {
    (mockPrisma.issue.findMany as jest.Mock).mockResolvedValue([]);

    await SearchService.search({
      projectId: 'project-1',
      assignee: 'john',
    });

    expect(mockPrisma.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assignee: {
            OR: [
              { displayName: { contains: 'john', mode: 'insensitive' } },
              { email: { contains: 'john', mode: 'insensitive' } },
            ],
          },
        }),
      })
    );
  });

  it('applies assignee text filter even when assigneeId is provided', async () => {
    (mockPrisma.issue.findMany as jest.Mock).mockResolvedValue([]);

    await SearchService.search({
      projectId: 'project-1',
      assigneeId: 'user-1',
      assignee: 'john',
    });

    expect(mockPrisma.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assigneeId: 'user-1',
          assignee: {
            OR: [
              { displayName: { contains: 'john', mode: 'insensitive' } },
              { email: { contains: 'john', mode: 'insensitive' } },
            ],
          },
        }),
      })
    );
  });

  it('includes issue comments in full-text issue search', async () => {
    (mockPrisma.issue.findMany as jest.Mock).mockResolvedValue([]);

    await SearchService.search({
      projectId: 'project-1',
      q: 'oauth',
    });

    expect(mockPrisma.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { comments: { some: { content: { contains: 'oauth', mode: 'insensitive' } } } },
          ]),
        }),
      })
    );
  });
});
