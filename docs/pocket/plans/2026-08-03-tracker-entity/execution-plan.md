# EXECUTION PLAN — Tracker Entity

**Date:** 2026-08-03
**Spec:** docs/pocket/spec/2026-08-03-tracker-entity/tracker-entity.md
**GitHub issue:** #87
**Status:** approved
**Total tasks:** 8

### Test-Architect Summary
Tasks enriched: 8
Integration test tasks added: 0 (T4/T5 use `tracker-items.integration.test.ts`; no separate integration task)
TDD order corrections: 5 (T1, T2, T3, T5, T8 — added missing refactor step; T5/T8 renumbered commit to step 6)
Test framework: Vitest (server + client), `npm run test -- <path>` from repo root; server integration gated `RUN_INTEGRATION=1`
Coverage areas: schema migration assertions, `recordTrackerActivity` unit, vocabulary API + key utils, tracker CRUD/search/assignees/changelog integration, SSE publish assertions, client API fetch mocks, TrackerPage jsdom, TrackerDetailPage jsdom + SSE

### Plan Validation Fixes (2026-08-03)
Applied after external plan review (grade C+ → execution-ready):
- **T4:** Added `GET /tracker/items/:key/events` changelog endpoint (mirror `activity.ts`); stale-prefix redirect by `key_number`; `recordTrackerActivity` spy assertions
- **T4:** Fixed assignee cleanup test → `workspaceAccessService.removeMember({ actorId, workspaceId, userId })`
- **T3/T4:** Workspace IDs → 100 (vocab), 101/102 (items) — isolated from 94/95/96/97/99
- **T3:** `RUN_INTEGRATION=1` gate on vocab API tests; server `pastelColor.ts` (not client `columnColorUtils`)
- **T3:** `derivePrefix` parity cases aligned with `workspaceInitials()`
- **T6:** Added `getTrackerItem`, `deleteTrackerItem`, `getTrackerChangelog` API methods + tests
- **T5:** Added `tracker.created` SSE test
- **T7:** BoardContext `subscribeTrackerEvents` plumbing (enables vocab SSE test); T8 extends handlers
- **T1:** `make db-migrate` + hand-edit `types.ts` documented in Step 3

---

## Execution Overview

### Recommended Order
```
T1 → T2 → T3 → T4 → T5, T6 (parallel) → T7 → T8
```

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Server realtime | T5 | T4 completes |
| Client API types | T6 | T4 completes (can parallel with T5) |

### Constraints Reminder
**Architecture:** Do NOT touch Board/cards/columns or `card_events`/`recordActivity`. Use `tracker_events` + `recordTrackerActivity()`.
**Out-of-scope:** Filter UI, vocab delete/rename, fuse.js, Activity feed integration, card linkage.
**Assumptions at risk:** ILIKE search case-insensitive; version required on PATCH; concurrent key via atomic counter.

### File Structure Map

```
Rule: DB schema + seed
  Modify: server/src/db/schema.sql
  Modify: server/src/db/types.ts (regenerate or hand-add interfaces)
  Test:   server/src/db/tracker-migration.test.ts

Rule: Activity logging
  Create: server/src/routes/tracker-activity.ts
  Modify: server/src/routes/helpers.ts (tracker assignee cleanup only)
  Test:   server/src/routes/tracker-activity.test.ts

Rule: Vocabulary API
  Create: server/src/routes/tracker-vocabularies.ts
  Create: server/src/core/tracker-key.ts
  Create: server/src/core/pastelColor.ts
  Modify: server/src/routes.ts (mount vocab router)
  Test:   server/src/core/tracker-key.test.ts
  Test:   server/src/routes/tracker-vocabularies.test.ts

Rule: Tracker items CRUD + search + changelog
  Create: server/src/routes/tracker-items.ts (includes GET /tracker/items/:key/events)
  Create: server/src/routes/tracker-assignees.ts
  Modify: server/src/routes/helpers.ts (tracker_item_assignees cleanup on membership removal)
  Modify: server/src/routes.ts
  Test:   server/src/routes/tracker-items.integration.test.ts

Rule: Realtime
  Modify: server/src/realtime.ts
  Modify: server/src/routes/tracker-items.ts (publish events)
  Modify: server/src/routes/tracker-vocabularies.ts (publish events)
  Test:   server/src/routes/tracker-items.integration.test.ts

Rule: Client API
  Modify: client/src/types.ts
  Modify: client/src/api.ts
  Test:   client/src/api.tracker.test.ts

Rule: Tracker list page + create modal + nav
  Create: client/src/pages/TrackerPage.tsx
  Create: client/src/components/tracker/TrackerRow.tsx
  Create: client/src/components/tracker/TrackerSection.tsx
  Create: client/src/components/tracker/TrackerCreateModal.tsx
  Create: client/src/lib/trackerUtils.ts
  Modify: client/src/App.tsx (tracker list route)
  Modify: client/src/layout/sidebar/navItems.ts
  Modify: client/src/context/BoardContext.tsx (subscribeTrackerEvents registry — T7)
  Test:   client/src/pages/TrackerPage.test.tsx

Rule: Tracker detail page + changelog + realtime client
  Create: client/src/pages/TrackerDetailPage.tsx
  Create: client/src/components/tracker/TrackerChangelog.tsx
  Modify: client/src/App.tsx (tracker detail route)
  Modify: client/src/context/BoardContext.tsx (dispatch tracker SSE to subscribers — T8)
  Test:   client/src/pages/TrackerDetailPage.test.tsx
```

---

## Pocket Packets

---

### Task 1: Tracker DB schema and vocabulary seed [prereq]

## OBJECTIVE
Add tracker tables to schema.sql, workspace counter column, retroactive vocabulary seed for existing workspaces.

Files:
- Modify: `server/src/db/schema.sql`
- Modify: `server/src/db/types.ts`
- Test: `server/src/db/tracker-migration.test.ts`

Steps:
1. Write failing test:

```typescript
// server/src/db/tracker-migration.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schemaSql = readFileSync(
  new URL("./schema.sql", import.meta.url),
  "utf8",
);

describe("tracker migration schema", () => {
  it("declares tracker tables, workspace counter, and junction tables", () => {
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS tracker_items");
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS tracker_vocabularies");
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS tracker_item_labels");
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS tracker_item_assignees");
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS tracker_events");
    expect(schemaSql).toMatch(
      /ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS tracker_key_counter/,
    );
    expect(schemaSql).toMatch(/tracker_items[\s\S]*version/s);
    expect(schemaSql).toMatch(/tracker_items[\s\S]*deleted_at/s);
    expect(schemaSql).toMatch(/tracker_items[\s\S]*key_number/s);
    expect(schemaSql).toMatch(/tracker_vocabularies[\s\S]*kind/s);
    expect(schemaSql).toMatch(/tracker_vocabularies[\s\S]*position/s);
  });

  it("seeds default vocabulary for existing workspaces idempotently", () => {
    expect(schemaSql).toMatch(/INSERT INTO tracker_vocabularies/i);
    const statusNames = ["Backlog", "Todo", "In Progress", "Done", "Canceled"];
    for (const name of statusNames) {
      expect(schemaSql).toContain(name);
    }
    for (const name of ["High", "Medium", "Low"]) {
      expect(schemaSql).toContain(name);
    }
    for (const name of ["Feature", "Bug", "Maintain"]) {
      expect(schemaSql).toContain(name);
    }
    // Idempotent seed: ON CONFLICT or NOT EXISTS guard
    expect(schemaSql).toMatch(/ON CONFLICT|WHERE NOT EXISTS/i);
  });
});
```

2. Run test — verify FAIL: `npm run test -- server/src/db/tracker-migration.test.ts`
3. Implement schema + idempotent seed DO block in schema.sql; run `make db-migrate`; hand-add Kysely interfaces to `server/src/db/types.ts` (no codegen Makefile target — mirror existing table interfaces).
4. Run test — verify PASS: `npm run test -- server/src/db/tracker-migration.test.ts`
5. Refactor while green (bounded): none expected — skip if nothing to extract.
6. Commit: `feat(tracker): add database schema and vocabulary seed`

## REFERENCES LOADED
docs/pocket/spec/2026-08-03-tracker-entity/tracker-entity.md — Rule: Vocabulary migration seeds defaults
server/src/db/schema.sql — existing migration patterns
server/src/db/workspaceMigration.test.ts — schema content assertion pattern

## WHY THIS APPROACH
Complexity: standard — foundation for all tracker work.

## SANDWICH CONTEXT
[CRITICAL: Do not modify cards/columns/card_events tables]
Spec: docs/pocket/spec/2026-08-03-tracker-entity/tracker-entity.md
Design: Option A unified vocabulary table
[RESTATE: Board tables untouched]

## DELIVERABLE
Given pre-tracker workspace, When migration runs, Then default status (Backlog/Todo/In Progress/Done/Canceled), priority (High/Medium/Low), and label (Feature/Bug/Maintain) vocab exists.
Given schema applied, When querying tracker_items, Then table exists with version and deleted_at columns.

## QUALITY BAR
Must-have: TDD, idempotent migration, default status Backlog/Todo/In Progress/Done/Canceled
Must-not-have: Changes to card_events or cards schema beyond unrelated coexistence
Open question risks: fractional position for vocab ordering → use position.ts pattern

## STOP CONDITIONS
Done when: migration test passes, commit exists
Escalate when: schema conflicts with existing tables

---

### Task 2: recordTrackerActivity helper [depends: T1]

## OBJECTIVE
Create `recordTrackerActivity()` writing to `tracker_events` — separate from `recordActivity()`.

Files:
- Create: `server/src/routes/tracker-activity.ts`
- Test: `server/src/routes/tracker-activity.test.ts`

Steps:
1. Write failing test:

```typescript
// server/src/routes/tracker-activity.test.ts
import { describe, expect, it, vi } from "vitest";
import { recordTrackerActivity } from "./tracker-activity.js";

function createMockExecutor() {
  const execute = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ execute });
  const insertInto = vi.fn().mockReturnValue({ values });
  return { dbExec: { insertInto } as any, insertInto, values, execute };
}

const actor = { id: 7, username: "alice", displayName: "Alice" };

describe("recordTrackerActivity", () => {
  it("inserts tracker_events row with event_type and JSONB payload", async () => {
    const { dbExec, insertInto, values, execute } = createMockExecutor();

    await recordTrackerActivity(dbExec, actor, 42, "tracker_item_created", {
      trackerItemId: 99,
      payload: { title: "Fix realtime" },
    });

    expect(insertInto).toHaveBeenCalledWith("tracker_events");
    expect(values).toHaveBeenCalledWith({
      tracker_item_id: 99,
      actor_id: actor.id,
      event_type: "tracker_item_created",
      payload: JSON.stringify({ title: "Fix realtime" }),
      workspace_id: 42,
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("never touches card_events", async () => {
    const { dbExec, insertInto } = createMockExecutor();
    await recordTrackerActivity(dbExec, actor, 1, "tracker_item_updated", {
      trackerItemId: 1,
    });
    expect(insertInto).not.toHaveBeenCalledWith("card_events");
  });
});
```

2. Run test — verify FAIL: `npm run test -- server/src/routes/tracker-activity.test.ts`
3. Implement recordTrackerActivity with closed eventType union for tracker mutations.
4. Run test — verify PASS: `npm run test -- server/src/routes/tracker-activity.test.ts`
5. Refactor while green (bounded): none expected — skip if nothing to extract.
6. Commit: `feat(tracker): add recordTrackerActivity helper`

## REFERENCES LOADED
server/src/routes/helpers.ts:369-398 — pattern to NOT extend
docs/pocket/spec/2026-08-03-tracker-entity/tracker-entity.md — activity separate from cards

## WHY THIS APPROACH
Complexity: lightweight

## SANDWICH CONTEXT
[CRITICAL: Never call recordActivity() or insert into card_events for tracker]
[RESTATE: tracker_events only]

## DELIVERABLE
Given tracker item mutation, When recordTrackerActivity called, Then row in tracker_events with actor and payload.

## QUALITY BAR
Must-not-have: Any writes to card_events

## STOP CONDITIONS
Done when: test passes, commit exists

---

### Task 3: Tracker vocabulary and key utilities API [depends: T1, T2]

## OBJECTIVE
Vocabulary list/create endpoints; `workspaceInitials` prefix helper; duplicate name rejection; position on create; server-side pastel colour via `pastelColor.ts` (not client `columnColorUtils`).

Files:
- Create: `server/src/core/tracker-key.ts`
- Create: `server/src/core/pastelColor.ts`
- Create: `server/src/routes/tracker-vocabularies.ts`
- Modify: `server/src/routes.ts`
- Test: `server/src/core/tracker-key.test.ts`
- Test: `server/src/routes/tracker-vocabularies.test.ts`

Steps:
1. Write failing tests:

```typescript
// server/src/core/tracker-key.ts — unit tests (same file or tracker-key.test.ts)
import { describe, expect, it } from "vitest";
import { derivePrefix, formatKey, parseKeyFromUrl } from "./tracker-key.js";

describe("tracker-key utilities", () => {
  it("derivePrefix matches workspaceInitials rules (keep in sync with client/src/lib/workspaceSwitcher.ts)", () => {
    expect(derivePrefix("Camel")).toBe("CA");
    expect(derivePrefix("My Workspace")).toBe("MW");
    expect(derivePrefix("Solo")).toBe("SO");
    expect(derivePrefix("")).toBe("?");
    expect(derivePrefix("Default Workspace")).toBe("DW");
  });

  it("formatKey and parseKeyFromUrl are inverse for valid keys", () => {
    expect(formatKey("CA", 42)).toBe("CA-42");
    expect(parseKeyFromUrl("CA-42")).toEqual({ prefix: "CA", keyNumber: 42 });
    expect(parseKeyFromUrl("bad")).toBeNull();
  });
});
```

```typescript
// server/src/routes/tracker-vocabularies.test.ts
// Requires PostgreSQL. Gated: RUN_INTEGRATION=1
// Run: RUN_INTEGRATION=1 npm run test -- server/src/routes/tracker-vocabularies.test.ts
import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockTestUser } = vi.hoisted(() => ({
  mockTestUser: { id: 1, username: "testuser", displayName: "Test User" },
}));

vi.mock("../db/redis.js", () => ({
  getRedisClient: vi.fn(),
  connectRedis: vi.fn(),
}));

vi.mock("../realtime.js", () => ({
  publishEvent: vi.fn(),
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
      req.user = mockTestUser;
      next();
    },
  };
});

import { createErrorHandler } from "../middleware/error-handler.js";
import { api } from "../routes.js";

const WORKSPACE_ID = 100; // Isolated from columns.patch (96), members (95), cards-mutations (97), columns.batch (99)

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", api);
  app.use(createErrorHandler());
  return app;
}

const app = createTestApp();

describe.skipIf(!process.env.RUN_INTEGRATION)("tracker vocabulary API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists status vocabulary ordered by position", async () => {
    const res = await request(app).get(
      `/api/workspaces/${WORKSPACE_ID}/tracker/vocabularies?kind=status`,
    );
    expect(res.status).toBe(200);
    const names = res.body.map((v: { name: string }) => v.name);
    expect(names).toEqual([
      "Backlog",
      "Todo",
      "In Progress",
      "Done",
      "Canceled",
    ]);
  });

  it("creates status with fractional position between neighbors", async () => {
    const res = await request(app)
      .post(`/api/workspaces/${WORKSPACE_ID}/tracker/vocabularies`)
      .send({ kind: "status", name: "Blocked", position: 1500 });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Blocked");
    expect(res.body.position).toBe(1500);
    expect(res.body.colour).toMatch(/^oklch\(/i);
  });

  it("rejects duplicate vocabulary name case-insensitively", async () => {
    await request(app)
      .post(`/api/workspaces/${WORKSPACE_ID}/tracker/vocabularies`)
      .send({ kind: "status", name: "Blocked", position: 1500 });

    const dup = await request(app)
      .post(`/api/workspaces/${WORKSPACE_ID}/tracker/vocabularies`)
      .send({ kind: "status", name: "blocked", position: 1600 });

    expect([400, 409]).toContain(dup.status);
  });

  it("assigns auto pastel colour on label create", async () => {
    const res = await request(app)
      .post(`/api/workspaces/${WORKSPACE_ID}/tracker/vocabularies`)
      .send({ kind: "label", name: "Infra", position: 1000 });
    expect(res.status).toBe(201);
    expect(res.body.colour).toMatch(/^oklch\(/i);
  });
});
```

2. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test -- server/src/routes/tracker-vocabularies.test.ts`
3. Implement routes + tracker-key.ts + pastelColor.ts (mirror OKLCH bands from columnColorUtils constants).
4. Run test — verify PASS: `RUN_INTEGRATION=1 npm run test -- server/src/routes/tracker-vocabularies.test.ts`
5. Refactor while green (bounded): extract shared vocab validation if duplicated.
6. Commit: `feat(tracker): add vocabulary API and key utilities`

## REFERENCES LOADED
client/src/lib/workspaceSwitcher.ts:141-146 — workspaceInitials (derivePrefix must stay in parity)
client/src/lib/columnColorUtils.ts — OKLCH constant reference only; implement server/src/core/pastelColor.ts

## WHY THIS APPROACH
Complexity: standard

## DELIVERABLE
Given status "Blocked" exists, When add "blocked", Then 400/409.
Given new label, When created, Then auto OKLCH colour assigned.

## QUALITY BAR
Must-not-have: delete/rename endpoints

## STOP CONDITIONS
Done when: vocab tests pass

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

### Task 7: Tracker list page [depends: T6]

## OBJECTIVE
/tracker page: status-grouped sections, dense Linear-style rows, search, collapse in-memory, global + button opens create modal.

Files:
- Create: `client/src/pages/TrackerPage.tsx`
- Create: `client/src/components/tracker/TrackerRow.tsx`
- Create: `client/src/components/tracker/TrackerSection.tsx`
- Create: `client/src/components/tracker/TrackerCreateModal.tsx`
- Create: `client/src/lib/trackerUtils.ts`
- Modify: `client/src/App.tsx`
- Modify: `client/src/layout/sidebar/navItems.ts`
- Modify: `client/src/context/BoardContext.tsx` (add `subscribeTrackerEvents` registry for tracker SSE)
- Test: `client/src/pages/TrackerPage.test.tsx`

Steps:
1. Write failing tests:

```typescript
// @vitest-environment jsdom
// client/src/pages/TrackerPage.test.tsx
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackerItem, TrackerVocabulary } from "../types";

const {
  mockListTrackerItems,
  mockCreateTrackerItem,
  mockListTrackerVocabularies,
  mockUseBoard,
  mockNavigate,
  mockLocation,
} = vi.hoisted(() => ({
  mockListTrackerItems: vi.fn(),
  mockCreateTrackerItem: vi.fn(),
  mockListTrackerVocabularies: vi.fn(),
  mockUseBoard: vi.fn(),
  mockNavigate: vi.fn(),
  mockLocation: { pathname: "/tracker", key: "tracker-1" },
}));

vi.mock("../api", () => ({
  api: {
    listTrackerItems: (...a: unknown[]) => mockListTrackerItems(...a),
    createTrackerItem: (...a: unknown[]) => mockCreateTrackerItem(...a),
    listTrackerVocabularies: (...a: unknown[]) =>
      mockListTrackerVocabularies(...a),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("../context/BoardContext", () => ({
  useBoard: () => mockUseBoard(),
}));

vi.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));

import TrackerPage from "./TrackerPage";
import { KANBAN_NAV } from "../layout/sidebar/navItems";

const statuses: TrackerVocabulary[] = [
  { id: 1, kind: "status", name: "Backlog", position: 1000, colour: "oklch(0.7 0.1 200)" },
  { id: 2, kind: "status", name: "Done", position: 5000, colour: "oklch(0.7 0.1 140)" },
];

function makeItem(overrides: Partial<TrackerItem> & { id: number }): TrackerItem {
  return {
    key: "CA-1",
    title: "Workspace Rename",
    description: null,
    status: statuses[0]!,
    priority: null,
    labels: [{ id: 3, kind: "label", name: "Feature", position: 1000, colour: "oklch(0.7 0.1 260)" }],
    assignees: [{ id: 7, displayName: "Alice", username: "alice" }],
    version: 1,
    createdAt: "2026-07-04T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  mockListTrackerVocabularies.mockResolvedValue(statuses);
  mockListTrackerItems.mockResolvedValue([
    makeItem({ id: 1, key: "CA-1", title: "Workspace Rename" }),
    makeItem({ id: 2, key: "CA-2", title: "Done task", status: statuses[1]! }),
  ]);
  mockCreateTrackerItem.mockResolvedValue(makeItem({ id: 3, key: "CA-3", title: "New" }));
  mockUseBoard.mockReturnValue({
    activeWorkspaceId: 7,
    subscribeTrackerEvents: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TrackerPage", () => {
  it("renders sections ordered by vocab position with row metadata", async () => {
    render(<TrackerPage />);
    await waitFor(() => expect(screen.getByText("Backlog")).toBeTruthy());
    expect(screen.getByText("CA-1")).toBeTruthy();
    expect(screen.getByText("Workspace Rename")).toBeTruthy();
    expect(screen.getByText("Feature")).toBeTruthy();
    expect(screen.getByTestId("tracker-row-CA-1")).toBeTruthy();
  });

  it("hides empty sections when search is active", async () => {
    mockListTrackerItems.mockResolvedValueOnce([
      makeItem({ id: 1, key: "CA-1", title: "Workspace Rename" }),
    ]);
    render(<TrackerPage />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), {
      target: { value: "rename" },
    });
    await waitFor(() => expect(screen.queryByText("Done")).toBeNull());
    expect(screen.getByText("Backlog")).toBeTruthy();
  });

  it("resets collapsed sections when re-navigating to /tracker", async () => {
    const { rerender } = render(<TrackerPage />);
    await waitFor(() => screen.getByText("Done"));
    fireEvent.click(screen.getByTestId("toggle-section-Done"));
    expect(screen.queryByText("CA-2")).toBeNull();

    mockLocation.key = "tracker-2";
    rerender(<TrackerPage />);
    await waitFor(() => expect(screen.getByText("CA-2")).toBeTruthy());
  });

  it("opens create modal from global + and submits title-only defaults", async () => {
    render(<TrackerPage />);
    fireEvent.click(screen.getByRole("button", { name: /create tracker item/i }));
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: "Fix realtime" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() =>
      expect(mockCreateTrackerItem).toHaveBeenCalledWith(7, {
        title: "Fix realtime",
      }),
    );
  });

  it("submits picker values on create", async () => {
    render(<TrackerPage />);
    fireEvent.click(screen.getByRole("button", { name: /create tracker item/i }));
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "Full" } });
    fireEvent.click(screen.getByLabelText(/In Progress/i));
    fireEvent.click(screen.getByLabelText(/High/i));
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() =>
      expect(mockCreateTrackerItem).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          title: "Full",
          statusId: 2,
          priorityId: expect.any(Number),
        }),
      ),
    );
  });

  it("shows new vocab section on tracker.vocabulary.created SSE without refresh", async () => {
    let sseHandler: ((e: { type: string; payload?: unknown }) => void) | undefined;
  mockUseBoard.mockReturnValue({
    activeWorkspaceId: 7,
    subscribeTrackerEvents: (cb: (e: { type: string; payload?: unknown }) => void) => {
      sseHandler = cb;
      return () => {};
    },
  });
    render(<TrackerPage />);
    await waitFor(() => screen.getByText("Backlog"));
    sseHandler?.({
      type: "tracker.vocabulary.created",
      payload: {
        id: 99,
        kind: "status",
        name: "Blocked",
        position: 2000,
        colour: "oklch(0.7 0.1 180)",
      },
    });
    await waitFor(() => expect(screen.getByText("Blocked")).toBeTruthy());
  });

  it("includes Tracker nav between Board and Inbox", () => {
    const paths = KANBAN_NAV.map((i) => i.to);
    expect(paths).toEqual(["/board", "/tracker", "/inbox", "/dashboard"]);
  });
});
```

2. Run test — verify FAIL: `npm run test -- client/src/pages/TrackerPage.test.tsx`
3. Implement pages and components; add `subscribeTrackerEvents` to BoardContext (SSE dispatch registry); add // TODO: due date preference on date column.
4. Run test — verify PASS: `npm run test -- client/src/pages/TrackerPage.test.tsx`
5. Refactor while green (bounded): extract shared row cell helpers if duplicated.
6. Commit: `feat(tracker): add Tracker list page and create modal`

## DELIVERABLE
Given items in multiple statuses, When /tracker loaded, Then grouped oldest-first within section, sections ordered by vocab position, all expanded.
Given custom status "Blocked" added between Todo and In Progress, When list rendered, Then section order reflects vocab position.
Given search active, When section has no matches, Then hidden.
Given user collapses Done then navigates to /board and returns to /tracker, Then all sections expanded again.
Given global + clicked, When member submits title only, Then item created with Backlog status and null priority.
Given create modal with pickers set, When submitted, Then item saved with selected status/priority/labels/assignees.
Given member B on /tracker, When member A adds status via API, Then B sees new section without refresh.
Given sidebar nav, When member views KANBAN_NAV, Then Tracker appears between Board and Inbox at /tracker.

## QUALITY BAR
Must-not-have: Filter UI, URL state, localStorage collapse persistence

## STOP CONDITIONS
Done when: TrackerPage tests pass, nav shows Tracker between Board and Inbox

---

### Task 8: Tracker detail page, changelog, realtime client [depends: T7]

## OBJECTIVE
/tracker/:key detail page with edit form, per-item changelog, stale prefix redirect, 409 UX mirroring cards, SSE live updates.

Files:
- Create: `client/src/pages/TrackerDetailPage.tsx`
- Create: `client/src/components/tracker/TrackerChangelog.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/context/BoardContext.tsx` (handle tracker SSE events)
- Test: `client/src/pages/TrackerDetailPage.test.tsx`

Steps:
1. Write failing tests:

```typescript
// @vitest-environment jsdom
// client/src/pages/TrackerDetailPage.test.tsx
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetTrackerItem,
  mockUpdateTrackerItem,
  mockGetTrackerChangelog,
  mockNavigate,
  mockUseBoard,
  mockShowToast,
} = vi.hoisted(() => ({
  mockGetTrackerItem: vi.fn(),
  mockUpdateTrackerItem: vi.fn(),
  mockGetTrackerChangelog: vi.fn(),
  mockNavigate: vi.fn(),
  mockUseBoard: vi.fn(),
  mockShowToast: vi.fn(),
}));

vi.mock("../api", () => ({
  api: {
    getTrackerItem: (...a: unknown[]) => mockGetTrackerItem(...a),
    updateTrackerItem: (...a: unknown[]) => mockUpdateTrackerItem(...a),
    getTrackerChangelog: (...a: unknown[]) => mockGetTrackerChangelog(...a),
  },
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock("../context/BoardContext", () => ({
  useBoard: () => mockUseBoard(),
}));

vi.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ key: "CA-42" }),
}));

import { ApiError } from "../api";
import TrackerDetailPage from "./TrackerDetailPage";

const item = {
  id: 42,
  key: "CK-42",
  title: "Workspace Rename",
  description: "details",
  status: { id: 1, kind: "status", name: "Backlog", position: 1000, colour: "oklch(0.7 0.1 200)" },
  priority: null,
  labels: [],
  assignees: [],
  version: 1,
  createdAt: "2026-07-04T00:00:00Z",
};

beforeEach(() => {
  mockGetTrackerItem.mockResolvedValue(item);
  mockGetTrackerChangelog.mockResolvedValue([
    {
      id: 1,
      eventType: "tracker_item_created",
      actor: { id: 1, displayName: "Alice" },
      payload: { title: "Workspace Rename" },
      createdAt: "2026-07-04T00:00:00Z",
    },
    {
      id: 2,
      eventType: "tracker_item_updated",
      actor: { id: 1, displayName: "Alice" },
      payload: { field: "status", from: "Backlog", to: "In Progress" },
      createdAt: "2026-07-05T00:00:00Z",
    },
  ]);
  mockUpdateTrackerItem.mockResolvedValue({ ...item, version: 2 });
  mockUseBoard.mockReturnValue({
    activeWorkspaceId: 7,
    showToast: mockShowToast,
    refreshTrackerList: vi.fn(),
    onTrackerEvent: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TrackerDetailPage", () => {
  it("loads item by key and renders changelog", async () => {
    render(<TrackerDetailPage />);
    await waitFor(() => expect(screen.getByDisplayValue("Workspace Rename")).toBeTruthy());
    expect(screen.getByText(/tracker_item_created/i)).toBeTruthy();
    expect(screen.getByText(/In Progress/i)).toBeTruthy();
    expect(mockGetTrackerItem).toHaveBeenCalledWith(7, "CA-42");
  });

  it("redirects to canonical key when API returns stale prefix", async () => {
    mockGetTrackerItem.mockResolvedValueOnce({
      ...item,
      key: "CK-42",
      canonicalKey: "CK-42",
      redirectFrom: "CA-42",
    });
    render(<TrackerDetailPage />);
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/tracker/CK-42", { replace: true }),
    );
  });

  it("shows conflict toast on 409 save mirroring cards", async () => {
    mockUpdateTrackerItem.mockRejectedValueOnce(
      new ApiError("conflict", 409, "version_conflict"),
    );
    render(<TrackerDetailPage />);
    await waitFor(() => screen.getByDisplayValue("Workspace Rename"));
    fireEvent.change(screen.getByDisplayValue("Workspace Rename"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        "Someone else updated this tracker item first — refreshed.",
        "warning",
      ),
    );
  });

  it("applies tracker.updated SSE to live detail fields", async () => {
    let sseHandler: ((e: { type: string; payload?: unknown }) => void) | undefined;
    mockUseBoard.mockReturnValue({
      activeWorkspaceId: 7,
      showToast: mockShowToast,
      refreshTrackerList: vi.fn(),
      onTrackerEvent: (cb: typeof sseHandler) => {
        sseHandler = cb;
      },
    });
    render(<TrackerDetailPage />);
    await waitFor(() => screen.getByDisplayValue("Workspace Rename"));
    sseHandler?.({
      type: "tracker.updated",
      payload: { key: "CK-42", title: "Live title", version: 3 },
    });
    await waitFor(() => expect(screen.getByDisplayValue("Live title")).toBeTruthy());
  });

  it("removes item from list context on tracker.deleted SSE", async () => {
    const refreshTrackerList = vi.fn();
    let sseHandler: ((e: { type: string; payload?: unknown }) => void) | undefined;
    mockUseBoard.mockReturnValue({
      activeWorkspaceId: 7,
      showToast: mockShowToast,
      refreshTrackerList,
      onTrackerEvent: (cb: typeof sseHandler) => {
        sseHandler = cb;
      },
    });
    render(<TrackerDetailPage />);
    await waitFor(() => screen.getByDisplayValue("Workspace Rename"));
    sseHandler?.({ type: "tracker.deleted", payload: { key: "CK-42" } });
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/tracker", { replace: true }),
    );
    expect(refreshTrackerList).toHaveBeenCalled();
  });
});
```

2. Run test — verify FAIL: `npm run test -- client/src/pages/TrackerDetailPage.test.tsx`
3. Implement detail page; wire BoardContext to dispatch tracker SSE events to `subscribeTrackerEvents` subscribers.
4. Run test — verify PASS: `npm run test -- client/src/pages/TrackerDetailPage.test.tsx`
5. Refactor while green (bounded): none expected — skip if nothing to extract.
6. Commit: `feat(tracker): add detail page, changelog, and realtime updates`

## DELIVERABLE
Given item with history, When detail opened, Then changelog visible.
Given stale prefix URL, When navigated, Then redirect to canonical.
Given 409 on save, Then conflict UX mirrors cards.
Given member B on /tracker, When member A changes item status, Then B's list updates without refresh.
Given member B's list shows CA-42, When member A soft-deletes CA-42, Then row disappears from B's list without refresh.

## STOP CONDITIONS
Done when: detail tests pass, full npm run test green
