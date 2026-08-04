# Tracker Entity — Tracker DB schema and vocabulary seed (Phase 1 of 3)

**Date:** 2026-08-03
**Original plan:** /Users/rfxlamia/project/camel/docs/pocket/plans/2026-08-03-tracker-entity/execution-plan.md
**Prerequisite:** None (first phase)
**Contains tasks:** {T1, T2, T3}
**Unlocks next:** Phase 2

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

T1: Tracker DB schema and vocabulary seed [prereq]
T2: recordTrackerActivity helper [depends: T1]
T3: Tracker vocabulary and key utilities API [depends: T1, T2]

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

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 2 ONLY after this gate passes.
