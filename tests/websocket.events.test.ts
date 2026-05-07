/**
 * WebSocket integration scaffold
 *
 * This file is intentionally a scaffold so teams can plug in their preferred
 * Socket.IO integration harness (real Redis + authenticated test sockets).
 */

describe.skip('WebSocket event integration scaffold', () => {
  it('replays ordered events after reconnect using lastEventId', async () => {
    // Example flow:
    // 1) connect socket with JWT
    // 2) emit join:project with lastEventId
    // 3) assert missed_events payload is sorted by eventId
    expect(true).toBe(true);
  });

  it('supports project and issue room subscriptions', async () => {
    // Example flow:
    // 1) emit join:project
    // 2) emit join:issue
    // 3) assert issue-scoped events arrive on issue room listeners
    expect(true).toBe(true);
  });
});
