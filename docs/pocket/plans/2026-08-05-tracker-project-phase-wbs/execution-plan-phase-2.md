# Tracker Project / Phase / WBS — Item read path — project and phase ids plus status category on payloads (Phase 2 of 4)

**Date:** 2026-08-05
**Original plan:** docs/pocket/plans/2026-08-05-tracker-project-phase-wbs/execution-plan.md
**Prerequisite:** Phase 1 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T6, T9, T7, T10, T8, T11}
**Unlocks next:** Phase 3

---

## Task List

Total: 6 tasks | Prerequisite phases must be complete before starting

T6: Item read path — project and phase ids plus status category on payloads [depends: T5]
T9: Project routes — CRUD, cap, and delete-with-release [depends: T5] [parallel: T6]
T7: Item write path — create and update with assignment, dates, completed_at and version semantics [depends: T6]
T10: Phase routes — CRUD and delete-to-no-phase [depends: T9]
T8: Reorder endpoint — bucket positions without version bumps [depends: T7]
T11: Client contracts — types and API surface [depends: T4, T6, T9, T10]

---

## Pocket Packets

---

### Task 6: Item read path — project and phase ids plus status category on payloads [depends: T5]

## OBJECTIVE

Make every serialized tracker item carry `projectId`, `phaseId`, `startDate`, `endDate`,
`completedAt`, `position`, and make its embedded status carry `category`, so the client can
derive everything Option B requires.

Files:
- Modify: `server/src/routes/tracker-items.ts`
- Test: `server/src/routes/tracker-items.serialize.test.ts`

Steps:

1. Write failing tests in `server/src/routes/tracker-items.serialize.test.ts` for:
   - `serializeItem` output includes `projectId`, `phaseId`, `startDate`, `endDate`,
     `completedAt`, `position`
   - the embedded `status` object includes `category`
   - an embedded `priority` and each `label` serialize without a `category` key requirement
     (only statuses carry semantics)
   - a row with null project and phase serializes them as `null`, not omitted

   ```typescript
   // server/src/routes/tracker-items.serialize.test.ts
   import express from "express";
   import request from "supertest";
   import { beforeEach, describe, expect, it, vi } from "vitest";

   // Generic chainable kysely query-builder stub: every chain method returns
   // itself, and the terminal method resolves with `result` (wrapped/unwrapped
   // to match whether the caller used execute() or executeTakeFirst()).
   function chain(result: unknown) {
     const builder: any = {};
     for (const m of ["innerJoin", "leftJoin", "select", "where", "orderBy", "$if"]) {
       builder[m] = vi.fn(() => builder);
     }
     const isArray = Array.isArray(result);
     builder.execute = vi.fn().mockResolvedValue(isArray ? result : [result]);
     builder.executeTakeFirst = vi
       .fn()
       .mockResolvedValue(isArray ? result[0] : result);
     builder.executeTakeFirstOrThrow = builder.executeTakeFirst;
     return builder;
   }

   const mockSelectFrom = vi.fn();
   vi.mock("../db/kysely.js", () => ({
     db: { selectFrom: (...args: unknown[]) => mockSelectFrom(...args) },
   }));
   vi.mock("../middleware/workspace.js", () => ({
     requireWorkspaceMember: (req: any, _res: any, next: any) => {
       req.workspace = { workspaceId: 7, role: "member" };
       next();
     },
   }));
   vi.mock("./tracker-assignees.js", () => ({
     loadTrackerAssigneesForItems: vi.fn().mockResolvedValue(new Map()),
     syncTrackerItemAssignees: vi.fn(),
   }));
   vi.mock("../realtime.js", () => ({ publishEvent: vi.fn() }));
   vi.mock("./tracker-activity.js", () => ({ recordTrackerActivity: vi.fn() }));

   import { trackerItemsRouter } from "./tracker-items.js";

   const app = express();
   app.use(express.json());
   app.use((req, _res, next) => {
     (req as any).user = { id: 1, displayName: "Bob" };
     next();
   });
   app.use("/workspaces/:workspaceId", trackerItemsRouter);

   const baseRow = {
     id: 1,
     key_number: 42,
     title: "Ship WBS",
     description: "",
     version: 1,
     created_at: new Date("2026-08-01T00:00:00Z"),
     updated_at: new Date("2026-08-01T00:00:00Z"),
     status_id: 3,
     status_name: "In Progress",
     status_kind: "status",
     status_position: 2000,
     status_colour: "oklch(0.7 0.1 150)",
     status_category: "started",
     priority_id: null,
     priority_name: null,
     priority_kind: null,
     priority_position: null,
     priority_colour: null,
     project_id: 5,
     phase_id: 9,
     start_date: "2026-09-01",
     end_date: "2026-09-30",
     completed_at: null,
     position: 1024,
   };

   describe("GET /tracker/items — serialization", () => {
     beforeEach(() => mockSelectFrom.mockReset());

     it("carries projectId, phaseId, dates, position and status.category", async () => {
       mockSelectFrom
         .mockReturnValueOnce(chain({ name: "Camel Team" })) // workspace prefix lookup
         .mockReturnValueOnce(chain([baseRow])) // item rows
         .mockReturnValueOnce(chain([])); // labels

       const res = await request(app).get("/workspaces/7/tracker/items");
       expect(res.status).toBe(200);
       const [item] = res.body;
       expect(item.projectId).toBe(5);
       expect(item.phaseId).toBe(9);
       expect(item.startDate).toBe("2026-09-01");
       expect(item.endDate).toBe("2026-09-30");
       expect(item.completedAt).toBeNull();
       expect(item.position).toBe(1024);
       expect(item.status.category).toBe("started");
     });

     it("serializes a null project and phase as null, not omitted", async () => {
       const unassigned = { ...baseRow, project_id: null, phase_id: null };
       mockSelectFrom
         .mockReturnValueOnce(chain({ name: "Camel Team" }))
         .mockReturnValueOnce(chain([unassigned]))
         .mockReturnValueOnce(chain([]));

       const res = await request(app).get("/workspaces/7/tracker/items");
       const [item] = res.body;
       expect(item).toHaveProperty("projectId", null);
       expect(item).toHaveProperty("phaseId", null);
     });

     it("never embeds a project/phase name or a rollup/progress/overdue field", async () => {
       mockSelectFrom
         .mockReturnValueOnce(chain({ name: "Camel Team" }))
         .mockReturnValueOnce(chain([baseRow]))
         .mockReturnValueOnce(chain([]));

       const res = await request(app).get("/workspaces/7/tracker/items");
       const [item] = res.body;
       expect(item).not.toHaveProperty("projectName");
       expect(item).not.toHaveProperty("phaseName");
       expect(item).not.toHaveProperty("progress");
       expect(item).not.toHaveProperty("rollup");
       expect(item).not.toHaveProperty("overdue");
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- server/src/routes/tracker-items.serialize.test.ts`
   Expected failure: serialized object is missing `projectId` and `status.category`

3. Implement in `server/src/routes/tracker-items.ts`:
   - Extend the row type and `selectItemRows` (:110-135) to select the new item columns and
     the status `category`
   - Extend `serializeVocab` (:54-65) to carry `category`
   - Extend `serializeItem` (:75-102) to emit the new fields
   - Do NOT change any write path in this task

4. Run test — verify PASS:
   `npm run test -- server/src/routes/tracker-items.serialize.test.ts`
   Then: `npm run test` and `npm run typecheck`
   Expected: PASS

5. Refactor while green (bounded):
   - If the row type and the select column list now duplicate the same field names a third
     time, derive one from the other rather than maintaining three lists
   - Re-run: `npm run test -- server/src/routes/tracker-items.serialize.test.ts` — must stay PASS

6. Commit:
   `git add server/src/routes/tracker-items.ts server/src/routes/tracker-items.serialize.test.ts`
   `git commit -m "feat(tracker): carry project, phase, schedule and category on item payloads"`

## REFERENCES LOADED

docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md —
rules: Home and project page, Status semantics; the four-serialization-site note
server/src/routes/tracker-items.ts:54-65,75-102,110-135 — `serializeVocab`, `serializeItem`,
`selectItemRows`, the three sites this task touches
server/src/routes/tracker-items.ts:321-352 — the list route returns every workspace item with
no pagination; Option B depends on that staying true

## WHY THIS APPROACH

Justification: one route file, but three coupled serialization sites where a partial edit
ships a payload the client silently cannot use.
Complexity: standard

## SANDWICH CONTEXT

[CRITICAL: item payloads carry RAW foreign keys only — never embed project or phase names; the client joins them from the projects payload.]
You are implementing the item read contract for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — the client receives all items and derives rollup, so the payload must carry facts, never computed progress.
Files in scope: `server/src/routes/tracker-items.ts` and the new serialize test — no other files.
Test framework: Vitest, tests beside source, `vi.mock` at top level.
Available after: T5 (parsers extracted from this same file — do not work on it concurrently)
Architecture rule: `GET /tracker/items` keeps returning every non-deleted workspace item with no scope param and no pagination. No aggregate or rollup field may appear on any payload.
[RESTATE: item payloads carry RAW foreign keys only — never embed project or phase names; the client joins them from the projects payload.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given `GET /tracker/items`, When it responds, Then each item carries `projectId` and `phaseId`
Given any item payload, When it is serialized, Then its embedded status carries `category`
Given an item with no project, When serialized, Then `projectId` and `phaseId` are `null`
Given an item with dates, When serialized, Then `startDate` and `endDate` are `YYYY-MM-DD` strings
[must-not] Given any item payload, When serialized, Then no project or phase NAME is embedded
[must-not] Given any item payload, When serialized, Then no rollup, progress or overdue field appears

All tests PASS. Commit exists with message matching `feat(tracker): …`.

## QUALITY BAR

Must-have:
  - All three serialization sites in this file updated consistently
  - Dates serialized as calendar strings, not timestamps
  - Tests written BEFORE implementation

Must-not-have:
  - Embedded project/phase names
  - Server-computed rollup, progress or overdue
  - A scope parameter or pagination on the list route
  - Any write-path change in this task
  - Modifications to files outside the listed scope

Open question risks:
  - none

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Any aggregate field added to a payload → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: the existing row typing makes the new columns awkward to select
Escalate when: satisfying the client would appear to require embedding names or aggregates

---

### Task 9: Project routes — CRUD, cap, and delete-with-release [depends: T5] [parallel: T6]

## OBJECTIVE

Add the project resource: create with a cap of 10, rename under optimistic locking, and
delete by soft-deleting the project and its phases while releasing its tasks.

Files:
- Create: `server/src/routes/tracker-projects.ts`
- Test: `server/src/routes/tracker-projects.test.ts`
- Modify: `server/src/routes.ts`

Steps:

1. Write failing tests in `server/src/routes/tracker-projects.test.ts` for:
   - `POST` with a valid name returns 201 with the serialized project
   - `POST` with a whitespace-only name returns 400
   - `POST` when 10 non-deleted projects exist returns 409 naming the cap
   - two concurrent creates at 9 projects yield exactly one success and one 409 (assert the
     workspace row lock is taken before the count, so the check cannot interleave)
   - `PATCH` renames with the current version and returns 200
   - `PATCH` with a stale version returns 409
   - `DELETE` soft-deletes the project, soft-deletes its phases, and nulls `project_id` and
     `phase_id` on all its tasks
   - `DELETE` writes exactly one `tracker_events` row whose payload carries the released
     `(itemId, projectId, phaseId)` triples
   - `DELETE` publishes exactly one SSE event
   - released tasks have unchanged `version` and unchanged `updated_at`
   - `GET` returns projects with their phases nested, excluding soft-deleted rows
   - a name reused after a soft delete is accepted

   ```typescript
   // server/src/routes/tracker-projects.test.ts
   //
   // The create-cap race is simulated with a promise-chain "row lock": each
   // transaction awaits the previous one before its callback runs, mirroring
   // what `SELECT ... FOR UPDATE` guarantees against real Postgres. This
   // proves the handler takes the lock before it counts, not that Postgres
   // itself locks correctly — that guarantee is Postgres's, not this test's.
   import express from "express";
   import request from "supertest";
   import { beforeEach, describe, expect, it, vi } from "vitest";

   function chainable(result: unknown) {
     const b: any = {};
     for (const m of ["where", "returning", "orderBy", "select", "$if", "forUpdate"]) {
       b[m] = vi.fn(() => b);
     }
     const isArray = Array.isArray(result);
     b.execute = vi.fn().mockResolvedValue(isArray ? result : [result]);
     b.executeTakeFirst = vi.fn().mockResolvedValue(isArray ? result[0] : result);
     b.executeTakeFirstOrThrow = b.executeTakeFirst;
     return b;
   }

   const insertedValues: Array<{ table: string; values: any }> = [];
   const updatedSets: Array<{ table: string; values: any }> = [];
   const callLog: string[] = [];

   let sharedProjectCount = 0;
   let phaseRows: any[] = [];
   let itemRows: any[] = [];
   let lockChain: Promise<unknown> = Promise.resolve();

   function withLock<T>(fn: () => Promise<T>): Promise<T> {
     const run = lockChain.then(fn, fn);
     lockChain = run.then(
       () => undefined,
       () => undefined,
     );
     return run;
   }

   function makeTrx() {
     const trx: any = {};
     trx.selectFrom = vi.fn((table: string) => {
       if (table === "workspaces") {
         const b = chainable({ id: 7 });
         b.forUpdate = vi.fn(() => {
           callLog.push("lock");
           return b;
         });
         return b;
       }
       if (table === "tracker_projects") {
         const b = chainable({ n: sharedProjectCount });
         b.executeTakeFirst = vi.fn(async () => {
           callLog.push("count");
           return { n: sharedProjectCount };
         });
         b.executeTakeFirstOrThrow = b.executeTakeFirst;
         return b;
       }
       if (table === "tracker_phases") return chainable(phaseRows);
       if (table === "tracker_items") return chainable(itemRows);
       return chainable([]);
     });
     trx.insertInto = vi.fn((table: string) => ({
       values: vi.fn((values: unknown) => {
         insertedValues.push({ table, values });
         if (table === "tracker_projects") sharedProjectCount += 1;
         return chainable({ id: 42, phases: [], ...(values as object) });
       }),
     }));
     trx.updateTable = vi.fn((table: string) => ({
       set: vi.fn((values: unknown) => {
         updatedSets.push({ table, values });
         return chainable(table === "tracker_items" ? itemRows : undefined);
       }),
     }));
     return trx;
   }

   const mockSelectFrom = vi.fn();
   const mockUpdateTable = vi.fn();
   const mockTransaction = vi.fn();

   vi.mock("../db/kysely.js", () => ({
     db: {
       selectFrom: (...args: unknown[]) => mockSelectFrom(...args),
       updateTable: (...args: unknown[]) => mockUpdateTable(...args),
       transaction: (...args: unknown[]) => mockTransaction(...args),
     },
   }));
   vi.mock("../middleware/workspace.js", () => ({
     requireWorkspaceMember: (req: any, _res: any, next: any) => {
       req.workspace = { workspaceId: 7, role: "member" };
       next();
     },
   }));
   vi.mock("../realtime.js", () => ({ publishEvent: vi.fn() }));
   vi.mock("./tracker-activity.js", () => ({ recordTrackerActivity: vi.fn() }));

   import { publishEvent } from "../realtime.js";
   import { recordTrackerActivity } from "./tracker-activity.js";
   import { trackerProjectsRouter } from "./tracker-projects.js";

   const app = express();
   app.use(express.json());
   app.use((req, _res, next) => {
     (req as any).user = { id: 1, displayName: "Bob" };
     next();
   });
   app.use("/workspaces/:workspaceId", trackerProjectsRouter);

   function useTransactionalTrx() {
     mockTransaction.mockImplementation(() => ({
       execute: (cb: (trx: unknown) => unknown) => withLock(() => cb(makeTrx())),
     }));
   }

   beforeEach(() => {
     insertedValues.length = 0;
     updatedSets.length = 0;
     callLog.length = 0;
     lockChain = Promise.resolve();
     sharedProjectCount = 0;
     phaseRows = [];
     itemRows = [];
     mockSelectFrom.mockReset();
     mockUpdateTable.mockReset();
     mockTransaction.mockReset();
     vi.mocked(publishEvent).mockReset();
     vi.mocked(recordTrackerActivity).mockReset();
   });

   describe("POST /tracker/projects", () => {
     it("creates a project and returns 201 with the serialized project", async () => {
       sharedProjectCount = 2;
       useTransactionalTrx();
       const res = await request(app)
         .post("/workspaces/7/tracker/projects")
         .send({ name: "Rilis v2" });
       expect(res.status).toBe(201);
       expect(res.body.name).toBe("Rilis v2");
       expect(res.body.phases).toEqual([]);
     });

     it("rejects a whitespace-only name with 400 and opens no transaction", async () => {
       const res = await request(app)
         .post("/workspaces/7/tracker/projects")
         .send({ name: "   " });
       expect(res.status).toBe(400);
       expect(mockTransaction).not.toHaveBeenCalled();
     });

     it("returns 409 naming the cap when 10 non-deleted projects exist", async () => {
       sharedProjectCount = 10;
       useTransactionalTrx();
       const res = await request(app)
         .post("/workspaces/7/tracker/projects")
         .send({ name: "One too many" });
       expect(res.status).toBe(409);
       expect(res.body.error).toMatch(/10/);
       expect(insertedValues).toHaveLength(0);
     });

     it("serializes two concurrent creates at 9 projects into one success and one 409, lock taken before count", async () => {
       sharedProjectCount = 9;
       useTransactionalTrx();
       const [first, second] = await Promise.all([
         request(app).post("/workspaces/7/tracker/projects").send({ name: "A" }),
         request(app).post("/workspaces/7/tracker/projects").send({ name: "B" }),
       ]);
       const statuses = [first.status, second.status].sort();
       expect(statuses).toEqual([201, 409]);

       const lockIdx = callLog.flatMap((e, i) => (e === "lock" ? [i] : []));
       const countIdx = callLog.flatMap((e, i) => (e === "count" ? [i] : []));
       expect(lockIdx).toHaveLength(2);
       expect(countIdx).toHaveLength(2);
       expect(lockIdx[0]).toBeLessThan(countIdx[0]);
       expect(lockIdx[1]).toBeLessThan(countIdx[1]);
     });

     it("accepts a name reused from a soft-deleted project", async () => {
       sharedProjectCount = 3;
       useTransactionalTrx();
       const res = await request(app)
         .post("/workspaces/7/tracker/projects")
         .send({ name: "Rilis v2" });
       expect(res.status).toBe(201);
     });
   });

   describe("PATCH /tracker/projects/:id", () => {
     it("renames the project when the version matches", async () => {
       mockUpdateTable.mockImplementation((table: string) => ({
         set: vi.fn((values: unknown) => {
           updatedSets.push({ table, values });
           return chainable({ id: 3, name: "Rilis v3", version: 2, phases: [] });
         }),
       }));
       const res = await request(app)
         .patch("/workspaces/7/tracker/projects/3")
         .send({ name: "Rilis v3", version: 1 });
       expect(res.status).toBe(200);
       expect(res.body.name).toBe("Rilis v3");
     });

     it("returns 409 for a stale version on rename", async () => {
       mockUpdateTable.mockImplementation((table: string) => ({
         set: vi.fn((values: unknown) => {
           updatedSets.push({ table, values });
           return chainable(undefined); // no row matched the given version
         }),
       }));
       mockSelectFrom.mockImplementation((table: string) =>
         table === "tracker_projects"
           ? chainable({ id: 3, version: 5 })
           : chainable([]),
       );
       const res = await request(app)
         .patch("/workspaces/7/tracker/projects/3")
         .send({ name: "Rilis v3", version: 1 });
       expect(res.status).toBe(409);
     });
   });

   describe("DELETE /tracker/projects/:id", () => {
     const releasedItems = [
       { id: 101, project_id: 3, phase_id: 9, version: 4, updated_at: "2026-08-01T00:00:00Z" },
       { id: 102, project_id: 3, phase_id: 10, version: 2, updated_at: "2026-08-01T00:00:00Z" },
     ];

     beforeEach(() => {
       itemRows = releasedItems;
       phaseRows = [{ id: 9 }, { id: 10 }];
       useTransactionalTrx();
     });

     it("soft-deletes the project and its phases and nulls project_id/phase_id on its tasks", async () => {
       const res = await request(app).delete("/workspaces/7/tracker/projects/3").send({});
       expect(res.status).toBe(204);
       expect(updatedSets.find((u) => u.table === "tracker_projects")?.values.deleted_at).toBeTruthy();
       expect(updatedSets.find((u) => u.table === "tracker_phases")?.values.deleted_at).toBeTruthy();
       const itemRelease = updatedSets.find((u) => u.table === "tracker_items");
       expect(itemRelease?.values.project_id).toBeNull();
       expect(itemRelease?.values.phase_id).toBeNull();
     });

     it("writes exactly one tracker_events row carrying the released (itemId, projectId, phaseId) triples", async () => {
       await request(app).delete("/workspaces/7/tracker/projects/3").send({});
       expect(recordTrackerActivity).toHaveBeenCalledTimes(1);
       const [, , , , opts] = vi.mocked(recordTrackerActivity).mock.calls[0] as any[];
       expect(opts.payload.released).toEqual(
         expect.arrayContaining([
           expect.objectContaining({ itemId: 101, projectId: 3, phaseId: 9 }),
           expect.objectContaining({ itemId: 102, projectId: 3, phaseId: 10 }),
         ]),
       );
     });

     it("publishes exactly one SSE event", async () => {
       await request(app).delete("/workspaces/7/tracker/projects/3").send({});
       expect(publishEvent).toHaveBeenCalledTimes(1);
     });

     it("leaves version and updated_at unchanged on released tasks", async () => {
       await request(app).delete("/workspaces/7/tracker/projects/3").send({});
       const itemRelease = updatedSets.find((u) => u.table === "tracker_items");
       expect(itemRelease?.values).not.toHaveProperty("version");
       expect(itemRelease?.values).not.toHaveProperty("updated_at");
     });
   });

   describe("GET /tracker/projects", () => {
     it("returns projects with phases nested by position, excluding soft-deleted rows", async () => {
       mockSelectFrom.mockImplementation((table: string) => {
         if (table === "tracker_projects") {
           return chainable([{ id: 1, name: "Rilis v2", position: 1024, version: 1 }]);
         }
         if (table === "tracker_phases") {
           return chainable([{ id: 9, project_id: 1, name: "Persiapan", position: 1024 }]);
         }
         return chainable([]);
       });
       const res = await request(app).get("/workspaces/7/tracker/projects");
       expect(res.status).toBe(200);
       expect(res.body).toHaveLength(1);
       expect(res.body[0].phases).toEqual([
         expect.objectContaining({ id: 9, name: "Persiapan" }),
       ]);
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- server/src/routes/tracker-projects.test.ts`
   Expected failure: `Cannot find module './tracker-projects.js'`

3. Implement:
   - `server/src/routes/tracker-projects.ts` exporting `trackerProjectsRouter`, every route
     behind `requireWorkspaceMember`, following the structure of `tracker-vocabularies.ts`
   - Cap: return **409** with a message naming the limit, mirroring `getWorkspaceCapacity`
     in `server/src/routes/helpers.ts:8-22`. Define `TRACKER_PROJECT_LIMIT = 10` and a
     message constant beside it.
     The count-then-insert must be **atomic**: run it inside the create transaction and take
     a row lock on the owning workspace first
     (`SELECT id FROM workspaces WHERE id = $1 FOR UPDATE`) before counting non-deleted
     projects. Without that lock two concurrent creates both read 9 and both succeed, which
     is exactly the race the acceptance criterion names
   - `GET` returns projects with phases nested (phases ordered by `position`), both filtered
     `deleted_at IS NULL`
   - `POST` assigns an end-of-list `position` via `positionBetween`
   - `DELETE` runs in one transaction: soft-delete project, soft-delete its phases, null
     `project_id`/`phase_id` on its items WITHOUT touching `version` or `updated_at`, write
     ONE `recordTrackerActivity()` row whose payload holds the released triples, publish ONE
     SSE event
   - Mount in `server/src/routes.ts` beside the existing tracker routers (:59-60)

4. Run test — verify PASS:
   `npm run test -- server/src/routes/tracker-projects.test.ts`
   Then: `npm run test` and `npm run typecheck`
   Expected: PASS

5. Refactor while green (bounded):
   - If serialization, cap checking and soft-delete filtering each appear inline more than
     twice, extract named helpers within this module
   - If the file passes ~300 lines, split the delete transaction into its own module
   - Re-run: `npm run test -- server/src/routes/tracker-projects.test.ts` — must stay PASS

6. Commit:
   `git add server/src/routes/tracker-projects.ts server/src/routes/tracker-projects.test.ts server/src/routes.ts`
   `git commit -m "feat(tracker): add project routes with cap and delete-with-release"`

## REFERENCES LOADED

docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md —
rule: Project lifecycle; the Rollback Plan's carve-out that project deletion is not
reversible by deploy revert, which is why the event payload carries the triples
server/src/routes/helpers.ts:8-22 — `getWorkspaceCapacity` returns **409**, not 400
server/src/routes/tracker-vocabularies.ts — router structure, `requireWorkspaceMember`,
`recordTrackerActivity`, `publishEvent` usage
server/src/core/position.ts — end-of-list position assignment

## WHY THIS APPROACH

Justification: a new resource with a multi-table transactional delete whose payload is the
only reconstruction path for destroyed structure.
Complexity: standard

## SANDWICH CONTEXT

[CRITICAL: deleting a project HARD-NULLS `project_id`/`phase_id` on its tasks — this is the one irreversible operation in the cycle, so the single activity event's payload MUST carry the released (itemId, projectId, phaseId) triples.]
You are implementing project routes for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — return projects with phases nested; never return computed rollup.
Files in scope: `server/src/routes/tracker-projects.ts`, its test, `server/src/routes.ts` — no other files.
Test framework: Vitest, `vi.mock` at top level, tests beside source.
Available after: T5 (shared parsers)
Architecture rule: cap violations return 409 mirroring `getWorkspaceCapacity`; every mutation calls `recordTrackerActivity()`; released tasks keep their `version` and `updated_at` untouched; nothing may touch `workspaces.tracker_key_counter`.
[RESTATE: deleting a project HARD-NULLS `project_id`/`phase_id` on its tasks — this is the one irreversible operation in the cycle, so the single activity event's payload MUST carry the released (itemId, projectId, phaseId) triples.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given workspace W has 2 projects, When a member creates "Rilis v2", Then 201 and it is returned with 0 phases
Given project P, When renamed with the current version, Then 200
Given project P with 4 phases and 18 tasks, When deleted, Then P and its phases are soft-deleted and all 18 tasks have `project_id` and `phase_id` NULL
Given project P with 18 tasks, When deleted, Then exactly one `tracker_events` row and one SSE event are produced, and that row's payload records the released triples
Given released tasks, When the delete completes, Then neither `version` nor `updated_at` changed on them
Given a soft-deleted project named "Rilis v2", When a new project takes that name, Then it succeeds
Given workspace W holds 9 projects, When two members submit a create simultaneously, Then exactly one succeeds and the other receives the 409 cap error
Given `GET /tracker/projects`, When it responds, Then soft-deleted projects and phases are excluded and phases are ordered by position
[must-not] Given a blank project name, When create is attempted, Then 400
[must-not] Given 10 non-deleted projects, When an 11th is attempted, Then 409 naming the cap
[must-not] Given a stale version, When rename is attempted, Then 409
[must-not] Given any project payload, When serialized, Then no rollup or progress field appears

All tests PASS. Commit exists with message matching `feat(tracker): …`.

## QUALITY BAR

Must-have:
  - Cap returns 409, mirroring the workspace cap precedent
  - Delete is one transaction covering project, phases and item release
  - Exactly one activity row and one SSE event per delete
  - Released triples recorded in the event payload
  - Tests written BEFORE implementation

Must-not-have:
  - 400 for the cap (the workspace precedent is 409)
  - Cascading hard deletes of tasks
  - Per-item activity rows or per-item SSE events on delete
  - Server-computed rollup on the project payload
  - Modifications to files outside the listed scope

Open question risks:
  - Project date columns ship unused; if a reviewer expects them on the payload, they may be
    serialized but no surface reads them → report DONE_WITH_CONCERNS rather than building UI

Rollback note:
  - Project deletion is NOT reversible by deploy revert. The event payload is the only
    reconstruction path — if it cannot be written, do not perform the delete.

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Tasks hard-deleted or their keys invalidated → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: the released-triples payload grows large enough to worry about JSONB size for a big project
Escalate when: the delete cannot be made atomic across the three tables

---

### Task 7: Item write path — create and update with assignment, dates, completed_at and version semantics [depends: T6]

## OBJECTIVE

Wire the new validators into BOTH the create handler and the PATCH handler so tasks can be
created and assigned with a project, phase and schedule, positioned in their bucket, and
stamped on completion — with version bumping on assignment but not on reorder.

The create path is not optional: without it, every item created after the migration has a
NULL `position` (breaking the non-NULL invariant T1 establishes and the "new task lands at
the end of its phase" criterion), and the date fields T16 adds to the create modal would be
silently discarded while a fetch-mocked test still passed.

Files:
- Modify: `server/src/routes/tracker-items.ts`
- Test: `server/src/routes/tracker-items.write.test.ts`

Steps:

1. Write failing tests in `server/src/routes/tracker-items.write.test.ts` for:
   - POST with no project assigns a position at the end of the unassigned bucket, never NULL
   - POST with `projectId` and `phaseId` assigns a position at the end of that phase's bucket
   - POST with `startDate` and `endDate` persists both
   - POST with an inverted date range returns 400
   - POST with a cross-workspace or soft-deleted project/phase returns 400 and creates nothing
   - POST whose initial status category is `completed` stamps `completed_at`
   - PATCH with `phaseId` alone sets both `phase_id` and the derived `project_id`, and bumps `version`
   - PATCH with `projectId` alone nulls `phase_id` and bumps `version`
   - PATCH with `{projectId: null}` and no `phaseId` clears BOTH `project_id` and `phase_id`
   - PATCH with `{projectId: null, phaseId: X}` returns 400
   - PATCH with a cross-workspace or soft-deleted project/phase returns 400 and writes nothing
   - PATCH with an inverted date range returns 400
   - transition into a `completed` status sets `completed_at` via `COALESCE(completed_at, now())`
   - transition between two completed statuses leaves `completed_at` unchanged
   - transition out of completed clears `completed_at`
   - transition into a `canceled` status leaves `completed_at` NULL
   - PATCH bodies carrying `completedAt` or `position` ignore both fields
   - a bucket change assigns a fresh end-of-bucket `position`

   ```typescript
   // server/src/routes/tracker-items.write.test.ts
   //
   // parseProjectPhase/parseDateRange are unit-tested against real DB lookups
   // in tracker-item-parsers.test.ts (T5) — here they are mocked so this file
   // tests only what T7 adds: wiring, position/date/completed_at persistence,
   // and version semantics. The completed_at CASE expression's exact SQL
   // behaviour is covered by the gated integration suite this task's QUALITY
   // BAR requires running (RUN_INTEGRATION=1 tracker-items.integration.test.ts).
   import express from "express";
   import request from "supertest";
   import { beforeEach, describe, expect, it, vi } from "vitest";

   function chainable(result: unknown) {
     const b: any = {};
     for (const m of ["where", "returning", "orderBy", "select", "$if", "onConflict"]) {
       b[m] = vi.fn(() => b);
     }
     const isArray = Array.isArray(result);
     b.execute = vi.fn().mockResolvedValue(isArray ? result : [result]);
     b.executeTakeFirst = vi.fn().mockResolvedValue(isArray ? result[0] : result);
     b.executeTakeFirstOrThrow = b.executeTakeFirst;
     return b;
   }

   const insertedValues: any[] = [];
   const updatedSets: any[] = [];

   function makeTrx() {
     const trx: any = {};
     trx.updateTable = vi.fn(() => ({
       set: vi.fn((values: unknown) => {
         updatedSets.push(values);
         return chainable({ id: 1, title: "Ship WBS" });
       }),
     }));
     trx.insertInto = vi.fn(() => ({
       values: vi.fn((values: unknown) => {
         insertedValues.push(values);
         return chainable({ id: 1 });
       }),
       onConflict: vi.fn(() => chainable(undefined)),
     }));
     trx.selectFrom = vi.fn(() => chainable([]));
     return trx;
   }

   const mockSelectFrom = vi.fn();
   const mockTransaction = vi.fn();

   vi.mock("../db/kysely.js", () => ({
     db: {
       selectFrom: (...args: unknown[]) => mockSelectFrom(...args),
       transaction: (...args: unknown[]) => mockTransaction(...args),
     },
   }));
   vi.mock("../middleware/workspace.js", () => ({
     requireWorkspaceMember: (req: any, _res: any, next: any) => {
       req.workspace = { workspaceId: 7, role: "member" };
       next();
     },
   }));
   vi.mock("./tracker-assignees.js", () => ({
     loadTrackerAssigneesForItems: vi.fn().mockResolvedValue(new Map()),
     syncTrackerItemAssignees: vi.fn(),
   }));
   vi.mock("../realtime.js", () => ({ publishEvent: vi.fn() }));
   vi.mock("./tracker-activity.js", () => ({ recordTrackerActivity: vi.fn() }));

   const mockParseProjectPhase = vi.fn();
   const mockParseDateRange = vi.fn();
   vi.mock("./tracker-item-parsers.js", () => ({
     parseProjectPhase: (...args: unknown[]) => mockParseProjectPhase(...args),
     parseDateRange: (...args: unknown[]) => mockParseDateRange(...args),
     parseAssigneeIds: vi.fn().mockResolvedValue([]),
     parseLabelIds: vi.fn().mockResolvedValue([]),
   }));

   import { trackerItemsRouter } from "./tracker-items.js";

   const app = express();
   app.use(express.json());
   app.use((req, _res, next) => {
     (req as any).user = { id: 1, displayName: "Bob" };
     next();
   });
   app.use("/workspaces/:workspaceId", trackerItemsRouter);

   const existingItemRow = {
     id: 1,
     key_number: 42,
     title: "Ship WBS",
     description: "",
     version: 3,
     created_at: new Date("2026-08-01T00:00:00Z"),
     updated_at: new Date("2026-08-01T00:00:00Z"),
     status_id: 3,
     status_name: "In Progress",
     status_kind: "status",
     status_position: 2000,
     status_colour: "oklch(0.7 0.1 150)",
     priority_id: null,
     priority_name: null,
     priority_kind: null,
     priority_position: null,
     priority_colour: null,
     project_id: 5,
     phase_id: 9,
     start_date: null,
     end_date: null,
     completed_at: null,
     position: 1024,
   };

   beforeEach(() => {
     insertedValues.length = 0;
     updatedSets.length = 0;
     mockSelectFrom.mockReset();
     mockTransaction.mockReset();
     mockParseProjectPhase.mockReset().mockResolvedValue({
       projectId: null,
       phaseId: null,
     });
     mockParseDateRange.mockReset().mockResolvedValue({
       startDate: null,
       endDate: null,
     });
     mockTransaction.mockImplementation(() => ({
       execute: async (cb: (trx: unknown) => unknown) => cb(makeTrx()),
     }));
     // getWorkspacePrefix, then the post-write re-fetch of the row.
     mockSelectFrom.mockImplementation((table: string) => {
       if (table === "workspaces") return chainable({ name: "Camel Team" });
       return chainable([existingItemRow]);
     });
   });

   describe("POST /tracker/items — assignment, dates, completion", () => {
     it("assigns an end-of-bucket position and never leaves it NULL", async () => {
       const res = await request(app)
         .post("/workspaces/7/tracker/items")
         .send({ title: "New task" });
       expect(res.status).toBe(201);
       const created = insertedValues.find((v) => "title" in v);
       expect(created).toBeDefined();
       expect(created.position).not.toBeNull();
       expect(created.position).not.toBeUndefined();
     });

     it("persists projectId, phaseId, startDate and endDate on create", async () => {
       mockParseProjectPhase.mockResolvedValueOnce({ projectId: 5, phaseId: 9 });
       mockParseDateRange.mockResolvedValueOnce({
         startDate: "2026-09-21",
         endDate: "2026-09-30",
       });
       const res = await request(app).post("/workspaces/7/tracker/items").send({
         title: "New task",
         projectId: 5,
         phaseId: 9,
         startDate: "2026-09-21",
         endDate: "2026-09-30",
       });
       expect(res.status).toBe(201);
       const created = insertedValues.find((v) => "title" in v);
       expect(created.project_id).toBe(5);
       expect(created.phase_id).toBe(9);
       expect(created.start_date).toBe("2026-09-21");
       expect(created.end_date).toBe("2026-09-30");
     });

     it("returns 400 for an inverted date range and creates nothing", async () => {
       mockParseDateRange.mockResolvedValueOnce({ error: "end precedes start" });
       const res = await request(app).post("/workspaces/7/tracker/items").send({
         title: "New task",
         startDate: "2026-09-30",
         endDate: "2026-09-21",
       });
       expect(res.status).toBe(400);
       expect(mockTransaction).not.toHaveBeenCalled();
     });

     it("returns 400 for a cross-workspace or soft-deleted project/phase and creates nothing", async () => {
       mockParseProjectPhase.mockResolvedValueOnce({ error: "not found" });
       const res = await request(app)
         .post("/workspaces/7/tracker/items")
         .send({ title: "New task", projectId: 999 });
       expect(res.status).toBe(400);
       expect(mockTransaction).not.toHaveBeenCalled();
     });
   });

   describe("PATCH /tracker/items/:key — assignment, dates, completion", () => {
     it("derives project_id from phaseId and bumps version", async () => {
       mockParseProjectPhase.mockResolvedValueOnce({ projectId: 5, phaseId: 9 });
       const res = await request(app)
         .patch("/workspaces/7/tracker/items/CAM-42")
         .send({ phaseId: 9, version: 3 });
       expect(res.status).toBe(200);
       const update = updatedSets.find((s) => "phase_id" in s);
       expect(update.phase_id).toBe(9);
       expect(update.project_id).toBe(5);
     });

     it("clears both project_id and phase_id when {projectId: null} and no phaseId", async () => {
       mockParseProjectPhase.mockResolvedValueOnce({
         projectId: null,
         phaseId: null,
       });
       const res = await request(app)
         .patch("/workspaces/7/tracker/items/CAM-42")
         .send({ projectId: null, version: 3 });
       expect(res.status).toBe(200);
       const update = updatedSets.find((s) => "project_id" in s);
       expect(update.project_id).toBeNull();
       expect(update.phase_id).toBeNull();
     });

     it("returns 400 for {projectId: null, phaseId: X}", async () => {
       mockParseProjectPhase.mockResolvedValueOnce({ error: "invalid pair" });
       const res = await request(app)
         .patch("/workspaces/7/tracker/items/CAM-42")
         .send({ projectId: null, phaseId: 9, version: 3 });
       expect(res.status).toBe(400);
     });

     it("returns 400 for a cross-workspace or soft-deleted project/phase and writes nothing", async () => {
       mockParseProjectPhase.mockResolvedValueOnce({ error: "not found" });
       const res = await request(app)
         .patch("/workspaces/7/tracker/items/CAM-42")
         .send({ projectId: 999, version: 3 });
       expect(res.status).toBe(400);
       expect(updatedSets).toHaveLength(0);
     });

     it("returns 400 for an inverted date range", async () => {
       mockParseDateRange.mockResolvedValueOnce({ error: "end precedes start" });
       const res = await request(app)
         .patch("/workspaces/7/tracker/items/CAM-42")
         .send({ startDate: "2026-09-30", endDate: "2026-09-21", version: 3 });
       expect(res.status).toBe(400);
     });

     it("ignores completedAt and position when present in the body", async () => {
       mockParseProjectPhase.mockResolvedValueOnce({ projectId: 5, phaseId: 9 });
       const res = await request(app)
         .patch("/workspaces/7/tracker/items/CAM-42")
         .send({
           phaseId: 9,
           version: 3,
           completedAt: "2020-01-01T00:00:00Z",
           position: 999999,
         });
       expect(res.status).toBe(200);
       const update = updatedSets.find((s) => "phase_id" in s);
       expect(update.position).not.toBe(999999);
       expect(update.completed_at).not.toBe("2020-01-01T00:00:00Z");
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- server/src/routes/tracker-items.write.test.ts`
   Expected failure: POST inserts a NULL position and ignores dates; PATCH ignores `projectId`; `completed_at` never set

3a. Implement in the CREATE handler (`server/src/routes/tracker-items.ts:352-478`):
   - Call `parseProjectPhase` and `parseDateRange` from T5, returning 400 before the insert
   - Assign `position` at the end of the target `(project_id, phase_id)` bucket via
     `positionBetween`, so a created item is never left NULL
   - Stamp `completed_at` when the requested initial status has category `completed`
   - Leave key allocation exactly as it is — nothing may touch `workspaces.tracker_key_counter`

3b. Implement in the PATCH handler (`server/src/routes/tracker-items.ts:513-726`):
   - Call `parseProjectPhase` and `parseDateRange` from T5, returning 400 on their errors
     before any write, following the existing `parseAssigneeIds` error-return style
   - An explicit `{projectId: null}` clears both `project_id` and `phase_id`
   - Set `completed_at` with a CASE expression mirroring `cards.ts:790`:
     set to `COALESCE(completed_at, now())` when the target status category is `completed`,
     otherwise `NULL`
   - When `project_id` or `phase_id` changes, assign a fresh end-of-bucket `position` using
     `positionBetween` from `server/src/core/position.ts`
   - Bump `version` on assignment writes (mirroring the moved card at `cards.ts:783-791`)
   - Explicitly ignore `completedAt` and `position` if present in the body
   - Call `recordTrackerActivity()` for the mutation as the handler already does

4. Run test — verify PASS:
   `npm run test -- server/src/routes/tracker-items.write.test.ts`
   Then: `npm run test`, `npm run typecheck`, and
   `RUN_INTEGRATION=1 npm run test -- server/src/routes/tracker-items.integration.test.ts`
   Expected: PASS

5. Refactor while green (bounded):
   - The PATCH handler is already 213 lines; if this work pushes a single block past ~50
     lines, extract it into a named function in `tracker-item-parsers.ts` rather than
     inlining further
   - Re-run: `npm run test -- server/src/routes/tracker-items.write.test.ts` — must stay PASS

6. Commit:
   `git add server/src/routes/tracker-items.ts server/src/routes/tracker-items.write.test.ts`
   `git commit -m "feat(tracker): assign items to projects and phases with schedule and completion stamping"`

## REFERENCES LOADED

docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md —
rules: Project / phase assignment, Scheduling, Ordering (version semantics)
server/src/routes/cards.ts:783-791 — the moved card sets `version + 1` alongside `position`;
this is the assignment precedent
server/src/routes/cards.ts:770-777 — the rebalance sibling loop rewrites `position` WITHOUT
bumping `version`; this is the reorder precedent, used by T8 not here
server/src/routes/cards.ts:790 — the `done_at` CASE expression `completed_at` mirrors
server/src/core/position.ts:16-27 — `positionBetween`, and the `RangeError` it throws

## WHY THIS APPROACH

Justification: one file, but branching logic across four interacting concerns (assignment,
dates, completion stamping, versioning) inside an already-large handler.
Complexity: standard

## SANDWICH CONTEXT

[CRITICAL: assignment writes BUMP `version`; reorder-only writes do NOT. Getting this backwards silently breaks conflict detection for concurrent reassignment.]
You are implementing the item write path for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — the server stores facts and validates them; it never computes progress.
Files in scope: `server/src/routes/tracker-items.ts` and the new write test — no other files.
Test framework: Vitest; the gated integration suite needs `RUN_INTEGRATION=1` and a live PostgreSQL.
Available after: T6 (the read path on this same file — do not work on it concurrently)
Architecture rule: every mutation calls `recordTrackerActivity()`; stale writes return 409; validation happens before any write so a rejected request writes nothing.
[RESTATE: assignment writes BUMP `version`; reorder-only writes do NOT. Getting this backwards silently breaks conflict detection for concurrent reassignment.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a new item is created with no project, When it is inserted, Then it receives an end-of-bucket position and never a NULL one
Given a new item is created with a project, phase and date range, When it is inserted, Then all four are persisted and it is positioned at the end of that phase
Given a phase with 3 ordered tasks, When a task is added to it, Then it is positioned last
Given a PATCH with `phaseId` X and no `projectId`, When applied, Then `project_id` is derived from X and `version` is bumped
Given a task in project P, When PATCHed with `{projectId: null}` and no `phaseId`, Then both `project_id` and `phase_id` become NULL
Given `FA-25` in project P phase X, When PATCHed with `projectId` P2 and no `phaseId`, Then `project_id` becomes P2 and `phase_id` becomes NULL
Given an item with `completed_at` NULL, When status changes to a `completed` status, Then `completed_at` is set to now()
Given `completed_at` already set, When the item moves between completed statuses, Then `completed_at` is unchanged
Given a Done item, When status changes to In Progress, Then `completed_at` becomes NULL
Given an In Progress item, When status changes to Canceled, Then `completed_at` stays NULL
Given an unassigned task, When assigned to a project and phase, Then it receives an end-of-bucket position
[must-not] Given `{projectId: null, phaseId: X}`, When applied, Then 400
[must-not] Given a cross-workspace, soft-deleted or nonexistent project/phase id, When PATCHed, Then 400 and no field is written
[must-not] Given start 2026-09-30 and end 2026-09-21, When saved on either create or update, Then 400
[must-not] Given a create or PATCH body carrying `completedAt` or `position`, When applied, Then both are ignored

**Note on version semantics:** the spec's "Project / phase assignment" criterion and its
"Rule: Ordering" both speak to versioning. Ordering is authoritative and this task follows
it: an assignment write bumps `version`; only reorder-only writes (T8) leave it alone. The
spec's assignment criterion was corrected to match — do not read this as a deviation.

All tests PASS. Commit exists with message matching `feat(tracker): …`.

## QUALITY BAR

Must-have:
  - BOTH the create and update handlers wired — a created item must never carry a NULL position
  - Validators imported from T5's module, never reimplemented locally
  - `completed_at` uses `COALESCE(completed_at, now())` so re-entry does not re-stamp
  - `recordTrackerActivity()` called for the mutation
  - Tests written BEFORE implementation

Must-not-have:
  - Reorder handled here — that is T8's dedicated endpoint
  - Any change to key allocation or `workspaces.tracker_key_counter`
  - `completedAt` or `position` accepted from the request body
  - Any fix to the unvalidated `statusId` path
  - Modifications to files outside the listed scope

Open question risks:
  - none

Rollback note:
  - Assignment is reversible by the user; no destructive write happens on this path.

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Validation performed after a partial write → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, gated integration suite passes, commit created
Uncertain when: the status category needed for the `completed_at` CASE is not reachable in the update query
Escalate when: satisfying version semantics requires changing the optimistic-locking contract elsewhere

---

### Task 10: Phase routes — CRUD and delete-to-no-phase [depends: T9]

## OBJECTIVE

Add the phase resource inside a project: create ordered last, rename, set optional explicit
dates, and delete by releasing its tasks to "No phase" while keeping their project.

Files:
- Create: `server/src/routes/tracker-phases.ts`
- Test: `server/src/routes/tracker-phases.test.ts`
- Modify: `server/src/routes.ts`

Steps:

1. Write failing tests in `server/src/routes/tracker-phases.test.ts` for:
   - `POST` creates a phase positioned after the existing last one
   - `POST` accepts an optional subtitle and optional `startDate`/`endDate`
   - `POST` with an inverted explicit range returns 400
   - the same phase name is accepted in two different projects
   - `PATCH` renames and updates dates; a stale version returns 409
   - `DELETE` soft-deletes the phase, nulls `phase_id` on its tasks, and leaves `project_id` intact
   - released tasks keep unchanged `version` and `updated_at` and are appended in old-position order
   - `DELETE` writes exactly one activity row and publishes exactly one SSE event

   ```typescript
   // server/src/routes/tracker-phases.test.ts
   import express from "express";
   import request from "supertest";
   import { beforeEach, describe, expect, it, vi } from "vitest";

   function chainable(result: unknown) {
     const b: any = {};
     for (const m of ["where", "returning", "orderBy", "select", "$if"]) {
       b[m] = vi.fn(() => b);
     }
     const isArray = Array.isArray(result);
     b.execute = vi.fn().mockResolvedValue(isArray ? result : [result]);
     b.executeTakeFirst = vi.fn().mockResolvedValue(isArray ? result[0] : result);
     b.executeTakeFirstOrThrow = b.executeTakeFirst;
     return b;
   }

   const insertedValues: Array<{ table: string; values: any }> = [];
   const updatedSets: Array<{ table: string; values: any }> = [];

   let projectRow: any = { id: 3, workspace_id: 7, deleted_at: null };
   let phaseRows: any[] = [{ id: 9, project_id: 3, name: "Persiapan", position: 1024 }];
   let itemRows: any[] = [];

   function makeTrx() {
     const trx: any = {};
     trx.selectFrom = vi.fn((table: string) => {
       if (table === "tracker_projects") return chainable(projectRow);
       if (table === "tracker_phases") return chainable(phaseRows);
       if (table === "tracker_items") return chainable(itemRows);
       return chainable([]);
     });
     trx.insertInto = vi.fn((table: string) => ({
       values: vi.fn((values: unknown) => {
         insertedValues.push({ table, values });
         return chainable({ id: 20, ...(values as object) });
       }),
     }));
     trx.updateTable = vi.fn((table: string) => ({
       set: vi.fn((values: unknown) => {
         updatedSets.push({ table, values });
         return chainable(table === "tracker_items" ? itemRows : undefined);
       }),
     }));
     return trx;
   }

   const mockSelectFrom = vi.fn();
   const mockUpdateTable = vi.fn();
   const mockTransaction = vi.fn();

   vi.mock("../db/kysely.js", () => ({
     db: {
       selectFrom: (...args: unknown[]) => mockSelectFrom(...args),
       updateTable: (...args: unknown[]) => mockUpdateTable(...args),
       transaction: (...args: unknown[]) => mockTransaction(...args),
     },
   }));
   vi.mock("../middleware/workspace.js", () => ({
     requireWorkspaceMember: (req: any, _res: any, next: any) => {
       req.workspace = { workspaceId: 7, role: "member" };
       next();
     },
   }));
   vi.mock("../realtime.js", () => ({ publishEvent: vi.fn() }));
   vi.mock("./tracker-activity.js", () => ({ recordTrackerActivity: vi.fn() }));
   vi.mock("./tracker-item-parsers.js", () => ({
     parseDateRange: vi.fn().mockResolvedValue({ startDate: null, endDate: null }),
   }));

   import { publishEvent } from "../realtime.js";
   import { recordTrackerActivity } from "./tracker-activity.js";
   import { parseDateRange } from "./tracker-item-parsers.js";
   import { trackerPhasesRouter } from "./tracker-phases.js";

   const app = express();
   app.use(express.json());
   app.use((req, _res, next) => {
     (req as any).user = { id: 1, displayName: "Bob" };
     next();
   });
   app.use("/workspaces/:workspaceId", trackerPhasesRouter);

   beforeEach(() => {
     insertedValues.length = 0;
     updatedSets.length = 0;
     projectRow = { id: 3, workspace_id: 7, deleted_at: null };
     phaseRows = [{ id: 9, project_id: 3, name: "Persiapan", position: 1024 }];
     itemRows = [];
     mockSelectFrom.mockReset();
     mockUpdateTable.mockReset();
     mockTransaction.mockReset();
     mockTransaction.mockImplementation(() => ({
       execute: async (cb: (trx: unknown) => unknown) => cb(makeTrx()),
     }));
     mockSelectFrom.mockImplementation((table: string) => {
       if (table === "tracker_projects") return chainable(projectRow);
       if (table === "tracker_phases") return chainable(phaseRows);
       return chainable([]);
     });
     vi.mocked(publishEvent).mockReset();
     vi.mocked(recordTrackerActivity).mockReset();
     vi.mocked(parseDateRange)
       .mockReset()
       .mockResolvedValue({ startDate: null, endDate: null } as any);
   });

   describe("POST /tracker/projects/:projectId/phases", () => {
     it("positions a new phase after the existing last one", async () => {
       phaseRows = [
         { id: 9, project_id: 3, name: "Persiapan", position: 1024 },
         { id: 10, project_id: 3, name: "Pengembangan", position: 2048 },
       ];
       const res = await request(app)
         .post("/workspaces/7/tracker/projects/3/phases")
         .send({ name: "Peluncuran" });
       expect(res.status).toBe(201);
       const created = insertedValues.find((v) => v.table === "tracker_phases");
       expect(created?.values.position).toBeGreaterThan(2048);
     });

     it("accepts an optional subtitle and optional startDate/endDate", async () => {
       vi.mocked(parseDateRange).mockResolvedValueOnce({
         startDate: "2026-09-01",
         endDate: "2026-09-10",
       } as any);
       const res = await request(app)
         .post("/workspaces/7/tracker/projects/3/phases")
         .send({ name: "Peluncuran", subtitle: "Go live", startDate: "2026-09-01", endDate: "2026-09-10" });
       expect(res.status).toBe(201);
       const created = insertedValues.find((v) => v.table === "tracker_phases");
       expect(created?.values.subtitle).toBe("Go live");
       expect(created?.values.start_date).toBe("2026-09-01");
       expect(created?.values.end_date).toBe("2026-09-10");
     });

     it("returns 400 for an inverted explicit date range", async () => {
       vi.mocked(parseDateRange).mockResolvedValueOnce({ error: "end precedes start" } as any);
       const res = await request(app)
         .post("/workspaces/7/tracker/projects/3/phases")
         .send({ name: "Peluncuran", startDate: "2026-09-30", endDate: "2026-09-21" });
       expect(res.status).toBe(400);
       expect(mockTransaction).not.toHaveBeenCalled();
     });

     it("accepts the same phase name in two different projects", async () => {
       const first = await request(app)
         .post("/workspaces/7/tracker/projects/3/phases")
         .send({ name: "Persiapan" });
       projectRow = { id: 4, workspace_id: 7, deleted_at: null };
       phaseRows = [];
       const second = await request(app)
         .post("/workspaces/7/tracker/projects/4/phases")
         .send({ name: "Persiapan" });
       expect(first.status).toBe(201);
       expect(second.status).toBe(201);
     });
   });

   describe("PATCH /tracker/projects/:projectId/phases/:id", () => {
     it("renames and updates dates when the version matches", async () => {
       vi.mocked(parseDateRange).mockResolvedValueOnce({
         startDate: "2026-09-01",
         endDate: null,
       } as any);
       mockUpdateTable.mockImplementation((table: string) => ({
         set: vi.fn((values: unknown) => {
           updatedSets.push({ table, values });
           return chainable({ id: 9, name: "Persiapan awal", version: 2 });
         }),
       }));
       const res = await request(app)
         .patch("/workspaces/7/tracker/projects/3/phases/9")
         .send({ name: "Persiapan awal", startDate: "2026-09-01", version: 1 });
       expect(res.status).toBe(200);
       expect(res.body.name).toBe("Persiapan awal");
     });

     it("returns 409 for a stale version", async () => {
       mockUpdateTable.mockImplementation((table: string) => ({
         set: vi.fn((values: unknown) => {
           updatedSets.push({ table, values });
           return chainable(undefined);
         }),
       }));
       const res = await request(app)
         .patch("/workspaces/7/tracker/projects/3/phases/9")
         .send({ name: "Persiapan awal", version: 1 });
       expect(res.status).toBe(409);
     });
   });

   describe("DELETE /tracker/projects/:projectId/phases/:id", () => {
     // Current order within the phase (ascending position) is C, A, B —
     // released tasks must keep that relative order.
     const releasedInOldOrder = [
       { id: 201, phase_id: 9, position: 10, title: "C" },
       { id: 202, phase_id: 9, position: 20, title: "A" },
       { id: 203, phase_id: 9, position: 30, title: "B" },
     ];

     beforeEach(() => {
       itemRows = releasedInOldOrder;
     });

     it("soft-deletes the phase, nulls phase_id on its tasks, and leaves project_id intact", async () => {
       const res = await request(app)
         .delete("/workspaces/7/tracker/projects/3/phases/9")
         .send({});
       expect(res.status).toBe(204);
       expect(updatedSets.find((u) => u.table === "tracker_phases")?.values.deleted_at).toBeTruthy();
       const itemRelease = updatedSets.find((u) => u.table === "tracker_items");
       expect(itemRelease?.values.phase_id).toBeNull();
       expect(itemRelease?.values).not.toHaveProperty("project_id");
     });

     it("keeps version and updated_at unchanged, and appends released tasks in old-position order", async () => {
       await request(app).delete("/workspaces/7/tracker/projects/3/phases/9").send({});
       const itemRelease = updatedSets.find((u) => u.table === "tracker_items");
       expect(itemRelease?.values).not.toHaveProperty("version");
       expect(itemRelease?.values).not.toHaveProperty("updated_at");
       const [, , , , opts] = vi.mocked(recordTrackerActivity).mock.calls[0] as any[];
       const releasedIds = (opts.payload.released as Array<{ itemId: number }>).map(
         (r) => r.itemId,
       );
       expect(releasedIds).toEqual([201, 202, 203]); // C, A, B by old position 10/20/30
     });

     it("writes exactly one activity row and publishes exactly one SSE event", async () => {
       await request(app).delete("/workspaces/7/tracker/projects/3/phases/9").send({});
       expect(recordTrackerActivity).toHaveBeenCalledTimes(1);
       expect(publishEvent).toHaveBeenCalledTimes(1);
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- server/src/routes/tracker-phases.test.ts`
   Expected failure: `Cannot find module './tracker-phases.js'`

3. Implement:
   - `server/src/routes/tracker-phases.ts` exporting `trackerPhasesRouter`, nested under a
     project id, every route behind `requireWorkspaceMember` and verifying the project
     belongs to the active workspace and is not soft-deleted
   - Date validation reuses `parseDateRange` from T5 — never a local copy
   - `POST` assigns an end-of-list `position` via `positionBetween`
   - `DELETE` in one transaction: soft-delete the phase, null `phase_id` on its items while
     assigning fresh end-of-bucket positions in old-position order so relative order
     survives, WITHOUT touching `version` or `updated_at`; one `recordTrackerActivity()`;
     one `publishEvent`
   - Mount in `server/src/routes.ts`

4. Run test — verify PASS:
   `npm run test -- server/src/routes/tracker-phases.test.ts`
   Then: `npm run test` and `npm run typecheck`
   Expected: PASS

5. Refactor while green (bounded):
   - The release-with-order-preservation logic now exists in both T9 and here — extract one
     shared helper and import it in both rather than keeping two copies
   - Re-run: `npm run test -- server/src/routes/tracker-phases.test.ts` — must stay PASS

6. Commit:
   `git add server/src/routes/tracker-phases.ts server/src/routes/tracker-phases.test.ts server/src/routes.ts`
   `git commit -m "feat(tracker): add phase routes with delete-to-no-phase release"`

## REFERENCES LOADED

docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md —
rules: Phase lifecycle, Overdue (explicit phase dates), Ordering (release order)
server/src/routes/tracker-projects.ts — the sibling router created by T9, whose release
logic this task shares
server/src/routes/tracker-item-parsers.ts — `parseDateRange` from T5
server/src/core/position.ts — end-of-list and bucket position assignment

## WHY THIS APPROACH

Justification: a new resource sharing transactional release logic with T9 — the duplication
risk is the reason the refactor step is explicit.
Complexity: standard

## SANDWICH CONTEXT

[CRITICAL: deleting a phase releases its tasks to `phase_id = NULL` but they KEEP `project_id` — they land in the project's "No phase" section, not in the unassigned list.]
You are implementing phase routes for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — phases return their stored dates; derived bounds are computed on the client.
Files in scope: `server/src/routes/tracker-phases.ts`, its test, `server/src/routes.ts` — no other files.
Test framework: Vitest, `vi.mock` at top level, tests beside source.
Available after: T9 (project routes and the shared release helper)
Architecture rule: reuse `parseDateRange` from the parsers module; every mutation calls `recordTrackerActivity()`; released tasks keep `version` and `updated_at` untouched.
[RESTATE: deleting a phase releases its tasks to `phase_id = NULL` but they KEEP `project_id` — they land in the project's "No phase" section, not in the unassigned list.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given project P with phases "Persiapan" and "Pengembangan", When "Peluncuran" is added, Then it is positioned after "Pengembangan"
Given phase "Persiapan" with 5 tasks, When renamed then deleted, Then rename succeeds and its tasks get `phase_id` NULL while keeping `project_id` P
Given phase tasks ordered C, A, B, When the phase is deleted, Then they appear after the existing "No phase" tasks in the order C, A, B
Given two different projects, When each creates a phase named "Persiapan", Then both succeed
Given a phase, When PATCHed with explicit start 2026-09-01 and no end, Then it is accepted
[must-not] Given phase start 2026-09-30 and end 2026-09-21, When saved, Then 400
[must-not] Given a stale version, When PATCH is attempted, Then 409
[must-not] Given released tasks, When the delete completes, Then neither `version` nor `updated_at` changed

All tests PASS. Commit exists with message matching `feat(tracker): …`.

## QUALITY BAR

Must-have:
  - Release preserves relative order via fresh end-of-bucket positions
  - `parseDateRange` imported from the parsers module, not reimplemented
  - Exactly one activity row and one SSE event per delete
  - Tests written BEFORE implementation

Must-not-have:
  - Releasing tasks out of their project
  - A second copy of the release logic shared with T9
  - Server-computed phase bounds or rollup
  - Modifications to files outside the listed scope

Open question risks:
  - none

Rollback note:
  - Phase deletion nulls `phase_id`; the activity payload records what was released.

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - `project_id` cleared on phase delete → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: T9's release helper does not generalise to the phase case
Escalate when: preserving release order conflicts with the no-version-bump rule

---

### Task 8: Reorder endpoint — bucket positions without version bumps [depends: T7]

## OBJECTIVE

Add the dedicated reorder route the Ordering rule requires, since PATCH deliberately ignores
`position`. This endpoint ships and is tested even if the drag UI is cut.

Files:
- Modify: `server/src/routes/tracker-items.ts`
- Test: `server/src/routes/tracker-items.reorder.test.ts`

Steps:

1. Write failing tests in `server/src/routes/tracker-items.reorder.test.ts` for:
   - moving C between A and B gives C the midpoint position
   - the reordered item's `version` is unchanged
   - a rebalance triggered by `RangeError` rewrites sibling positions without bumping any sibling `version`
   - reordering across buckets is rejected (reorder is within one `(project_id, phase_id)` bucket)
   - a reorder targeting an item in another workspace returns 400 or 404, never a 500

   ```typescript
   // server/src/routes/tracker-items.reorder.test.ts
   import express from "express";
   import request from "supertest";
   import { beforeEach, describe, expect, it, vi } from "vitest";

   function chainable(result: unknown) {
     const b: any = {};
     for (const m of ["where", "returning", "orderBy", "select", "$if"]) {
       b[m] = vi.fn(() => b);
     }
     const isArray = Array.isArray(result);
     b.execute = vi.fn().mockResolvedValue(isArray ? result : [result]);
     b.executeTakeFirst = vi.fn().mockResolvedValue(isArray ? result[0] : result);
     b.executeTakeFirstOrThrow = b.executeTakeFirst;
     return b;
   }

   const updateCalls: Array<{ id: number; values: any }> = [];

   function makeTrx(siblings: Array<{ id: number; position: number }>) {
     const trx: any = {};
     trx.selectFrom = vi.fn(() => chainable(siblings));
     trx.updateTable = vi.fn(() => ({
       set: vi.fn((values: any) => ({
         where: vi.fn((_col: string, _op: string, id: number) => {
           updateCalls.push({ id, values });
           return chainable(undefined);
         }),
       })),
     }));
     return trx;
   }

   const mockSelectFrom = vi.fn();
   const mockTransaction = vi.fn();

   vi.mock("../db/kysely.js", () => ({
     db: {
       selectFrom: (...args: unknown[]) => mockSelectFrom(...args),
       transaction: (...args: unknown[]) => mockTransaction(...args),
     },
   }));
   vi.mock("../middleware/workspace.js", () => ({
     requireWorkspaceMember: (req: any, _res: any, next: any) => {
       req.workspace = { workspaceId: 7, role: "member" };
       next();
     },
   }));
   vi.mock("./tracker-assignees.js", () => ({
     loadTrackerAssigneesForItems: vi.fn().mockResolvedValue(new Map()),
     syncTrackerItemAssignees: vi.fn(),
   }));
   vi.mock("../realtime.js", () => ({ publishEvent: vi.fn() }));
   vi.mock("./tracker-activity.js", () => ({ recordTrackerActivity: vi.fn() }));

   import { trackerItemsRouter } from "./tracker-items.js";

   const app = express();
   app.use(express.json());
   app.use((req, _res, next) => {
     (req as any).user = { id: 1, displayName: "Bob" };
     next();
   });
   app.use("/workspaces/:workspaceId", trackerItemsRouter);

   const itemC = {
     id: 3,
     key_number: 3,
     title: "C",
     version: 1,
     project_id: 5,
     phase_id: 9,
     position: 3072,
   };

   beforeEach(() => {
     updateCalls.length = 0;
     mockSelectFrom.mockReset();
     mockTransaction.mockReset();
   });

   describe("PATCH /tracker/items/:key/position", () => {
     it("gives the moved item the midpoint position between its new neighbours", async () => {
       const siblings = [
         { id: 1, position: 1024 }, // A
         { id: 2, position: 2048 }, // B
         { id: 3, position: 3072 }, // C
       ];
       mockTransaction.mockImplementation(() => ({
         execute: async (cb: (trx: unknown) => unknown) => cb(makeTrx(siblings)),
       }));
       mockSelectFrom.mockReturnValue(chainable(itemC));

       const res = await request(app)
         .patch("/workspaces/7/tracker/items/CAM-3/position")
         .send({ beforeId: 1, afterId: 2 });

       expect(res.status).toBe(200);
       const move = updateCalls.find((c) => c.id === 3);
       expect(move?.values.position).toBeCloseTo(1536);
     });

     it("leaves version and updated_at unchanged on a normal move", async () => {
       const siblings = [
         { id: 1, position: 1024 },
         { id: 2, position: 2048 },
         { id: 3, position: 3072 },
       ];
       mockTransaction.mockImplementation(() => ({
         execute: async (cb: (trx: unknown) => unknown) => cb(makeTrx(siblings)),
       }));
       mockSelectFrom.mockReturnValue(chainable(itemC));

       await request(app)
         .patch("/workspaces/7/tracker/items/CAM-3/position")
         .send({ beforeId: 1, afterId: 2 });

       const move = updateCalls.find((c) => c.id === 3);
       expect(move?.values).not.toHaveProperty("version");
       expect(move?.values).not.toHaveProperty("updated_at");
     });

     it("rebalances the bucket without bumping any sibling version when neighbours are too close", async () => {
       const tight = [
         { id: 1, position: 1 },
         { id: 2, position: 1 + 1e-12 },
         { id: 3, position: 2048 },
       ];
       mockTransaction.mockImplementation(() => ({
         execute: async (cb: (trx: unknown) => unknown) => cb(makeTrx(tight)),
       }));
       mockSelectFrom.mockReturnValue(chainable(itemC));

       const res = await request(app)
         .patch("/workspaces/7/tracker/items/CAM-3/position")
         .send({ beforeId: 1, afterId: 2 });

       expect(res.status).toBe(200);
       expect(updateCalls.every((c) => !("version" in c.values))).toBe(true);
       // A rebalance rewrites more than just the moved item.
       expect(updateCalls.length).toBeGreaterThan(1);
     });

     it("rejects a reorder targeting an item in another workspace without a 500", async () => {
       mockSelectFrom.mockReturnValue(chainable(undefined));
       const res = await request(app)
         .patch("/workspaces/7/tracker/items/CAM-999/position")
         .send({ beforeId: 1, afterId: 2 });
       expect([400, 404]).toContain(res.status);
     });

     it("rejects a cross-bucket move", async () => {
       mockSelectFrom.mockReturnValue(chainable(itemC));
       const res = await request(app)
         .patch("/workspaces/7/tracker/items/CAM-3/position")
         .send({ projectId: 99, phaseId: 1 });
       expect(res.status).toBe(400);
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- server/src/routes/tracker-items.reorder.test.ts`
   Expected failure: route not found

3. Implement in `server/src/routes/tracker-items.ts`:
   - `PATCH /tracker/items/:key/position` behind `requireWorkspaceMember`, taking a target
     index or neighbour ids within the item's current bucket
   - Read sibling positions ordered by `position` with a defensive `COALESCE` — after the
     T1 backfill no live row should hold NULL, but `Number(null)` is `0` in JS while
     Postgres sorts NULLs last, so the read must not depend on that agreement
   - Compute with `neighborsAt` + `positionBetween`; on `RangeError`, `rebalance` the bucket
     and recompute, following `cards.ts:765-781` exactly
   - Write `position` only — no `version`, no `updated_at`
   - Call `recordTrackerActivity()` for the reorder

4. Run test — verify PASS:
   `npm run test -- server/src/routes/tracker-items.reorder.test.ts`
   Then: `npm run test` and `npm run typecheck`
   Expected: PASS

5. Refactor while green (bounded):
   - If the bucket-sibling read now appears in both T7's assignment path and here, extract
     one helper into `tracker-item-parsers.ts` and import it in both
   - Re-run: `npm run test -- server/src/routes/tracker-items.reorder.test.ts` — must stay PASS

6. Commit:
   `git add server/src/routes/tracker-items.ts server/src/routes/tracker-items.reorder.test.ts`
   `git commit -m "feat(tracker): add task reorder endpoint with fractional positions"`

## REFERENCES LOADED

docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md —
rule: Ordering, including the acceptance that the endpoint survives if the drag UI is cut
server/src/core/position.ts:16-44 — `positionBetween`, `neighborsAt`, `rebalance`, `MIN_SPACING`
server/src/routes/cards.ts:765-781 — the rebalance-on-RangeError pattern and the sibling
rewrite that does not bump `version`

## WHY THIS APPROACH

Justification: one route on an existing file, well-specified, with a proven pattern to copy —
but the NULL-position hazard needs deliberate handling.
Complexity: lightweight

## SANDWICH CONTEXT

[CRITICAL: this endpoint writes `position` ONLY — never `version`, never `updated_at`. Bumping either would 409 every open editor on an unrelated reorder.]
You are implementing the reorder endpoint for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — ordering is stored fractionally on the server; the client renders it.
Files in scope: `server/src/routes/tracker-items.ts` and the new reorder test — no other files.
Test framework: Vitest, tests beside source.
Available after: T7 (the write path on this same file — do not work on it concurrently)
Architecture rule: use `server/src/core/position.ts` for all position maths; never integer positions; catch `RangeError` and rebalance rather than returning 500.
[RESTATE: this endpoint writes `position` ONLY — never `version`, never `updated_at`. Bumping either would 409 every open editor on an unrelated reorder.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given tasks A, B, C in a phase, When C is moved between A and B, Then C takes the midpoint position
Given a reorder request, When applied, Then the item's `version` is unchanged
Given a rebalance is triggered, When sibling positions are rewritten, Then no sibling `version` changes
Given positions too close to split, When a reorder is attempted, Then `rebalance` runs and the request succeeds rather than returning 500
Given the drag UI is cut from the plan, When the cycle ships, Then this endpoint still exists and is still tested
[must-not] Given a reorder targeting an item in another workspace, When attempted, Then it is rejected without a 500

All tests PASS. Commit exists with message matching `feat(tracker): …`.

## QUALITY BAR

Must-have:
  - `position` written alone
  - `RangeError` handled by rebalance, following the cards precedent
  - Defensive handling of a NULL position on read
  - `recordTrackerActivity()` called
  - Tests written BEFORE implementation

Must-not-have:
  - `version` or `updated_at` written on this path
  - Integer positions or reindexing every sibling on a normal move
  - Cross-bucket moves (that is assignment, handled by T7)
  - Modifications to files outside the listed scope

Open question risks:
  - none

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - `version` bumped here → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: the bucket a reorder applies to is ambiguous for an unassigned item
Escalate when: the reorder cannot avoid touching `updated_at` given the existing query builder usage

---

### Task 11: Client contracts — types and API surface [depends: T4, T6, T9, T10]

## OBJECTIVE

Extend the client's type definitions and API client so every UI task builds against one
agreed shape of project, phase, and the enriched tracker item.

Files:
- Modify: `client/src/types.ts`
- Modify: `client/src/api.ts`
- Test: `client/src/api.tracker.test.ts`

Steps:

1. Write failing tests in `client/src/api.tracker.test.ts` for:
   - `listTrackerProjects` GETs `/workspaces/{id}/tracker/projects`
   - `createTrackerProject`, `updateTrackerProject`, `deleteTrackerProject` hit the right
     methods and paths
   - `createTrackerPhase`, `updateTrackerPhase`, `deleteTrackerPhase` likewise
   - `reorderTrackerItem` PATCHes `/tracker/items/{key}/position`
   - `updateTrackerItem` forwards `projectId`, `phaseId`, `startDate`, `endDate`

   ```typescript
   // Appended to client/src/api.tracker.test.ts — reuses the module-level
   // mockFetch and sampleItem already declared at the top of this file; do
   // not redeclare them.
   const sampleProject = {
     id: 1,
     name: "Rilis v2",
     startDate: null,
     endDate: null,
     position: 1024,
     version: 1,
     phases: [],
     createdAt: "2026-08-03T00:00:00.000Z",
     updatedAt: "2026-08-03T00:00:00.000Z",
   };

   const samplePhase = {
     id: 9,
     projectId: 1,
     name: "Persiapan",
     subtitle: "",
     startDate: null,
     endDate: null,
     position: 1024,
     version: 1,
     createdAt: "2026-08-03T00:00:00.000Z",
     updatedAt: "2026-08-03T00:00:00.000Z",
   };

   describe("tracker project API methods", () => {
     beforeEach(() => mockFetch.mockReset());

     it("listTrackerProjects GETs /tracker/projects", async () => {
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 200,
         json: () => Promise.resolve([sampleProject]),
       });
       const { api } = await import("./api");

       const result = await api.listTrackerProjects(7);
       expect(result).toEqual([sampleProject]);
       expect(mockFetch).toHaveBeenCalledWith(
         "/api/workspaces/7/tracker/projects",
         expect.any(Object),
       );
     });

     it("createTrackerProject POSTs to /tracker/projects", async () => {
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 201,
         json: () => Promise.resolve(sampleProject),
       });
       const { api } = await import("./api");

       await api.createTrackerProject(7, { name: "Rilis v2" });
       expect(mockFetch).toHaveBeenCalledWith(
         "/api/workspaces/7/tracker/projects",
         expect.objectContaining({ method: "POST" }),
       );
       const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
       expect(body).toEqual({ name: "Rilis v2" });
     });

     it("updateTrackerProject PATCHes /tracker/projects/:id", async () => {
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 200,
         json: () => Promise.resolve({ ...sampleProject, name: "Rilis v3" }),
       });
       const { api } = await import("./api");

       await api.updateTrackerProject(7, 1, { name: "Rilis v3", version: 1 });
       expect(mockFetch).toHaveBeenCalledWith(
         "/api/workspaces/7/tracker/projects/1",
         expect.objectContaining({ method: "PATCH" }),
       );
       const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
       expect(body).toEqual({ name: "Rilis v3", version: 1 });
     });

     it("deleteTrackerProject DELETEs /tracker/projects/:id", async () => {
       mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });
       const { api } = await import("./api");

       await api.deleteTrackerProject(7, 1);
       expect(mockFetch).toHaveBeenCalledWith(
         "/api/workspaces/7/tracker/projects/1",
         expect.objectContaining({ method: "DELETE" }),
       );
     });
   });

   describe("tracker phase API methods", () => {
     beforeEach(() => mockFetch.mockReset());

     it("createTrackerPhase POSTs to /tracker/projects/:projectId/phases", async () => {
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 201,
         json: () => Promise.resolve(samplePhase),
       });
       const { api } = await import("./api");

       await api.createTrackerPhase(7, 1, { name: "Persiapan" });
       expect(mockFetch).toHaveBeenCalledWith(
         "/api/workspaces/7/tracker/projects/1/phases",
         expect.objectContaining({ method: "POST" }),
       );
       const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
       expect(body).toEqual({ name: "Persiapan" });
     });

     it("updateTrackerPhase PATCHes /tracker/projects/:projectId/phases/:id", async () => {
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 200,
         json: () => Promise.resolve({ ...samplePhase, name: "Persiapan awal" }),
       });
       const { api } = await import("./api");

       await api.updateTrackerPhase(7, 1, 9, {
         name: "Persiapan awal",
         startDate: "2026-09-01",
         version: 1,
       });
       expect(mockFetch).toHaveBeenCalledWith(
         "/api/workspaces/7/tracker/projects/1/phases/9",
         expect.objectContaining({ method: "PATCH" }),
       );
       const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
       expect(body).toEqual({
         name: "Persiapan awal",
         startDate: "2026-09-01",
         version: 1,
       });
     });

     it("deleteTrackerPhase DELETEs /tracker/projects/:projectId/phases/:id", async () => {
       mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });
       const { api } = await import("./api");

       await api.deleteTrackerPhase(7, 1, 9);
       expect(mockFetch).toHaveBeenCalledWith(
         "/api/workspaces/7/tracker/projects/1/phases/9",
         expect.objectContaining({ method: "DELETE" }),
       );
     });
   });

   describe("tracker item reorder and extended patch fields", () => {
     beforeEach(() => mockFetch.mockReset());

     it("reorderTrackerItem PATCHes /tracker/items/:key/position", async () => {
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 200,
         json: () => Promise.resolve(sampleItem),
       });
       const { api } = await import("./api");

       await api.reorderTrackerItem(7, "CA-1", { beforeId: 10, afterId: 11 });
       expect(mockFetch).toHaveBeenCalledWith(
         "/api/workspaces/7/tracker/items/CA-1/position",
         expect.objectContaining({ method: "PATCH" }),
       );
       const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
       expect(body).toEqual({ beforeId: 10, afterId: 11 });
     });

     it("updateTrackerItem forwards projectId, phaseId, startDate and endDate", async () => {
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 200,
         json: () => Promise.resolve(sampleItem),
       });
       const { api } = await import("./api");

       await api.updateTrackerItem(7, "CA-1", {
         projectId: 1,
         phaseId: 9,
         startDate: "2026-09-21",
         endDate: "2026-09-30",
         version: 1,
       });
       const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
       expect(body).toEqual({
         projectId: 1,
         phaseId: 9,
         startDate: "2026-09-21",
         endDate: "2026-09-30",
         version: 1,
       });
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/api.tracker.test.ts`
   Expected failure: `api.listTrackerProjects is not a function`

3. Implement:
   - `client/src/types.ts`: add `TrackerStatusCategory = "backlog" | "started" | "completed" | "canceled"`;
     add `category: TrackerStatusCategory | null` to `TrackerVocabulary`; add
     `projectId`, `phaseId`, `startDate`, `endDate`, `completedAt`, `position` to
     `TrackerItem` (all nullable); add `TrackerPhase` and `TrackerProject` interfaces with
     `TrackerProject.phases: TrackerPhase[]`
   - `client/src/api.ts`: add the project, phase and reorder methods beside the existing
     tracker block, following its exact `request<T>` style; extend `updateTrackerItem`'s
     patch type with the new optional fields

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/api.tracker.test.ts`
   Then: `npm run typecheck`
   Expected: PASS

5. Refactor while green (bounded):
   - If the project and phase method bodies repeat the same URL prefix three or more times,
     extract a small local path builder inside the tracker block
   - Re-run: `npm run test --workspace=client -- src/api.tracker.test.ts` — must stay PASS

6. Commit:
   `git add client/src/types.ts client/src/api.ts client/src/api.tracker.test.ts`
   `git commit -m "feat(tracker): add client types and API for projects and phases"`

## REFERENCES LOADED

docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md —
rules: Home and project page, Status semantics; the raw-foreign-keys-only payload contract
client/src/types.ts:336-350 — the existing `TrackerItem` shape this extends
client/src/api.ts:468-525 — the existing tracker API block and its `request<T>` convention
client/src/api.tracker.test.ts — the fetch-mock assertion convention this test extends

## WHY THIS APPROACH

Justification: three files, no behaviour, but five UI tasks depend on these shapes — a
divergent guess in any one of them costs a rewrite.
Complexity: lightweight

## SANDWICH CONTEXT

[CRITICAL: `TrackerItem` carries RAW `projectId`/`phaseId` only — no embedded names, no progress fields. Names come from the projects payload and are joined in the UI.]
You are implementing the client contracts for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — the client fetches all items plus projects-with-phases and derives everything else.
Files in scope: `client/src/types.ts`, `client/src/api.ts`, `client/src/api.tracker.test.ts` — no other files.
Test framework: Vitest with jsdom; run client tests with `npm run test --workspace=client`.
Available after: T4, T6, T9, T10 (the server contracts these mirror)
Architecture rule: client imports carry no file extension. `noUnusedLocals` and `noUnusedParameters` are enabled — an unused import fails typecheck.
[RESTATE: `TrackerItem` carries RAW `projectId`/`phaseId` only — no embedded names, no progress fields. Names come from the projects payload and are joined in the UI.]

## DELIVERABLE

Verification — task is DONE when all pass:

[derived] Given `listTrackerProjects`, When called, Then it GETs `/workspaces/{id}/tracker/projects`
[derived] Given `reorderTrackerItem`, When called, Then it PATCHes `/tracker/items/{key}/position`
[derived] Given `updateTrackerItem`, When called with `projectId` and `phaseId`, Then both appear in the request body
[derived] Given `TrackerProject`, When typed, Then it exposes `phases: TrackerPhase[]`
[must-not] Given `TrackerItem`, When typed, Then it exposes no project name, phase name, progress or overdue field

All tests PASS. Commit exists with message matching `feat(tracker): …`.

## QUALITY BAR

Must-have:
  - New item fields typed nullable
  - `category` typed as the four-value union, nullable
  - API methods follow the existing `request<T>` style exactly
  - Tests written BEFORE implementation

Must-not-have:
  - Derived or computed fields on any type
  - Embedded project/phase names on `TrackerItem`
  - Modifications to files outside the listed scope

Open question risks:
  - none

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - A rollup or overdue field added to a type → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, client tests and typecheck green, commit created
Uncertain when: a server payload shape differs from what T6/T9/T10 actually shipped
Escalate when: the UI appears to need a field the server contract does not provide

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 3 ONLY after this gate passes.
