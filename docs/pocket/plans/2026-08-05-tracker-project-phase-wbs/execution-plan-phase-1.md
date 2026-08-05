# Tracker Project / Phase / WBS — Schema migration — projects, phases, item columns, guarded backfills (Phase 1 of 4)

**Date:** 2026-08-05
**Original plan:** docs/pocket/plans/2026-08-05-tracker-project-phase-wbs/execution-plan.md
**Prerequisite:** None (first phase)
**Contains tasks:** {T1, T2, T3, T4, T5}
**Unlocks next:** Phase 2

---

## Task List

Total: 5 tasks | Prerequisite phases must be complete before starting

T1: Schema migration — projects, phases, item columns, guarded backfills [prereq]
T2: Shared contracts — Kysely table types and realtime event union [depends: T1]
T3: Vocabulary seeding at every workspace-creation path [depends: T2]
T4: Vocabulary route — category on the wire, status vocabulary closed [depends: T2] [parallel: T3]
T5: Tracker item parsers — extract validators and add project/phase/date validation [depends: T2]

---

## Pocket Packets

---

### Task 1: Schema migration — projects, phases, item columns, guarded backfills [prereq]

## OBJECTIVE

Add every schema change this cycle needs as one additive, re-runnable block appended to the
end of `server/src/db/schema.sql`, and extend the schema assertion test to lock the
constraints that matter.

Files:
- Modify: `server/src/db/schema.sql`
- Test: `server/src/db/tracker-migration.test.ts`

Steps:

1. Write failing assertions in `server/src/db/tracker-migration.test.ts` for:
   - `CREATE TABLE IF NOT EXISTS tracker_projects` and `tracker_phases` exist
   - `tracker_items` gains `project_id`, `phase_id`, `start_date`, `end_date`,
     `completed_at`, `position`
   - `tracker_vocabularies` gains `category`
   - the `position` backfill contains a `WHERE position IS NULL` guard
   - the `category` backfill contains a `WHERE category IS NULL` guard
   - the `category` backfill includes a catch-all mapping every remaining status row to
     `backlog`, so a status created before the lock is never left NULL
   - the `position` backfill partitions by `(workspace_id, project_id, phase_id)` to
     match per-bucket ordering semantics
   - the `category` backfill appears **after** the retroactive vocabulary seed block
     (assert via the marker comment `-- tracker: category backfill` placed immediately
     before that `UPDATE`, not a bare `indexOf('UPDATE tracker_vocabularies')`)
   - partial unique indexes on project name per workspace and phase name per project are
     scoped `WHERE deleted_at IS NULL`

   ```typescript
   // Appended to server/src/db/tracker-migration.test.ts (same file, same
   // schemaSql/readFileSync setup already at the top — do not redeclare it).
   describe("project, phase and item scheduling columns", () => {
     it("declares tracker_projects and tracker_phases with the required shape", () => {
       expect(schemaSql).toMatch(/CREATE TABLE IF NOT EXISTS tracker_projects/);
       expect(schemaSql).toMatch(/CREATE TABLE IF NOT EXISTS tracker_phases/);
       expect(schemaSql).toMatch(/tracker_projects[\s\S]*?position\s+DOUBLE PRECISION/);
       expect(schemaSql).toMatch(/tracker_projects[\s\S]*?deleted_at\s+TIMESTAMPTZ/);
       expect(schemaSql).toMatch(
         /tracker_phases[\s\S]*?project_id\s+INTEGER NOT NULL REFERENCES tracker_projects/,
       );
     });

     it("adds project_id, phase_id, dates, completed_at and position to tracker_items", () => {
       expect(schemaSql).toMatch(
         /ALTER TABLE tracker_items ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES tracker_projects/,
       );
       expect(schemaSql).toMatch(
         /ALTER TABLE tracker_items ADD COLUMN IF NOT EXISTS phase_id INTEGER REFERENCES tracker_phases/,
       );
       expect(schemaSql).toMatch(
         /ALTER TABLE tracker_items ADD COLUMN IF NOT EXISTS start_date DATE/,
       );
       expect(schemaSql).toMatch(
         /ALTER TABLE tracker_items ADD COLUMN IF NOT EXISTS end_date DATE/,
       );
       expect(schemaSql).toMatch(
         /ALTER TABLE tracker_items ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ/,
       );
       expect(schemaSql).toMatch(
         /ALTER TABLE tracker_items ADD COLUMN IF NOT EXISTS position DOUBLE PRECISION/,
       );
       // Nullable — the guarded backfill depends on this staying non-NOT-NULL.
       expect(schemaSql).not.toMatch(
         /ADD COLUMN IF NOT EXISTS position DOUBLE PRECISION NOT NULL/,
       );
     });

     it("adds a nullable category column to tracker_vocabularies", () => {
       expect(schemaSql).toMatch(
         /ALTER TABLE tracker_vocabularies ADD COLUMN IF NOT EXISTS category TEXT/,
       );
     });

     it("guards the position and category backfills with WHERE ... IS NULL", () => {
       const positionBackfill = schemaSql.match(
         /UPDATE tracker_items[\s\S]{0,500}?position[\s\S]{0,200}?;/,
       )?.[0];
       expect(positionBackfill).toBeTruthy();
       expect(positionBackfill).toMatch(/WHERE[\s\S]*position IS NULL/);
       expect(positionBackfill).toMatch(
         /PARTITION BY workspace_id,\s*project_id,\s*phase_id/,
       );

       const categoryBackfill = schemaSql.match(
         /-- tracker: category backfill[\s\S]{0,600}?UPDATE tracker_vocabularies[\s\S]{0,600}?category[\s\S]{0,300}?;/,
       )?.[0];
       expect(categoryBackfill).toBeTruthy();
       expect(categoryBackfill).toMatch(/WHERE[\s\S]*category IS NULL/);
     });

     it("maps every seeded status name to its category and catches the rest as backlog", () => {
       expect(schemaSql).toMatch(/Backlog[\s\S]{0,120}'backlog'/);
       expect(schemaSql).toMatch(/Todo[\s\S]{0,120}'backlog'/);
       expect(schemaSql).toMatch(/In Progress[\s\S]{0,120}'started'/);
       expect(schemaSql).toMatch(/Done[\s\S]{0,120}'completed'/);
       expect(schemaSql).toMatch(/Canceled[\s\S]{0,120}'canceled'/);
       // A grandfathered, never-listed status still gets categorised.
       expect(schemaSql).toMatch(
         /category\s*=\s*'backlog'[\s\S]{0,200}WHERE category IS NULL/,
       );
     });

     it("positions the category backfill after the retroactive vocabulary seed block", () => {
       const seedIndex = schemaSql.indexOf("INSERT INTO tracker_vocabularies");
       const categoryBackfillIndex = schemaSql.indexOf(
         "-- tracker: category backfill",
       );
       expect(seedIndex).toBeGreaterThan(-1);
       expect(categoryBackfillIndex).toBeGreaterThan(seedIndex);
     });

     it("scopes the project-name and phase-name partial unique indexes to live rows", () => {
       expect(schemaSql).toMatch(
         /CREATE UNIQUE INDEX IF NOT EXISTS[\s\S]{0,80}ON tracker_projects[\s\S]{0,80}lower\(name\)[\s\S]{0,80}WHERE deleted_at IS NULL/,
       );
       expect(schemaSql).toMatch(
         /CREATE UNIQUE INDEX IF NOT EXISTS[\s\S]{0,80}ON tracker_phases[\s\S]{0,80}lower\(name\)[\s\S]{0,80}WHERE deleted_at IS NULL/,
       );
     });

     it("never backfills or approximates completed_at", () => {
       expect(schemaSql).not.toMatch(/completed_at\s*=\s*updated_at/);
       const alterBlock = schemaSql.slice(schemaSql.indexOf("tracker_projects"));
       expect(alterBlock).not.toMatch(/UPDATE tracker_items[\s\S]*?completed_at\s*=\s*now\(\)/);
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- server/src/db/tracker-migration.test.ts`
   Expected failure: assertions report the new table/column strings are absent from schema.sql

3. Implement the schema block, appended **after** the existing seed block that currently
   ends the file at line 461:
   - `tracker_projects`: `id SERIAL PRIMARY KEY`, `workspace_id INTEGER NOT NULL REFERENCES
     workspaces(id) ON DELETE CASCADE`, `name TEXT NOT NULL`, `start_date DATE`,
     `end_date DATE`, `position DOUBLE PRECISION NOT NULL`, `version INTEGER NOT NULL
     DEFAULT 1`, `deleted_at TIMESTAMPTZ`, `created_at`/`updated_at TIMESTAMPTZ NOT NULL
     DEFAULT now()`
   - `tracker_phases`: same shape plus `project_id INTEGER NOT NULL REFERENCES
     tracker_projects(id) ON DELETE CASCADE`, `subtitle TEXT NOT NULL DEFAULT ''`; no
     `workspace_id` (reachable through the project)
   - `ALTER TABLE tracker_items ADD COLUMN IF NOT EXISTS` for: `project_id INTEGER
     REFERENCES tracker_projects(id) ON DELETE SET NULL`, `phase_id INTEGER REFERENCES
     tracker_phases(id) ON DELETE SET NULL`, `start_date DATE`, `end_date DATE`,
     `completed_at TIMESTAMPTZ`, `position DOUBLE PRECISION`
   - `ALTER TABLE tracker_vocabularies ADD COLUMN IF NOT EXISTS category TEXT`
   - Partial unique indexes: `(workspace_id, lower(name)) WHERE deleted_at IS NULL` on
     projects; `(project_id, lower(name)) WHERE deleted_at IS NULL` on phases
   - Supporting indexes: `tracker_projects (workspace_id, position) WHERE deleted_at IS
     NULL`; `tracker_phases (project_id, position) WHERE deleted_at IS NULL`;
     `tracker_items (project_id, phase_id, position) WHERE deleted_at IS NULL`
   - Guarded `category` backfill mapping seeded names to categories
     (Backlog/Todo → `backlog`, In Progress → `started`, Done → `completed`,
     Canceled → `canceled`) and every remaining status row → `backlog`, all
     `WHERE category IS NULL`, preceded by the marker comment
     `-- tracker: category backfill` (the test asserts on this marker)
   - Guarded `position` backfill assigning
     `row_number() OVER (PARTITION BY workspace_id, project_id, phase_id
     ORDER BY created_at, id) * 1024` `WHERE position IS NULL`
   - Do NOT backfill `completed_at` — it stays NULL by design

4. Run test — verify PASS:
   `npm run test -- server/src/db/tracker-migration.test.ts`
   Expected: PASS

5. Refactor while green (bounded):
   - Nothing to extract — this is SQL in one file. Confirm the block reads top-to-bottom as
     DDL → indexes → backfills, and say so.
   - Re-run: `npm run test -- server/src/db/tracker-migration.test.ts` — must stay PASS

6. Commit:
   `git add server/src/db/schema.sql server/src/db/tracker-migration.test.ts`
   `git commit -m "feat(tracker): add project, phase, schedule and ordering schema"`

## REFERENCES LOADED

docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md —
rules: Status semantics, Migration safety; GWT scenarios used as verification
server/src/db/schema.sql:355-461 — existing tracker DDL and the `DO $$ … WHERE NOT EXISTS`
seed idempotency pattern; calendar `DATE` columns on `cards` at :200-203 document why
`start_date`/`end_date` avoid timezone off-by-one
server/src/db/migrate.ts:9-18 — schema.sql is re-executed whole in one transaction on every
migrate; there is no migration-tracking table
server/src/db/tracker-migration.test.ts — the string/regex assertion convention this test extends

## WHY THIS APPROACH

Justification: two files, but the ordering and guard constraints are subtle and a mistake
here silently corrupts data on the second deploy rather than failing loudly.
Complexity: standard

## SANDWICH CONTEXT

[CRITICAL: every backfill MUST carry a `WHERE … IS NULL` guard, and the `category` backfill MUST be appended after the existing seed block — schema.sql re-runs in full on every migrate.]
You are implementing the schema migration for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — client-derived rollup; the schema stores facts, never computed progress.
Files in scope: `server/src/db/schema.sql`, `server/src/db/tracker-migration.test.ts` — no other files.
Test framework: Vitest, `npm run test -- <path>` from repo root. Schema is verified by string/regex assertion against the file, not a live database.
Available after: none (prereq)
Architecture rule: additive only. No existing column is altered or dropped, no existing row is rewritten, and nothing touches `workspaces.tracker_key_counter` or any Board table.
[RESTATE: every backfill MUST carry a `WHERE … IS NULL` guard, and the `category` backfill MUST be appended after the existing seed block — schema.sql re-runs in full on every migrate.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given the 5 seeded statuses, When the migration runs, Then Backlog and Todo have category `backlog`, In Progress `started`, Done `completed`, Canceled `canceled`
Given a workspace with a 6th status created before the lock, When the migration runs, Then that status has category `backlog`
Given the migration already ran once, When `make db-migrate` runs again, Then no category value changes and no status row is duplicated
Given tasks were manually reordered, When the migration runs again, Then no position value changes
Given the migration has run, When any item is read for ordering, Then its position is non-NULL
Given an item already in status Done, When the migration runs, Then `completed_at` stays NULL
Given a brand-new empty database, When the migration runs once, Then seeded statuses exist AND every one carries a category
Given a soft-deleted project named "Rilis v2", When a new project takes that name, Then the partial unique index permits it
[must-not] Given the migration runs, When it completes, Then no `tracker_items` row has changed `project_id` or `phase_id`, and no Board table is modified

All tests PASS. Commit exists with message matching `feat(tracker): …`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
  - Every backfill guarded with `WHERE … IS NULL`
  - `category` backfill positioned after the retroactive seed block, marked with
    `-- tracker: category backfill`
  - `position` backfill partitions by `(workspace_id, project_id, phase_id)`
  - `start_date`/`end_date` are `DATE`; `completed_at` is `TIMESTAMPTZ`; `position` is `DOUBLE PRECISION`
  - Partial unique indexes scoped `WHERE deleted_at IS NULL`
  - Tests written BEFORE the schema change (TDD — not after)
  - Commit message follows conventional commits format

Must-not-have:
  - Any `completed_at` backfill or approximation from `updated_at`
  - Any change to `workspaces.tracker_key_counter`
  - Any Board table change
  - `NOT NULL` on `tracker_items.position` (it must be nullable so the guard works)
  - Modifications to files outside the listed scope

Open question risks:
  - Assumption: no non-seeded statuses exist in production. If a real workspace has extras,
    they are silently categorised `backlog` → acceptable, but report DONE_WITH_CONCERNS if
    the migration shape makes that irreversible.

Rollback note:
  - This migration is additive; rollback is a deploy revert leaving nullable columns in place.

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - An unguarded `UPDATE` anywhere in the new block → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: an existing production workspace turns out to hold statuses that cannot be mapped to a category
Escalate when: the change requires altering an existing column, or any Board table appears in the diff

---

### Task 2: Shared contracts — Kysely table types and realtime event union [depends: T1]

## OBJECTIVE

Teach TypeScript about the new tables, columns, and SSE event types so every downstream
server task compiles against one agreed contract instead of inventing its own.

Files:
- Modify: `server/src/db/types.ts`
- Modify: `server/src/realtime.ts`
- Create: `server/src/db/tracker-contracts.smoke.ts` (compile-only; not imported at runtime)

Steps:

1. Write a failing typecheck-backed test is not applicable here — this is a type-only,
   structural task. Mark `[no-tdd — structural task]` and proceed:
   Add `TrackerProjects` and `TrackerPhases` interfaces to `server/src/db/types.ts`,
   register them on the `DB` interface beside `tracker_items` (currently line 341), and
   extend `TrackerItems` with `project_id: number | null`, `phase_id: number | null`,
   `start_date: string | null`, `end_date: string | null`,
   `completed_at: ColumnType<Date, …> | null`, `position: number | null`.
   Extend `TrackerVocabularies` with `category: string | null`.
   Follow the existing `Generated<…>` / `ColumnType<…>` conventions already used in the file.

2. Extend the tracker event union at `server/src/realtime.ts:59-62` with:
   `"tracker.project.created" | "tracker.project.updated" | "tracker.project.deleted" |
   "tracker.phase.created" | "tracker.phase.updated" | "tracker.phase.deleted"`

3. Add `server/src/db/tracker-contracts.smoke.ts` — a compile-only module that exercises
   the new contracts without runtime imports elsewhere:
   - `db.selectFrom("tracker_projects")` and `db.selectFrom("tracker_phases")` with a
     `.selectAll()` chain typed against `DB`
   - A `const _events` array assigning each new event name to a variable typed as the
     tracker slice of the realtime event union (import the event type from `realtime.ts`
     or inline a satisfies check)
   This file is included in `npm run typecheck` but never imported by application code.

4. Verify:
   `npm run typecheck`
   Expected: PASS with no errors. Then confirm the union is closed and exhaustive by
   grepping that no `as any` was introduced: `grep -n "as any" server/src/realtime.ts server/src/db/types.ts server/src/db/tracker-contracts.smoke.ts`
   Expected: no matches.

5. Commit:
   `git add server/src/db/types.ts server/src/realtime.ts server/src/db/tracker-contracts.smoke.ts`
   `git commit -m "chore(tracker): add project and phase types and event contracts"`

## REFERENCES LOADED

docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md —
rules: Realtime, Project lifecycle, Phase lifecycle; the event names consumed by T9, T10, T14, T15
server/src/db/types.ts:341 — where `tracker_items` is registered on the `DB` interface
server/src/realtime.ts:59-62 — the closed tracker event union; `publishEvent` will not
typecheck against a name outside it

## WHY THIS APPROACH

Justification: two files, no behaviour, but four later tasks (T9, T10, T14, T15) publish or
consume these names — without one anchor they diverge and the union rejects them.
Complexity: lightweight

## SANDWICH CONTEXT

[CRITICAL: the realtime event union is closed — any event name a later task publishes must exist here, or `publishEvent` will not typecheck.]
You are implementing the shared type and event contracts for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — the client derives rollup, so no aggregate types belong here.
Files in scope: `server/src/db/types.ts`, `server/src/realtime.ts`, `server/src/db/tracker-contracts.smoke.ts` — no other files.
Test framework: Vitest; this task is verified by `npm run typecheck`, not by a behavioural test.
Available after: T1 (the schema those types describe)
Architecture rule: types must mirror the schema exactly — `position` and the new item columns are NULLABLE, and `completed_at` is a timestamp while `start_date`/`end_date` are calendar dates.
[RESTATE: the realtime event union is closed — any event name a later task publishes must exist here, or `publishEvent` will not typecheck.]

## DELIVERABLE

Verification — task is DONE when all pass:

[derived] Given the new tables exist in schema.sql, When `npm run typecheck` runs, Then `db.selectFrom("tracker_projects")` and `db.selectFrom("tracker_phases")` compile
[derived] Given the extended item type, When code reads `row.project_id`, Then it is typed `number | null` and requires a null check
[derived] Given the extended union, When a route publishes `tracker.project.deleted`, Then it typechecks
[must-not] Given the new types, When they are added, Then no `as any` or `@ts-expect-error` is introduced to make them fit

All checks PASS. Commit exists with message matching `chore(tracker): …`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
  - Nullable columns typed nullable — especially `position`, which the guarded backfill leaves NULL until it runs
  - Event names exactly as listed; T9/T10/T14/T15 depend on these strings
  - Compile-only smoke file exercises every new table and event name under `npm run typecheck`
  - `[no-tdd — structural task]`

Must-not-have:
  - Aggregate/rollup fields on any type — rollup is derived client-side (Option B)
  - `as any`, `@ts-expect-error`, or loosening an existing type to fit
  - Modifications to files outside the listed scope

Open question risks:
  - none

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Any pre-existing type loosened rather than extended → STOP

## STOP CONDITIONS

Done when: `npm run typecheck` passes, commit created
Uncertain when: the schema from T1 disagrees with what the types need
Escalate when: making the types fit requires changing behaviour in any route

---

### Task 3: Vocabulary seeding at every workspace-creation path [depends: T2]

## OBJECTIVE

Create one shared seeding helper and call it inside all three workspace-creation
transactions, so no workspace can ever exist without tracker vocabulary — the failure the
status lock would otherwise make unfixable without a deploy.

Files:
- Create: `server/src/core/tracker-vocabulary-seed.ts`
- Test: `server/src/core/tracker-vocabulary-seed.test.ts`
- Modify: `server/src/db/schema.sql` (coupling comment only — no seed data changes)
- Modify: `server/src/routes/workspaces.ts`
- Modify: `server/src/auth.ts`
- Modify: `server/src/routes/oauth.ts`

Steps:

1. Write failing tests in `server/src/core/tracker-vocabulary-seed.test.ts` for:
   - `DEFAULT_TRACKER_VOCABULARY` exports exactly 5 statuses, 3 priorities, 3 labels
   - each status carries the correct category (Backlog/Todo `backlog`, In Progress
     `started`, Done `completed`, Canceled `canceled`)
   - positions are multiples of `POSITION_GAP` and strictly increasing within each kind
   - `seedTrackerVocabulary(trx, workspaceId)` issues one insert carrying all 11 rows with
     the given workspace id (assert against a mocked transaction builder, following the
     `vi.mock` convention in `server/src/routes/tracker-vocabularies.test.ts`)

   ```typescript
   // server/src/core/tracker-vocabulary-seed.test.ts
   import { describe, expect, it, vi } from "vitest";
   import {
     DEFAULT_TRACKER_VOCABULARY,
     seedTrackerVocabulary,
   } from "./tracker-vocabulary-seed.js";
   import { POSITION_GAP } from "./position.js";

   describe("DEFAULT_TRACKER_VOCABULARY", () => {
     it("has exactly 5 statuses, 3 priorities and 3 labels", () => {
       const byKind = (kind: string) =>
         DEFAULT_TRACKER_VOCABULARY.filter((row) => row.kind === kind);
       expect(byKind("status")).toHaveLength(5);
       expect(byKind("priority")).toHaveLength(3);
       expect(byKind("label")).toHaveLength(3);
     });

     it("assigns the correct category to every seeded status", () => {
       const byName = (name: string) =>
         DEFAULT_TRACKER_VOCABULARY.find(
           (row) => row.kind === "status" && row.name === name,
         );
       expect(byName("Backlog")?.category).toBe("backlog");
       expect(byName("Todo")?.category).toBe("backlog");
       expect(byName("In Progress")?.category).toBe("started");
       expect(byName("Done")?.category).toBe("completed");
       expect(byName("Canceled")?.category).toBe("canceled");
     });

     it("carries no category on priorities or labels", () => {
       for (const row of DEFAULT_TRACKER_VOCABULARY) {
         if (row.kind !== "status") {
           expect(row.category ?? null).toBeNull();
         }
       }
     });

     it("positions are multiples of POSITION_GAP and strictly increasing per kind", () => {
       for (const kind of ["status", "priority", "label"] as const) {
         const positions = DEFAULT_TRACKER_VOCABULARY.filter(
           (row) => row.kind === kind,
         ).map((row) => row.position);
         for (const p of positions) expect(p % POSITION_GAP).toBe(0);
         for (let i = 1; i < positions.length; i++) {
           expect(positions[i]).toBeGreaterThan(positions[i - 1]);
         }
       }
     });
   });

   describe("seedTrackerVocabulary", () => {
     it("issues one insert carrying all 11 rows tagged with the given workspace id", async () => {
       const execute = vi.fn().mockResolvedValue(undefined);
       const values = vi.fn().mockReturnValue({ execute });
       const insertInto = vi.fn().mockReturnValue({ values });
       const trx = { insertInto } as any;

       await seedTrackerVocabulary(trx, 42);

       expect(insertInto).toHaveBeenCalledWith("tracker_vocabularies");
       expect(insertInto).toHaveBeenCalledTimes(1);
       expect(values).toHaveBeenCalledTimes(1);
       const rows = values.mock.calls[0][0] as Array<{ workspace_id: number }>;
       expect(rows).toHaveLength(11);
       expect(rows.every((row) => row.workspace_id === 42)).toBe(true);
       expect(execute).toHaveBeenCalledOnce();
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- server/src/core/tracker-vocabulary-seed.test.ts`
   Expected failure: `Cannot find module './tracker-vocabulary-seed.js'`

3. Implement:
   - `server/src/core/tracker-vocabulary-seed.ts` exporting
     `DEFAULT_TRACKER_VOCABULARY` (the 11 rows: kind, name, position, colour, category —
     colours copied verbatim from the seed block in `schema.sql:438-452` so the two agree)
     and `seedTrackerVocabulary(trx: DBExecutor, workspaceId: number): Promise<void>`
   - Add a coupling comment at the top of the helper:
     `// Keep in sync with schema.sql retroactive seed (DO $$ block) and -- tracker: category backfill`
   - Add the same coupling comment on the `DO $$` block in `schema.sql` (one line above
     `FOR ws IN SELECT id FROM workspaces`)
   - Call it in `server/src/routes/workspaces.ts` inside the existing
     `db.transaction().execute()` immediately after the `workspace_members` insert
   - Call it in `server/src/auth.ts` after the personal-workspace insert (around :415)
   - Call it in `server/src/routes/oauth.ts` after the personal-workspace insert (around :75)
   - Change nothing else in those three files

4. Run test — verify PASS:
   `npm run test -- server/src/core/tracker-vocabulary-seed.test.ts`
   Then confirm nothing else broke: `npm run test` and `npm run typecheck`
   Expected: PASS

5. Refactor while green (bounded):
   - The three call sites must each be a single `await seedTrackerVocabulary(trx, ws.id)` —
     if any call site grew inline row literals, move them into the helper
   - Re-run: `npm run test` — must stay PASS

6. Commit:
   `git add server/src/core/tracker-vocabulary-seed.ts server/src/core/tracker-vocabulary-seed.test.ts server/src/db/schema.sql server/src/routes/workspaces.ts server/src/auth.ts server/src/routes/oauth.ts`
   `git commit -m "fix(tracker): seed vocabulary when a workspace is created"`

## REFERENCES LOADED

docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md —
rule: Status semantics (provisioning); the Context section documents why this is in scope
server/src/routes/workspaces.ts:85-102 — the creation transaction that inserts workspace +
membership and nothing else
server/src/auth.ts:44,405-435 and server/src/routes/oauth.ts:63-90 — the two personal-workspace
paths; both share `createSignupWorkspacePlan` for planning but perform their own inserts
server/src/db/schema.sql:432-461 — the retroactive seed whose names, positions and colours
this helper must match exactly
server/src/db/seed.ts:31-41 — dev-only workspace creation path; out of scope for this task
(the retroactive migrate block covers workspaces that exist at migrate time; production
paths are the three listed above)

## WHY THIS APPROACH

Justification: five files across two modules, and the helper is the single source of truth
three transactions depend on — a divergent copy in any one path reintroduces the bug.
Complexity: standard

## SANDWICH CONTEXT

[CRITICAL: seeding runs INSIDE the existing workspace-creation transaction — if seeding fails the whole workspace creation must roll back, because the status lock leaves no way to add vocabulary afterwards.]
You are implementing vocabulary provisioning for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — client-derived rollup; seeded categories are what make that derivation possible.
Files in scope: `server/src/core/tracker-vocabulary-seed.ts`, its test, `server/src/db/schema.sql` (comment only), `server/src/routes/workspaces.ts`, `server/src/auth.ts`, `server/src/routes/oauth.ts` — no other files.
Test framework: Vitest, tests beside source, `vi.mock` at top level for db access.
Available after: T2 (Kysely types carrying `category`)
Architecture rule: `workspaces.ts`, `auth.ts` and `oauth.ts` are in bounds for vocabulary seeding ONLY — no other behaviour in those files may change, and nothing may touch invite consumption, membership, or `tracker_key_counter`.
[RESTATE: seeding runs INSIDE the existing workspace-creation transaction — if seeding fails the whole workspace creation must roll back, because the status lock leaves no way to add vocabulary afterwards.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a member creates a workspace, When the transaction commits, Then that workspace already holds 5 statuses (carrying categories), 3 priorities and 3 labels
Given a user signs up by password, When the personal workspace is created, Then it holds the same seeded vocabulary
Given a user signs up by OAuth, When the personal workspace is created, Then it holds the same seeded vocabulary
Given vocabulary seeding fails, When workspace creation runs, Then the whole transaction rolls back and no workspace exists without vocabulary
Given a workspace created after this ships, When a member creates their first tracker item, Then `getBacklogStatusId` resolves and no "Backlog status not found" error occurs
Given both the creation-time seed and the migrate-time retroactive block have run, When a workspace is inspected, Then no vocabulary row is duplicated
[must-not] Given these three files, When they are modified, Then no behaviour other than vocabulary seeding changes

All tests PASS. Commit exists with message matching `fix(tracker): …`.

## QUALITY BAR

Must-have:
  - One helper, imported by all three call sites — never a copied row list
  - Names, positions, colours and categories identical to `schema.sql:438-452`
  - Coupling comments on both `tracker-vocabulary-seed.ts` and the `schema.sql` seed block
  - Seeding inside the existing transaction, not after it
  - Tests written BEFORE implementation
  - Commit message follows conventional commits format

Must-not-have:
  - A second definition of the default vocabulary anywhere
  - Any change to invite consumption, membership rows, or workspace naming
  - Seeding on a path that is not workspace creation (including `server/src/db/seed.ts` — dev-only, out of scope)
  - Modifications to files outside the listed scope

Open question risks:
  - If the retroactive block and this helper drift apart later, workspaces will differ by
    creation date — the coupling comments are the guard; report DONE_WITH_CONCERNS if they
    are missing from either side

Rollback note:
  - Reverting the deploy leaves seeded rows in place; they are indistinguishable from
    migrate-seeded rows and harmless.

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Seeding placed outside the transaction → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, `npm run test` and `npm run typecheck` green, commit created
Uncertain when: a creation path turns out not to have a transaction to join
Escalate when: seeding cannot be added without changing other behaviour in `auth.ts` or `oauth.ts`

---

### Task 4: Vocabulary route — category on the wire, status vocabulary closed [depends: T2] [parallel: T3]

## OBJECTIVE

Put `category` on every vocabulary payload and reject creation of new statuses, while
leaving priority and label creation open.

Files:
- Modify: `server/src/routes/tracker-vocabularies.ts`
- Test: `server/src/routes/tracker-vocabularies.test.ts`

Steps:

1. Update the two existing tests that still expect status creation to succeed — they
   conflict with the status lock and must change **before** the red phase:
   - `"creates status with fractional position between neighbors"` → rename to
     `"rejects status creation"`; expect 400 and assert the status row count is unchanged
   - `"rejects duplicate vocabulary name case-insensitively"` → change both POST bodies
     from `kind: "status"` to `kind: "label"` (keep the duplicate-name assertion)

2. Write failing tests in `server/src/routes/tracker-vocabularies.test.ts` for:
   - `GET /tracker/vocabularies?kind=status` returns rows each carrying `category`
   - `POST /tracker/vocabularies` with `kind: "status"` returns 400 and inserts nothing
   - `POST /tracker/vocabularies` with `kind: "label"` still returns 201
   - `POST /tracker/vocabularies` with `kind: "priority"` still returns 201

   ```typescript
   // Appended to server/src/routes/tracker-vocabularies.test.ts — reuses the
   // module-level `app`, `pool`, `WORKSPACE_ID` and setupFixtures/cleanup
   // already declared at the top of this file; do not redeclare them.
   describe.skipIf(!process.env.RUN_INTEGRATION)(
     "tracker vocabulary category + status lock",
     () => {
       it("returns rows carrying category for kind=status", async () => {
         const res = await request(app).get(
           `/api/workspaces/${WORKSPACE_ID}/tracker/vocabularies?kind=status`,
         );
         expect(res.status).toBe(200);
         expect(
           res.body.every((v: { category: unknown }) => "category" in v),
         ).toBe(true);
       });

       it("rejects creating a new status and inserts nothing", async () => {
         const before = await pool.query(
           `SELECT count(*)::int AS n FROM tracker_vocabularies WHERE workspace_id = $1 AND kind = 'status'`,
           [WORKSPACE_ID],
         );
         const res = await request(app)
           .post(`/api/workspaces/${WORKSPACE_ID}/tracker/vocabularies`)
           .send({ kind: "status", name: "Blocked", position: 1500 });
         expect(res.status).toBe(400);
         const after = await pool.query(
           `SELECT count(*)::int AS n FROM tracker_vocabularies WHERE workspace_id = $1 AND kind = 'status'`,
           [WORKSPACE_ID],
         );
         expect(after.rows[0].n).toBe(before.rows[0].n);
       });

       it("still allows label creation", async () => {
         const res = await request(app)
           .post(`/api/workspaces/${WORKSPACE_ID}/tracker/vocabularies`)
           .send({ kind: "label", name: "Docs", position: 4000 });
         expect(res.status).toBe(201);
       });

       it("still allows priority creation", async () => {
         const res = await request(app)
           .post(`/api/workspaces/${WORKSPACE_ID}/tracker/vocabularies`)
           .send({ kind: "priority", name: "Urgent", position: 4000 });
         expect(res.status).toBe(201);
       });
     },
   );
   ```

3. Run test — verify FAIL (requires PostgreSQL):
   `RUN_INTEGRATION=1 npm run test -- server/src/routes/tracker-vocabularies.test.ts`
   Expected failures: new suite reports `category` missing from GET rows; `"rejects status
   creation"` expects 400 but receives 201 (status lock not yet implemented)

4. Implement in `server/src/routes/tracker-vocabularies.ts`:
   - Add `"category"` to `RETURNING_COLUMNS` (:12-19)
   - Extend the `serializeVocabulary` row parameter type to include
     `category: string | null`, and add `category: row.category` to the return object
     (:25-41) — both the type and the mapping are required; the constant alone does not
     put the field on the wire
   - In the POST handler, immediately after `isVocabKind` passes, reject `kind === "status"`
     with `res.status(400).json({ error: "The status vocabulary is fixed." })`
   - Leave the unvalidated `statusId` path in `tracker-items.ts` alone — not this task, not this cycle

5. Run test — verify PASS:
   `RUN_INTEGRATION=1 npm run test -- server/src/routes/tracker-vocabularies.test.ts`
   Expected: PASS (entire file, including the updated legacy tests)

6. Refactor while green (bounded):
   - Nothing should need extracting; if the 400 branch grew beyond a guard clause, simplify it
   - Re-run: `RUN_INTEGRATION=1 npm run test -- server/src/routes/tracker-vocabularies.test.ts` — must stay PASS

7. Commit:
   `git add server/src/routes/tracker-vocabularies.ts server/src/routes/tracker-vocabularies.test.ts`
   `git commit -m "feat(tracker): expose status category and close the status vocabulary"`

## REFERENCES LOADED

docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md —
rule: Status semantics; the four-serialization-site note in Implementation Notes
server/src/routes/tracker-vocabularies.ts:12-19,25-41,70-156 — `RETURNING_COLUMNS`, the
separate hardcoded `serializeVocabulary` literal, and the POST handler
client/src/api.ts:514 — `createTrackerVocabulary` has no component caller, so closing status
creation removes no user-visible capability

## WHY THIS APPROACH

Justification: one route file plus its test, but the two-site serialization trap means a
single-site edit silently ships a payload the client cannot use.
Complexity: lightweight

## SANDWICH CONTEXT

[CRITICAL: `category` must be added in BOTH `RETURNING_COLUMNS` and `serializeVocabulary` — adding it to the constant alone leaves it off the wire.]
You are implementing the vocabulary contract change for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — the client derives rollup and glyphs from `category`, so the field must reach it.
Files in scope: `server/src/routes/tracker-vocabularies.ts` and its test — no other files.
Test framework: Vitest, `vi.mock` at top level, tests beside source. The entire test file
is gated `RUN_INTEGRATION=1` — always pass that env var when running this suite.
Available after: T2 (Kysely type carrying `category`)
Architecture rule: priority and label creation stay open; only `kind='status'` is closed. Do not touch the unvalidated `statusId` path in `tracker-items.ts` — it is deliberately out of scope.
[RESTATE: `category` must be added in BOTH `RETURNING_COLUMNS` and `serializeVocabulary` — adding it to the constant alone leaves it off the wire.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given `GET /tracker/vocabularies?kind=status`, When it responds, Then every row includes `category`
Given a member POSTs with `kind: "label"` and name "Docs", When applied, Then 201
Given a member POSTs with `kind: "priority"`, When applied, Then 201
[must-not] Given a member POSTs with `kind: "status"`, When attempted, Then 400 and no row is inserted
[must-not] Given this task, When it completes, Then `tracker-items.ts` is unchanged

All tests PASS. Commit exists with message matching `feat(tracker): …`.

## QUALITY BAR

Must-have:
  - Both serialization sites updated (`RETURNING_COLUMNS` and `serializeVocabulary` type + mapping)
  - Legacy status-creation tests updated in step 1 before the red phase
  - All test runs use `RUN_INTEGRATION=1`
  - 400 fires before any duplicate check or insert, so no row is written
  - Error copy follows the creative brief's neutral-friendly register
  - Tests written BEFORE implementation

Must-not-have:
  - Closing `priority` or `label` creation
  - Any change to `tracker-items.ts`
  - Modifications to files outside the listed scope

Open question risks:
  - Assumption: no non-seeded statuses exist in production. If wrong, they remain readable
    and categorised `backlog`; nothing here breaks.

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Priority or label creation rejected → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, `RUN_INTEGRATION=1` test run green, commit created
Uncertain when: PostgreSQL is unavailable so the integration suite cannot run — report NEEDS_CONTEXT
Escalate when: closing status creation breaks an unrelated caller outside this test file

---

### Task 5: Tracker item parsers — extract validators and add project/phase/date validation [depends: T2]

## OBJECTIVE

Extract the parse/validate helpers the new item logic needs out of the 213-line PATCH
handler, and add validators for the new fields, so T6/T7/T8 build on tested functions
instead of growing that handler further.

Files:
- Create: `server/src/routes/tracker-item-parsers.ts`
- Test: `server/src/routes/tracker-item-parsers.test.ts`
- Modify: `server/src/routes/tracker-items.ts`

Steps:

1. Write failing tests in `server/src/routes/tracker-item-parsers.test.ts` for:
   - `parseProjectPhase` returns `{projectId, phaseId}` when a phase is given alone, deriving the project from the phase
   - `parseProjectPhase` nulls `phase_id` when `projectId` alone is supplied
   - `parseProjectPhase` clears BOTH ids when `{projectId: null}` is supplied with no `phaseId`
   - `parseProjectPhase` returns an error for `{projectId: null, phaseId: X}`
   - `parseProjectPhase` returns an error when the phase belongs to another project
   - `parseProjectPhase` returns an error for a cross-workspace, soft-deleted, or nonexistent id
   - `parseDateRange` accepts a valid `YYYY-MM-DD` pair, accepts start-only, accepts both null
   - `parseDateRange` returns an error when end precedes start, and when a string is not a calendar date

   ```typescript
   // server/src/routes/tracker-item-parsers.test.ts
   import { beforeEach, describe, expect, it, vi } from "vitest";

   const { mockExecuteTakeFirst } = vi.hoisted(() => ({
     mockExecuteTakeFirst: vi.fn(),
   }));

   vi.mock("../db/kysely.js", () => ({
     db: {
       selectFrom: vi.fn(() => {
         const chain: any = {};
         chain.select = vi.fn(() => chain);
         chain.where = vi.fn(() => chain);
         chain.executeTakeFirst = mockExecuteTakeFirst;
         return chain;
       }),
     },
   }));

   import { parseDateRange, parseProjectPhase } from "./tracker-item-parsers.js";

   describe("parseProjectPhase", () => {
     beforeEach(() => mockExecuteTakeFirst.mockReset());

     it("derives project_id from phaseId when only a phase is given", async () => {
       mockExecuteTakeFirst
         .mockResolvedValueOnce({ id: 5, project_id: 2 }) // phase lookup
         .mockResolvedValueOnce({ id: 2 }); // project lookup (workspace-scoped, not deleted)

       const result = await parseProjectPhase({ phaseId: 5 }, 7);
       expect(result).toEqual({ projectId: 2, phaseId: 5 });
     });

     it("nulls phase_id when projectId alone is supplied", async () => {
       mockExecuteTakeFirst.mockResolvedValueOnce({ id: 2 }); // project lookup
       const result = await parseProjectPhase({ projectId: 2 }, 7);
       expect(result).toEqual({ projectId: 2, phaseId: null });
     });

     it("clears both ids when {projectId: null} is supplied with no phaseId", async () => {
       const result = await parseProjectPhase({ projectId: null }, 7);
       expect(result).toEqual({ projectId: null, phaseId: null });
       expect(mockExecuteTakeFirst).not.toHaveBeenCalled();
     });

     it("returns an error for {projectId: null, phaseId: X}", async () => {
       const result = await parseProjectPhase(
         { projectId: null, phaseId: 5 },
         7,
       );
       expect(result).toEqual({ error: expect.any(String) });
     });

     it("returns an error when the phase belongs to another project", async () => {
       mockExecuteTakeFirst.mockResolvedValueOnce({ id: 5, project_id: 2 }); // phase lookup
       const result = await parseProjectPhase({ projectId: 9, phaseId: 5 }, 7);
       expect(result).toEqual({ error: expect.any(String) });
     });

     it("returns an error for a cross-workspace, soft-deleted or nonexistent project id", async () => {
       mockExecuteTakeFirst.mockResolvedValueOnce(undefined); // project lookup misses
       const result = await parseProjectPhase({ projectId: 999 }, 7);
       expect(result).toEqual({ error: expect.any(String) });
     });

     it("returns an error for a cross-workspace, soft-deleted or nonexistent phase id", async () => {
       mockExecuteTakeFirst.mockResolvedValueOnce(undefined); // phase lookup misses
       const result = await parseProjectPhase({ phaseId: 999 }, 7);
       expect(result).toEqual({ error: expect.any(String) });
     });
   });

   describe("parseDateRange", () => {
     it("accepts a valid YYYY-MM-DD pair", () => {
       const result = parseDateRange({
         startDate: "2026-09-21",
         endDate: "2026-09-30",
       });
       expect(result).toEqual({ startDate: "2026-09-21", endDate: "2026-09-30" });
     });

     it("accepts start-only", () => {
       const result = parseDateRange({ startDate: "2026-09-21" });
       expect(result).toEqual({ startDate: "2026-09-21", endDate: null });
     });

     it("accepts both null", () => {
       const result = parseDateRange({ startDate: null, endDate: null });
       expect(result).toEqual({ startDate: null, endDate: null });
     });

     it("returns an error when end precedes start", () => {
       const result = parseDateRange({
         startDate: "2026-09-30",
         endDate: "2026-09-21",
       });
       expect(result).toEqual({ error: expect.any(String) });
     });

     it("returns an error when a string is not a calendar date", () => {
       const result = parseDateRange({ startDate: "not-a-date" });
       expect(result).toEqual({ error: expect.any(String) });
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- server/src/routes/tracker-item-parsers.test.ts`
   Expected failure: `Cannot find module './tracker-item-parsers.js'`

3. Implement:
   - Create `server/src/routes/tracker-item-parsers.ts` and MOVE `parseAssigneeIds` and
     `parseLabelIds` there unchanged from `tracker-items.ts:220-320`, re-exporting so the
     existing call sites keep working
   - Add `parseProjectPhase(body, workspaceId)` returning `{projectId, phaseId}` or
     `{error}`; it verifies the project belongs to this workspace and is not soft-deleted,
     and that the phase belongs to the resolved project and is not soft-deleted — mirroring
     the shape of `parseLabelIds` exactly. It must NOT copy the unvalidated `statusId` style
   - Add `parseDateRange(body)` returning `{startDate, endDate}` or `{error}` synchronously
     (no DB access); dates are `YYYY-MM-DD` strings compared lexically, never `Date`
     objects, mirroring `client/src/lib/boardViewUtils.ts:44-49`
   - Update `tracker-items.ts` imports to pull the moved helpers from the new module.
     Do NOT otherwise restructure that file, and do NOT change the PATCH handler's behaviour yet

4. Run test — verify PASS:
   `npm run test -- server/src/routes/tracker-item-parsers.test.ts`
   Then prove the extraction changed no behaviour — this suite is gated and does NOT run
   under the default test command, so run it explicitly:
   `RUN_INTEGRATION=1 npm run test -- server/src/routes/tracker-items.integration.test.ts`
   Expected: PASS (requires a running PostgreSQL — start it with `npm run db:up` if needed)

5. Refactor while green (bounded):
   - If any validator repeats the "select one row, check workspace, check not deleted" shape
     a third time, extract a single private helper inside the parsers module
   - Re-run: `npm run test -- server/src/routes/tracker-item-parsers.test.ts` — must stay PASS

6. Commit:
   `git add server/src/routes/tracker-item-parsers.ts server/src/routes/tracker-item-parsers.test.ts server/src/routes/tracker-items.ts`
   `git commit -m "refactor(tracker): extract item parsers and add project, phase and date validation"`

## REFERENCES LOADED

docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md —
rules: Project / phase assignment, Scheduling; the Implementation Note requiring a targeted
extraction rather than a whole-file reorganization
server/src/routes/tracker-items.ts:228-239 — `parseLabelIds`, the validated precedent
(workspace + kind checked) that new validators must mirror
server/src/routes/tracker-items.ts:295-300 — `parseAssigneeIds`, membership validation
server/src/routes/tracker-items.ts:513-726 — the 213-line PATCH handler this extraction keeps from growing
server/src/routes/tracker-items.integration.test.ts:2 — gated `RUN_INTEGRATION=1`; it does
not run under `npm run test`
client/src/lib/boardViewUtils.ts:44-49 — lexical ISO date comparison, the timezone-safe precedent

## WHY THIS APPROACH

Justification: three files, and every later server task imports these validators — a wrong
contract here propagates into T6, T7, T8, T9 and T10.
Complexity: standard

## SANDWICH CONTEXT

[CRITICAL: this is a TARGETED extraction — move only the helpers the new code needs and change no PATCH behaviour. A whole-file reorganization is explicitly out of scope.]
You are implementing the shared item parsers for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — validation lives on the server; derivation lives on the client.
Files in scope: `server/src/routes/tracker-item-parsers.ts`, its test, `server/src/routes/tracker-items.ts` — no other files.
Test framework: Vitest. The integration suite is gated `RUN_INTEGRATION=1` and will not run itself.
Available after: T2 (Kysely types for the new columns)
Architecture rule: new foreign keys follow `parseLabelIds` — verify the row belongs to this workspace and is not soft-deleted. Never copy the unvalidated `statusId` path at `tracker-items.ts:551-556`; leave that hole exactly as it is.
[RESTATE: this is a TARGETED extraction — move only the helpers the new code needs and change no PATCH behaviour. A whole-file reorganization is explicitly out of scope.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a PATCH body with `phaseId` X and no `projectId`, When parsed, Then `project_id` is derived from X
Given a body with `projectId` P2 and no `phaseId` on a task currently in a phase, When parsed, Then `phase_id` resolves to null
Given a valid `start` 2026-09-21 and `end` 2026-09-30, When parsed, Then both are returned as `YYYY-MM-DD` strings
Given start only and no end, When parsed, Then it is accepted
[must-not] Given `{projectId: null, phaseId: X}`, When parsed, Then an error is returned
[must-not] Given a phase belonging to another project, When parsed, Then an error is returned
[must-not] Given a cross-workspace, soft-deleted, or nonexistent project or phase id, When parsed, Then an error is returned
[must-not] Given start 2026-09-30 and end 2026-09-21, When parsed, Then an error is returned
[must-not] Given this extraction, When it completes, Then the PATCH handler's observable behaviour is unchanged and the gated integration suite still passes

All tests PASS. Commit exists with message matching `refactor(tracker): …`.

## QUALITY BAR

Must-have:
  - `RUN_INTEGRATION=1 npm run test -- server/src/routes/tracker-items.integration.test.ts` run and passing — it is not automatic
  - New validators mirror `parseLabelIds`: workspace-scoped and soft-delete aware
  - `parseDateRange` is synchronous; dates handled as `YYYY-MM-DD` strings, compared lexically
  - Tests written BEFORE implementation

Must-not-have:
  - A whole-file reorganization of `tracker-items.ts`
  - Any behaviour change to the PATCH handler in this task
  - Any fix to the unvalidated `statusId` path
  - Modifications to files outside the listed scope

Open question risks:
  - none

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Gated integration suite skipped → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, gated integration suite passes, commit created
Uncertain when: PostgreSQL is unavailable so the gated suite cannot run — report NEEDS_CONTEXT rather than skipping it
Escalate when: extraction cannot be done without changing PATCH behaviour

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 2 ONLY after this gate passes.
