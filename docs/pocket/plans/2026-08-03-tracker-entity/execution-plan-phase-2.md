# Tracker Entity — Tracker items CRUD, search, assignees, changelog (Phase 2 of 3)

**Date:** 2026-08-03
**Original plan:** /Users/rfxlamia/project/camel/docs/pocket/plans/2026-08-03-tracker-entity/execution-plan.md
**Prerequisite:** Phase 1 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T4, T5, T6}
**Unlocks next:** Phase 3

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

T4: Tracker items CRUD, search, assignees, changelog [depends: T3]
T5: Tracker realtime SSE events [depends: T4]
T6: Client types and API layer [depends: T4]

---

## Pocket Packets

---

### Task 4: Tracker items CRUD, search, assignees, changelog [depends: T3]

## OBJECTIVE
Full tracker items API: create (atomic key), read list with ILIKE search, read detail (with stale-prefix redirect metadata), PATCH with version/409, soft delete, multi-assignee, and per-item changelog (`GET /tracker/items/:key/events` — mirror `server/src/routes/activity.ts`).

Files:
- Create: `server/src/routes/tracker-items.ts`
- Create: `server/src/routes/tracker-assignees.ts`
- Modify: `server/src/routes/helpers.ts` (tracker_item_assignees cleanup on membership removal)
- Modify: `server/src/routes.ts`
- Test: `server/src/routes/tracker-items.integration.test.ts`

Steps:
1. Write failing integration tests:

```typescript
// server/src/routes/tracker-items.integration.test.ts
// Requires PostgreSQL. Gated: RUN_INTEGRATION=1
// Run: RUN_INTEGRATION=1 npm run test -- server/src/routes/tracker-items.integration.test.ts
import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { mockPublishEvent, mockCurrentUser } = vi.hoisted(() => ({
  mockPublishEvent: vi.fn(),
  mockCurrentUser: { id: 1, username: "testuser", displayName: "Test User" },
}));

vi.mock("../db/redis.js", () => ({
  getRedisClient: vi.fn(),
  connectRedis: vi.fn(),
}));

vi.mock("../realtime.js", () => ({
  publishEvent: mockPublishEvent,
  clearPresence: vi.fn(),
  heartbeat: vi.fn(),
  onlineUsers: vi.fn().mockResolvedValue([]),
  sseHandler: vi.fn(),
  createRealtimeHub: vi.fn(),
  initRealtime: vi.fn(),
  workspaceEventChannel: vi.fn(),
  workspacePresenceKey: vi.fn(),
  workspacePresencePattern: vi.fn(),
}));

vi.mock("../auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth.js")>();
  return {
    ...actual,
    requireAuth: (req: any, _res: any, next: any) => {
      req.user = mockCurrentUser;
      next();
    },
  };
});

import { pool } from "../db/pool.js";
import { createErrorHandler } from "../middleware/error-handler.js";
import { api } from "../routes.js";
import { workspaceAccessService } from "./helpers.js";
import * as trackerActivity from "./tracker-activity.js";

const recordSpy = vi.spyOn(trackerActivity, "recordTrackerActivity");

const WORKSPACE_ID = 101; // Isolated — not 94/95/96/97/99
const OTHER_WORKSPACE_ID = 102;

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", api);
  app.use(createErrorHandler());
  return app;
}

const app = createTestApp();

async function cleanupWorkspace(wid: number) {
  await pool.query("DELETE FROM tracker_events WHERE workspace_id = $1", [wid]);
  await pool.query("DELETE FROM tracker_item_assignees WHERE tracker_item_id IN (SELECT id FROM tracker_items WHERE workspace_id = $1)", [wid]);
  await pool.query("DELETE FROM tracker_item_labels WHERE tracker_item_id IN (SELECT id FROM tracker_items WHERE workspace_id = $1)", [wid]);
  await pool.query("DELETE FROM tracker_items WHERE workspace_id = $1", [wid]);
}

async function setupFixtures() {
  await pool.query(
    `INSERT INTO users (id, username, display_name, password_hash)
     VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
    [mockCurrentUser.id, mockCurrentUser.username, mockCurrentUser.displayName, "hashed"],
  );
  for (const [wid, name] of [
    [WORKSPACE_ID, "Camel"],
    [OTHER_WORKSPACE_ID, "Other"],
  ] as const) {
    await pool.query(
      `INSERT INTO workspaces (id, name, owner_user_id, is_personal)
       VALUES ($1, $2, $3, false) ON CONFLICT (id) DO NOTHING`,
      [wid, name, mockCurrentUser.id],
    );
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner') ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      [wid, mockCurrentUser.id],
    );
  }
}

beforeEach(async () => {
  await setupFixtures();
  await cleanupWorkspace(WORKSPACE_ID);
  await cleanupWorkspace(OTHER_WORKSPACE_ID);
  vi.clearAllMocks();
});

afterEach(async () => {
  await cleanupWorkspace(WORKSPACE_ID);
  await cleanupWorkspace(OTHER_WORKSPACE_ID);
});

afterAll(async () => {
  await cleanupWorkspace(WORKSPACE_ID);
  await cleanupWorkspace(OTHER_WORKSPACE_ID);
  await pool.query("DELETE FROM workspace_members WHERE workspace_id IN ($1, $2)", [WORKSPACE_ID, OTHER_WORKSPACE_ID]);
  await pool.query("DELETE FROM workspaces WHERE id IN ($1, $2)", [WORKSPACE_ID, OTHER_WORKSPACE_ID]);
});

describe.skipIf(!process.env.RUN_INTEGRATION)("tracker items CRUD", () => {
  it("creates item with Backlog status, null priority, and auto key CA-1", async () => {
    recordSpy.mockClear();
    const res = await request(app)
      .post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
      .send({ title: "Fix realtime" });
    expect(res.status).toBe(201);
    expect(res.body.key).toBe("CA-1");
    expect(res.body.status.name).toBe("Backlog");
    expect(res.body.priority).toBeNull();
    expect(recordSpy).toHaveBeenCalled();
  });

  it("rejects whitespace-only title with 400", async () => {
    const res = await request(app)
      .post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
      .send({ title: "   " });
    expect(res.status).toBe(400);
  });

  it("searches by title, description, and key number", async () => {
    await request(app)
      .post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
      .send({ title: "Workspace Rename", description: "rename flow" });

    const byTitle = await request(app).get(
      `/api/workspaces/${WORKSPACE_ID}/tracker/items?q=rename`,
    );
    expect(byTitle.body).toHaveLength(1);

    const byNumber = await request(app).get(
      `/api/workspaces/${WORKSPACE_ID}/tracker/items?q=1`,
    );
    expect(byNumber.body.some((i: { key: string }) => i.key === "CA-1")).toBe(true);
  });

  it("returns 409 on stale version PATCH", async () => {
    recordSpy.mockClear();
    const created = await request(app)
      .post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
      .send({ title: "Conflict test" });
    const res = await request(app)
      .patch(`/api/workspaces/${WORKSPACE_ID}/tracker/items/CA-1`)
      .send({ title: "Updated", version: 999 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("version_conflict");
    expect(created.body.version).toBe(1);
    expect(recordSpy).toHaveBeenCalled();
  });

  it("redirects stale prefix URL to canonical key on GET detail", async () => {
    await request(app)
      .post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
      .send({ title: "Rename test" });
    await pool.query(
      `UPDATE workspaces SET name = $1 WHERE id = $2`,
      ["CK Team", WORKSPACE_ID],
    );
    const res = await request(app).get(
      `/api/workspaces/${WORKSPACE_ID}/tracker/items/CA-1`,
    );
    expect(res.status).toBe(200);
    expect(res.body.key).toBe("CT-1");
    expect(res.body.canonicalKey).toBe("CT-1");
    expect(res.body.redirectFrom).toBe("CA-1");
  });

  it("returns changelog events from tracker_events", async () => {
    await request(app)
      .post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
      .send({ title: "Changelog test" });
    await request(app)
      .patch(`/api/workspaces/${WORKSPACE_ID}/tracker/items/CA-1`)
      .send({ title: "Changelog test v2", version: 1 });

    const res = await request(app).get(
      `/api/workspaces/${WORKSPACE_ID}/tracker/items/CA-1/events`,
    );
    expect(res.status).toBe(200);
    expect(res.body.events.length).toBeGreaterThanOrEqual(2);
    expect(res.body.events[0]).toMatchObject({
      eventType: expect.any(String),
      createdAt: expect.any(String),
    });
  });

  it("soft-deletes item: absent from list, search, detail 404; key_number not reused", async () => {
    await request(app)
      .post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
      .send({ title: "To delete" });

    const del = await request(app)
      .delete(`/api/workspaces/${WORKSPACE_ID}/tracker/items/CA-1`)
      .send({ version: 1 });
    expect(del.status).toBe(204);

    const list = await request(app).get(`/api/workspaces/${WORKSPACE_ID}/tracker/items`);
    expect(list.body).toHaveLength(0);

    const search = await request(app).get(
      `/api/workspaces/${WORKSPACE_ID}/tracker/items?q=delete`,
    );
    expect(search.body).toHaveLength(0);

    const detail = await request(app).get(
      `/api/workspaces/${WORKSPACE_ID}/tracker/items/CA-1`,
    );
    expect(detail.status).toBe(404);

    const next = await request(app)
      .post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
      .send({ title: "Next item" });
    expect(next.body.key).toBe("CA-2");
  });

  it("returns 404 for item in wrong workspace context", async () => {
    await request(app)
      .post(`/api/workspaces/${OTHER_WORKSPACE_ID}/tracker/items`)
      .send({ title: "Other ws item" });

    const res = await request(app).get(
      `/api/workspaces/${WORKSPACE_ID}/tracker/items/CA-1`,
    );
    expect(res.status).toBe(404);
  });

  it("rejects non-member assignee with 400", async () => {
    await pool.query(
      `INSERT INTO users (id, username, display_name, password_hash)
       VALUES (99, 'outsider', 'Outsider', 'hash') ON CONFLICT (id) DO NOTHING`,
    );
    const res = await request(app)
      .post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
      .send({ title: "Assign test", assigneeIds: [99] });
    expect(res.status).toBe(400);
  });

  it("strips assignee on membership removal", async () => {
    await pool.query(
      `INSERT INTO users (id, username, display_name, password_hash)
       VALUES (2, 'bob', 'Bob', 'hash') ON CONFLICT (id) DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, 2, 'member') ON CONFLICT DO NOTHING`,
      [WORKSPACE_ID],
    );
    const created = await request(app)
      .post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
      .send({ title: "Shared", assigneeIds: [2] });
    expect(created.body.assignees).toHaveLength(1);

    await workspaceAccessService.removeMember({
      actorId: mockCurrentUser.id,
      workspaceId: WORKSPACE_ID,
      userId: 2,
    });

    const detail = await request(app).get(
      `/api/workspaces/${WORKSPACE_ID}/tracker/items/CA-1`,
    );
    expect(detail.body.assignees).toHaveLength(0);
  });

  it("allows member role to CRUD tracker items", async () => {
    const memberUser = { id: 3, username: "member", displayName: "Member" };
    await pool.query(
      `INSERT INTO users (id, username, display_name, password_hash)
       VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
      [memberUser.id, memberUser.username, memberUser.displayName, "hash"],
    );
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
      [WORKSPACE_ID, memberUser.id],
    );
    Object.assign(mockCurrentUser, memberUser);
    const create = await request(app)
      .post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
      .send({ title: "Member create" });
    expect(create.status).toBe(201);
    Object.assign(mockCurrentUser, {
      id: 1,
      username: "testuser",
      displayName: "Test User",
    });
  });
});
```

2. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test -- server/src/routes/tracker-items.integration.test.ts`
3. Implement routes mirroring cards patterns; call recordTrackerActivity on every mutation.
4. Run test — verify PASS: `RUN_INTEGRATION=1 npm run test -- server/src/routes/tracker-items.integration.test.ts`
5. Refactor while green (bounded): extract shared assignee validation if duplicated with cards.
6. Commit: `feat(tracker): add tracker items CRUD API`

## REFERENCES LOADED
server/src/routes/cards.ts — version/409, assignee patterns
server/src/routes/card-assignees.ts — assignee sync
server/src/routes/cards-mutations.integration.test.ts — integration harness pattern

## WHY THIS APPROACH
Complexity: deep — core API surface

## SANDWICH CONTEXT
[CRITICAL: Do not import or call recordActivity for tracker mutations]
[RESTATE: recordTrackerActivity only]

## DELIVERABLE
Given title-only create, When POST, Then Backlog status, null priority, auto key.
Given title "   ", When POST, Then 400.
Given stale version PATCH, Then 409.
Given stale prefix in URL, When GET detail, Then canonical key returned with redirectFrom metadata.
Given item with mutations, When GET /tracker/items/:key/events, Then changelog events returned.
Given soft delete, Then absent from list, search, and detail 404, and key_number not reused by next create.
Given user with role member, When CRUD tracker item, Then operation succeeds.
Given key exists only in workspace A, When member in workspace B opens detail URL, Then 404.
Given non-member user U, When assigned to item, Then 400.
Given create or PATCH, When mutation completes, Then recordTrackerActivity called.

## QUALITY BAR
Must-have: recordTrackerActivity on all mutations, deleted_at filtering
Must-not-have: card_events writes

## STOP CONDITIONS
Done when: integration tests pass

---

### Task 5: Tracker realtime SSE events [depends: T4]

## OBJECTIVE
Add tracker.* event types to BoardEvent union; publish on tracker/vocab mutations.

Files:
- Modify: `server/src/realtime.ts`
- Modify: `server/src/routes/tracker-items.ts`
- Modify: `server/src/routes/tracker-vocabularies.ts`
- Test: extend `server/src/routes/tracker-items.integration.test.ts`

Steps:
1. Write failing tests (append to same integration file):

```typescript
// Append to server/src/routes/tracker-items.integration.test.ts
describe.skipIf(!process.env.RUN_INTEGRATION)("tracker realtime SSE", () => {
  it("publishes tracker.created on item POST", async () => {
    mockPublishEvent.mockClear();

    const res = await request(app)
      .post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
      .send({ title: "New item" });
    expect(res.status).toBe(201);

    expect(mockPublishEvent).toHaveBeenCalledWith(
      WORKSPACE_ID,
      expect.objectContaining({ type: "tracker.created" }),
    );
  });

  it("publishes tracker.updated on item PATCH", async () => {
    await request(app)
      .post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
      .send({ title: "Live update" });

    mockPublishEvent.mockClear();

    const res = await request(app)
      .patch(`/api/workspaces/${WORKSPACE_ID}/tracker/items/CA-1`)
      .send({ title: "Live update v2", version: 1 });
    expect(res.status).toBe(200);

    expect(mockPublishEvent).toHaveBeenCalledWith(
      WORKSPACE_ID,
      expect.objectContaining({ type: "tracker.updated" }),
    );
  });

  it("publishes tracker.deleted on soft delete", async () => {
    await request(app)
      .post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
      .send({ title: "Delete me" });
    mockPublishEvent.mockClear();

    const res = await request(app)
      .delete(`/api/workspaces/${WORKSPACE_ID}/tracker/items/CA-1`)
      .send({ version: 1 });
    expect(res.status).toBe(204);

    expect(mockPublishEvent).toHaveBeenCalledWith(
      WORKSPACE_ID,
      expect.objectContaining({ type: "tracker.deleted" }),
    );
  });

  it("publishes tracker.vocabulary.created on vocab POST", async () => {
    mockPublishEvent.mockClear();

    const res = await request(app)
      .post(`/api/workspaces/${WORKSPACE_ID}/tracker/vocabularies`)
      .send({ kind: "status", name: "Blocked", position: 1500 });
    expect(res.status).toBe(201);

    expect(mockPublishEvent).toHaveBeenCalledWith(
      WORKSPACE_ID,
      expect.objectContaining({ type: "tracker.vocabulary.created" }),
    );
  });
});
```

2. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test -- server/src/routes/tracker-items.integration.test.ts`
3. Add event types and publishEvent calls on items and vocab routes.
4. Run test — verify PASS: `RUN_INTEGRATION=1 npm run test -- server/src/routes/tracker-items.integration.test.ts`
5. Refactor while green (bounded): none expected — skip if nothing to extract.
6. Commit: `feat(tracker): add realtime SSE events`

## DELIVERABLE
Given two clients subscribed, When item created, Then tracker.created event published.
Given two clients subscribed, When item updated, Then tracker.updated event published.
Given vocabulary status added, When create completes, Then tracker.vocabulary.created event published.
Given item soft-deleted, When delete completes, Then tracker.deleted event published.

## QUALITY BAR
Must-not-have: Changes to card event types behavior

## STOP CONDITIONS
Done when: SSE test passes

---

### Task 6: Client types and API layer [depends: T4]

## OBJECTIVE
Add TrackerItem, TrackerVocabulary types; api.ts methods for tracker endpoints.

Files:
- Modify: `client/src/types.ts`
- Modify: `client/src/api.ts`
- Test: `client/src/api.tracker.test.ts`

Steps:
1. Write failing tests:

```typescript
// client/src/api.tracker.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("tracker API methods", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("createTrackerItem POSTs to workspace tracker items path", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: () =>
        Promise.resolve({
          id: 1,
          key: "CA-1",
          title: "Fix realtime",
          status: { id: 1, name: "Backlog", kind: "status" },
          priority: null,
          labels: [],
          assignees: [],
          version: 1,
          createdAt: "2026-08-03T00:00:00Z",
        }),
    });

    const { api } = await import("./api");
    const result = await api.createTrackerItem(7, { title: "Fix realtime" });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/workspaces/7/tracker/items",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "Fix realtime" }),
      }),
    );
    expect(result.key).toBe("CA-1");
  });

  it("listTrackerItems GETs with optional search query", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    });

    const { api } = await import("./api");
    await api.listTrackerItems(7, { q: "rename" });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/workspaces/7/tracker/items?q=rename",
      expect.any(Object),
    );
  });

  it("updateTrackerItem PATCHes with version for optimistic locking", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ key: "CA-1", version: 2 }),
    });

    const { api } = await import("./api");
    await api.updateTrackerItem(7, "CA-1", {
      title: "Updated",
      version: 1,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/workspaces/7/tracker/items/CA-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "Updated", version: 1 }),
      }),
    );
  });

  it("getTrackerItem GETs detail by key", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ key: "CA-42", title: "Workspace Rename", version: 1 }),
    });

    const { api } = await import("./api");
    const result = await api.getTrackerItem(7, "CA-42");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/workspaces/7/tracker/items/CA-42",
      expect.any(Object),
    );
    expect(result.key).toBe("CA-42");
  });

  it("deleteTrackerItem DELETEs with version", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

    const { api } = await import("./api");
    await api.deleteTrackerItem(7, "CA-1", { version: 1 });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/workspaces/7/tracker/items/CA-1",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ version: 1 }),
      }),
    );
  });

  it("getTrackerChangelog GETs events path", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ events: [{ id: 1, eventType: "tracker_item_created" }] }),
    });

    const { api } = await import("./api");
    const result = await api.getTrackerChangelog(7, "CA-42");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/workspaces/7/tracker/items/CA-42/events",
      expect.any(Object),
    );
    expect(result.events).toHaveLength(1);
  });

  it("listTrackerVocabularies and createTrackerVocabulary use vocab path", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: () =>
        Promise.resolve({
          id: 10,
          kind: "status",
          name: "Blocked",
          position: 1500,
          colour: "oklch(0.7 0.1 200)",
        }),
    });

    const { api } = await import("./api");
    await api.listTrackerVocabularies(7, "status");
    await api.createTrackerVocabulary(7, {
      kind: "status",
      name: "Blocked",
      position: 1500,
    });

    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      "/api/workspaces/7/tracker/vocabularies?kind=status",
      expect.any(Object),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "/api/workspaces/7/tracker/vocabularies",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
```

2. Run test — verify FAIL: `npm run test -- client/src/api.tracker.test.ts`
3. Implement types and api methods.
4. Run test — verify PASS: `npm run test -- client/src/api.tracker.test.ts`
5. Refactor while green (bounded): none expected — skip if nothing to extract.
6. Commit: `feat(tracker): add client API layer`

## DELIVERABLE
Given api.createTrackerItem, When called, Then POST to correct workspace path.
Given api.getTrackerItem, When called, Then GET detail by key.
Given api.deleteTrackerItem, When called, Then DELETE with version.
Given api.getTrackerChangelog, When called, Then GET /tracker/items/:key/events.

## STOP CONDITIONS
Done when: client API tests pass

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 3 ONLY after this gate passes.
