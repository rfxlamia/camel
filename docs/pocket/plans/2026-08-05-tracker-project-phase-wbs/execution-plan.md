# EXECUTION PLAN — Tracker Project / Phase / WBS

**Date:** 2026-08-05
**Spec:** docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
**GitHub issue:** #94
**Status:** draft
**Total tasks:** 18

---

## Execution Overview

### Recommended Order

```
T1 → T2 → T3, T4, T5 (parallel) → T6, T9 (parallel) → T7, T10 (parallel) → T8, T11
   → T12, T13, T16 (parallel) → T14, T15 (parallel) → T18 → T17
```

> Dependency order above is **recommended** — pocket-development enforces actual
> parallelism and sequencing based on its routing logic.

### Parallelizable Groups

| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T3, T4, T5 | T2 completes |
| Group B | T6, T9 | T5 completes |
| Group C | T7, T10 | T6 and T9 complete |
| Group D | T12, T13, T16 | T11 completes |
| Group E | T14, T15 | T12 and T13 complete |

**Serialization warnings — two file-contention chains that must NOT be parallelized
regardless of what the dependency graph permits:**

1. **T5 → T6 → T7 → T8** all modify `server/src/routes/tracker-items.ts`.
2. **T15 → T18 → T17** all modify `client/src/pages/TrackerProjectPage.tsx`,
   `client/src/components/tracker/TrackerPhaseSection.tsx` and
   `client/src/pages/TrackerProjectPage.test.tsx`. T17 is ordered last because it is the
   cuttable task — nothing depends on it, so dropping it costs nothing downstream.

Two subagents editing any of those files concurrently will conflict.

### Constraints Reminder

**Architecture:**
- Board is untouched: no changes to Board rendering, card/column mutation paths,
  `card_events`, `recordActivity()`, or `server/src/routes/activity.ts`
- `server/src/routes/workspaces.ts`, `server/src/auth.ts`, `server/src/routes/oauth.ts`
  are in bounds for **vocabulary seeding only** — no other behaviour in those files changes
- Every mutation calls `recordTrackerActivity()`; every stale write returns HTTP 409;
  every read filters `deleted_at`
- Server imports use NodeNext `.js` extensions; client imports use no extension
- All routes mount behind `requireWorkspaceMember`
- Fractional ordering uses `server/src/core/position.ts` — never integer positions
- `schema.sql` re-executes in full on every `make db-migrate` (`migrate.ts:9-18`), so every
  backfill carries a `WHERE … IS NULL` guard

**Out-of-scope (no task may touch):**
- Comments or attachments on tracker items
- Roadmap / Gantt timeline rendering
- Any Board change
- Tracker ↔ card linkage
- Per-project status vocabularies
- Re-keying items under a project prefix; nothing may touch `workspaces.tracker_key_counter`
- Changelog UI for project/phase events
- The unvalidated `statusId` path at `tracker-items.ts:551-556` — a known pre-existing hole,
  deliberately left alone
- UI for `tracker_projects.start_date` / `end_date` / `position` — those columns ship unused

**Assumptions at risk:**
- No non-seeded statuses exist in production → if wrong, a few rows silently count as
  `backlog` in rollups
- The grandfather branch cannot be exercised through the API after the lock ships → its
  test must insert the row via direct SQL
- Project date columns ship unused → if a surface starts reading them mid-cycle, re-plan

**Sequencing:** Dependency order shown is recommended only — pocket-development enforces
actual blocking rules. The `tracker-items.ts` serialization above is the one hard lock.

**Preflight findings that bind this plan:**
- `date-fns` is NOT used. Overdue compares ISO date strings lexically and date display
  parses `"YYYY-MM-DD"` by split, mirroring `client/src/lib/boardViewUtils.ts:31-34,44-49`
  and the reasoning recorded at `schema.sql:200`
- dnd-kit here is the **legacy preset API** (`@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable`
  10.0.0): `SortableContext` + `verticalListSortingStrategy` + `arrayMove`. The newer
  `@dnd-kit/react` `useSortable` API does not apply
- Column types follow precedent: `start_date`/`end_date` `DATE`, `completed_at`
  `TIMESTAMPTZ`, `position` `DOUBLE PRECISION`
- `client/src/lib/trackerUtils.ts` currently has no test file; this plan creates one

### File Structure Map

```
Rule: Status semantics + Migration safety
  Modify: server/src/db/schema.sql                              (T1 — appended after line 461)
  Modify: server/src/db/types.ts                                (T2)
  Test:   server/src/db/tracker-migration.test.ts               (T1)

Rule: Status semantics — provisioning
  Create: server/src/core/tracker-vocabulary-seed.ts            (created by: T3)
  Test:   server/src/core/tracker-vocabulary-seed.test.ts       (created by: T3)
  Modify: server/src/routes/workspaces.ts                       (T3)
  Modify: server/src/auth.ts                                    (T3)
  Modify: server/src/routes/oauth.ts                            (T3)

Rule: Status semantics — category on the wire, status lock
  Modify: server/src/routes/tracker-vocabularies.ts             (T4)
  Test:   server/src/routes/tracker-vocabularies.test.ts        (T4)

Rule: Project / phase assignment + Scheduling (shared validators)
  Create: server/src/routes/tracker-item-parsers.ts             (created by: T5)
  Test:   server/src/routes/tracker-item-parsers.test.ts        (created by: T5)
  Modify: server/src/routes/tracker-items.ts                    (T5, T6, T7, T8 — serialized)

Rule: Home and project page (read contract)
  Modify: server/src/routes/tracker-items.ts                    (T6)
  Test:   server/src/routes/tracker-items.serialize.test.ts     (created by: T6)

Rule: Project / phase assignment + Scheduling + Ordering (write path)
  Modify: server/src/routes/tracker-items.ts                    (T7, T8)
  Test:   server/src/routes/tracker-items.write.test.ts         (created by: T7)
  Test:   server/src/routes/tracker-items.reorder.test.ts       (created by: T8)

Rule: Project lifecycle
  Create: server/src/routes/tracker-projects.ts                 (created by: T9)
  Test:   server/src/routes/tracker-projects.test.ts            (created by: T9)
  Modify: server/src/routes.ts                                  (T9, T10)

Rule: Phase lifecycle
  Create: server/src/routes/tracker-phases.ts                   (created by: T10)
  Test:   server/src/routes/tracker-phases.test.ts              (created by: T10)

Rule: Realtime (event contract)
  Modify: server/src/realtime.ts                                (T2)

Rule: Home and project page (client contract)
  Modify: client/src/types.ts                                   (T11)
  Modify: client/src/api.ts                                     (T11)
  Test:   client/src/api.tracker.test.ts                        (T11)

Rule: Rollup + Overdue (derivation)
  Create: client/src/lib/trackerRollup.ts                       (created by: T12)
  Test:   client/src/lib/trackerRollup.test.ts                  (created by: T12)
  Create: client/src/lib/trackerUtils.test.ts                   (created by: T12)

Rule: Status semantics — glyphs
  Modify: client/src/components/tracker/TrackerGlyphs.tsx       (T13)
  Test:   client/src/components/tracker/TrackerGlyphs.test.ts   (T13)

Rule: Home and project page — home
  Modify: client/src/pages/TrackerPage.tsx                      (T14)
  Create: client/src/components/tracker/TrackerProjectCard.tsx  (created by: T14)
  Create: client/src/components/tracker/TrackerProgressBar.tsx  (created by: T14)
  Create: client/src/components/tracker/TrackerProjectCreateModal.tsx (created by: T14)
  Test:   client/src/pages/TrackerPage.test.tsx                 (T14)

Rule: Home and project page — project WBS
  Create: client/src/pages/TrackerProjectPage.tsx               (created by: T15)
  Create: client/src/components/tracker/TrackerPhaseSection.tsx (created by: T15)
  Test:   client/src/pages/TrackerProjectPage.test.tsx          (created by: T15)
  Modify: client/src/App.tsx                                    (T15)

Rule: Project lifecycle + Phase lifecycle — management UI
  Modify: client/src/pages/TrackerProjectPage.tsx               (T18)
  Modify: client/src/components/tracker/TrackerPhaseSection.tsx (T18)
  Create: client/src/components/tracker/TrackerPhaseEditor.tsx  (created by: T18)
  Test:   client/src/pages/TrackerProjectPage.test.tsx          (T18)

Rule: Scheduling — shared date input
  Create: client/src/components/tracker/TrackerDateFields.tsx   (created by: T16, unconditional)

Conditional extractions (only if a refactor step's threshold is crossed; not deliverables)
  Create: client/src/lib/trackerConflict.ts                     (conditional, T18)
  Create: client/src/components/tracker/TrackerProjectHeader.tsx (conditional, T18)
  Create: client/src/lib/trackerCollapse.ts                     (conditional, T15)
  Create: client/src/lib/trackerOptimistic.ts                   (conditional, T17)
  Create: server/src/routes/tracker-project-delete.ts           (conditional, T9)

Rule: Scheduling (input surfaces)
  Modify: client/src/components/tracker/TrackerCreateModal.tsx  (T16)
  Modify: client/src/pages/TrackerDetailPage.tsx                (T16)
  Test:   client/src/components/tracker/TrackerCreateModal.test.tsx (T16)
  Test:   client/src/pages/TrackerDetailPage.test.tsx           (T16)

Rule: Ordering (UI half — cuttable)
  Modify: client/src/pages/TrackerProjectPage.tsx               (T17)
  Modify: client/src/components/tracker/TrackerPhaseSection.tsx (T17)
  Test:   client/src/pages/TrackerProjectPage.test.tsx          (T17)
```

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
   - the `category` backfill appears **after** the retroactive vocabulary seed block
     (assert on index order: `schemaSql.indexOf(categoryBackfillMarker) >
     schemaSql.indexOf('INSERT INTO tracker_vocabularies')`)
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
         /UPDATE tracker_items[\s\S]{0,400}?position[\s\S]{0,200}?;/,
       )?.[0];
       expect(positionBackfill).toBeTruthy();
       expect(positionBackfill).toMatch(/WHERE[\s\S]*position IS NULL/);

       const categoryBackfill = schemaSql.match(
         /UPDATE tracker_vocabularies[\s\S]{0,600}?category[\s\S]{0,300}?;/,
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
         "UPDATE tracker_vocabularies",
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
     `WHERE category IS NULL`
   - Guarded `position` backfill assigning `row_number() OVER (PARTITION BY workspace_id
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
server/src/db/schema.sql:355-461 — existing tracker DDL, the `DO $$ … WHERE NOT EXISTS`
seed idempotency pattern, and `due_date DATE` at :200 documenting why calendar dates avoid
timezone off-by-one
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
  - `category` backfill positioned after the retroactive seed block
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

3. Verify:
   `npm run typecheck`
   Expected: PASS with no errors. Then confirm the union is closed and exhaustive by
   grepping that no `as any` was introduced: `grep -n "as any" server/src/realtime.ts server/src/db/types.ts`
   Expected: no matches.

4. Commit:
   `git add server/src/db/types.ts server/src/realtime.ts`
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
Files in scope: `server/src/db/types.ts`, `server/src/realtime.ts` — no other files.
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
   `git add server/src/core/tracker-vocabulary-seed.ts server/src/core/tracker-vocabulary-seed.test.ts server/src/routes/workspaces.ts server/src/auth.ts server/src/routes/oauth.ts`
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

## WHY THIS APPROACH

Justification: five files across two modules, and the helper is the single source of truth
three transactions depend on — a divergent copy in any one path reintroduces the bug.
Complexity: standard

## SANDWICH CONTEXT

[CRITICAL: seeding runs INSIDE the existing workspace-creation transaction — if seeding fails the whole workspace creation must roll back, because the status lock leaves no way to add vocabulary afterwards.]
You are implementing vocabulary provisioning for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — client-derived rollup; seeded categories are what make that derivation possible.
Files in scope: `server/src/core/tracker-vocabulary-seed.ts`, its test, `server/src/routes/workspaces.ts`, `server/src/auth.ts`, `server/src/routes/oauth.ts` — no other files.
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
  - Seeding inside the existing transaction, not after it
  - Tests written BEFORE implementation
  - Commit message follows conventional commits format

Must-not-have:
  - A second definition of the default vocabulary anywhere
  - Any change to invite consumption, membership rows, or workspace naming
  - Seeding on a path that is not workspace creation
  - Modifications to files outside the listed scope

Open question risks:
  - If the retroactive block and this helper drift apart later, workspaces will differ by
    creation date → note the coupling in a comment on both sides

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

1. Write failing tests in `server/src/routes/tracker-vocabularies.test.ts` for:
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

2. Run test — verify FAIL:
   `npm run test -- server/src/routes/tracker-vocabularies.test.ts`
   Expected failure: `category` missing from the serialized row; POST with `kind: "status"` returns 201

3. Implement in `server/src/routes/tracker-vocabularies.ts`:
   - Add `"category"` to `RETURNING_COLUMNS` (:12-19)
   - Add `category: row.category` to `serializeVocabulary` (:25-41) — both edits are
     required; the constant alone does not put the field on the wire
   - In the POST handler, immediately after `isVocabKind` passes, reject `kind === "status"`
     with `res.status(400).json({ error: "The status vocabulary is fixed." })`
   - Leave the unvalidated `statusId` path in `tracker-items.ts` alone — not this task, not this cycle

4. Run test — verify PASS:
   `npm run test -- server/src/routes/tracker-vocabularies.test.ts`
   Expected: PASS

5. Refactor while green (bounded):
   - Nothing should need extracting; if the 400 branch grew beyond a guard clause, simplify it
   - Re-run: `npm run test -- server/src/routes/tracker-vocabularies.test.ts` — must stay PASS

6. Commit:
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
Test framework: Vitest, `vi.mock` at top level, tests beside source.
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
  - Both serialization sites updated
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

Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: an existing test asserts that status creation succeeds
Escalate when: closing status creation breaks an unrelated caller

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
     it("accepts a valid YYYY-MM-DD pair", async () => {
       const result = await parseDateRange({
         startDate: "2026-09-21",
         endDate: "2026-09-30",
       });
       expect(result).toEqual({ startDate: "2026-09-21", endDate: "2026-09-30" });
     });

     it("accepts start-only", async () => {
       const result = await parseDateRange({ startDate: "2026-09-21" });
       expect(result).toEqual({ startDate: "2026-09-21", endDate: null });
     });

     it("accepts both null", async () => {
       const result = await parseDateRange({ startDate: null, endDate: null });
       expect(result).toEqual({ startDate: null, endDate: null });
     });

     it("returns an error when end precedes start", async () => {
       const result = await parseDateRange({
         startDate: "2026-09-30",
         endDate: "2026-09-21",
       });
       expect(result).toEqual({ error: expect.any(String) });
     });

     it("returns an error when a string is not a calendar date", async () => {
       const result = await parseDateRange({ startDate: "not-a-date" });
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
   - Add `parseDateRange(body)` returning `{startDate, endDate}` or `{error}`; dates are
     `YYYY-MM-DD` strings compared lexically, never `Date` objects, mirroring
     `client/src/lib/boardViewUtils.ts:44-49`
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
  - Dates handled as `YYYY-MM-DD` strings, compared lexically
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

### Task 12: Rollup and schedule derivation helper [depends: T11]

## OBJECTIVE

Create the single derivation module every UI surface uses for progress, date bounds and
overdue — the one place Option B's correctness lives.

Files:
- Create: `client/src/lib/trackerRollup.ts`
- Test: `client/src/lib/trackerRollup.test.ts`
- Test: `client/src/lib/trackerUtils.test.ts`

Steps:

1. Write failing tests in `client/src/lib/trackerRollup.test.ts` for:
   - `rollup` of 5 completed / 2 canceled / 3 started returns 63% with counts 5 of 8
   - all-canceled returns the `no-active-work` state with no percentage
   - zero tasks returns the `no-tasks` state with no percentage
   - 8 completed / 2 canceled / 0 open returns 100%
   - a project rollup counts its phase-less tasks
   - `isTaskOverdue` is true for a past end date with a live status, false for `completed`,
     false for `canceled`, false with no end date, false when end equals today
   - `phaseBounds` returns derived `MIN`/`MAX` when no explicit date is set
   - `phaseBounds` honours an explicit start with a derived end (per-field fallback)
   - `isPhaseOverdue` is false when a past explicit end has all tasks completed or canceled
   - `isPhaseOverdue` is true for a past explicit end with zero tasks
   - `isProjectOverdue` inherits from a date-only overdue phase
   And in `client/src/lib/trackerUtils.test.ts`, lock the existing behaviour that had no
   tests: `sortStatusesByPosition`, `sortItemsOldestFirst`, `groupItemsByStatus`

   ```typescript
   // client/src/lib/trackerRollup.test.ts
   import { afterEach, describe, expect, it, vi } from "vitest";
   import type {
     TrackerItem,
     TrackerPhase,
     TrackerProject,
     TrackerStatusCategory,
   } from "../types";
   import {
     isPhaseOverdue,
     isProjectOverdue,
     isTaskOverdue,
     phaseBounds,
     rollup,
   } from "./trackerRollup";

   let nextId = 1;

   function taskItem(
     category: TrackerStatusCategory,
     overrides: Partial<TrackerItem> = {},
   ): TrackerItem {
     const id = nextId++;
     return {
       id,
       key: `CA-${id}`,
       title: "Task",
       description: "",
       status: {
         id: 1,
         kind: "status",
         name: "Status",
         position: 1024,
         colour: "#ccc",
         category,
       },
       priority: null,
       labels: [],
       assignees: [],
       version: 1,
       createdAt: "2026-08-01T00:00:00.000Z",
       updatedAt: "2026-08-01T00:00:00.000Z",
       projectId: null,
       phaseId: null,
       startDate: null,
       endDate: null,
       completedAt: null,
       position: 1024,
       ...overrides,
     };
   }

   function phase(overrides: Partial<TrackerPhase> = {}): TrackerPhase {
     return {
       id: 9,
       projectId: 1,
       name: "Phase",
       subtitle: "",
       startDate: null,
       endDate: null,
       position: 1024,
       version: 1,
       createdAt: "2026-08-01T00:00:00.000Z",
       updatedAt: "2026-08-01T00:00:00.000Z",
       ...overrides,
     };
   }

   function project(overrides: Partial<TrackerProject> = {}): TrackerProject {
     return {
       id: 1,
       name: "Project",
       startDate: null,
       endDate: null,
       position: 1024,
       version: 1,
       phases: [],
       createdAt: "2026-08-01T00:00:00.000Z",
       updatedAt: "2026-08-01T00:00:00.000Z",
       ...overrides,
     };
   }

   describe("rollup", () => {
     it("reports 63% for 5 completed, 2 canceled and 3 started", () => {
       const items = [
         ...Array.from({ length: 5 }, () => taskItem("completed")),
         ...Array.from({ length: 2 }, () => taskItem("canceled")),
         ...Array.from({ length: 3 }, () => taskItem("started")),
       ];
       const result = rollup(items);
       expect(result).toMatchObject({ kind: "percent", completed: 5, total: 8 });
       if (result.kind === "percent") {
         expect(Math.round(result.ratio * 100)).toBe(63);
       }
     });

     it("returns no-active-work when every task is canceled", () => {
       const items = [taskItem("canceled"), taskItem("canceled")];
       expect(rollup(items)).toEqual({ kind: "no-active-work" });
     });

     it("returns no-tasks for an empty list", () => {
       expect(rollup([])).toEqual({ kind: "no-tasks" });
     });

     it("reports 100% when every non-canceled task is completed", () => {
       const items = [
         ...Array.from({ length: 8 }, () => taskItem("completed")),
         ...Array.from({ length: 2 }, () => taskItem("canceled")),
       ];
       const result = rollup(items);
       expect(result).toMatchObject({ kind: "percent", completed: 8, total: 8 });
     });

     it("counts phase-less tasks when the caller scopes items to a project", () => {
       const proj = project({ id: 5 });
       const allItems = [
         taskItem("completed", { projectId: 5, phaseId: null }),
         taskItem("started", { projectId: 5, phaseId: 9 }),
         taskItem("started", { projectId: 99, phaseId: null }),
       ];
       const scoped = allItems.filter((i) => i.projectId === proj.id);
       const result = rollup(scoped);
       expect(result).toMatchObject({ kind: "percent", completed: 1, total: 2 });
     });
   });

   describe("isTaskOverdue", () => {
     afterEach(() => vi.useRealTimers());

     it("is true for a past end date with a live status", () => {
       vi.setSystemTime(new Date("2026-10-05T12:00:00"));
       expect(isTaskOverdue(taskItem("started", { endDate: "2026-09-20" }))).toBe(true);
     });

     it("is false for completed", () => {
       vi.setSystemTime(new Date("2026-10-05T12:00:00"));
       expect(isTaskOverdue(taskItem("completed", { endDate: "2026-09-20" }))).toBe(false);
     });

     it("is false for canceled", () => {
       vi.setSystemTime(new Date("2026-10-05T12:00:00"));
       expect(isTaskOverdue(taskItem("canceled", { endDate: "2026-09-20" }))).toBe(false);
     });

     it("is false with no end date", () => {
       vi.setSystemTime(new Date("2026-10-05T12:00:00"));
       expect(isTaskOverdue(taskItem("started", { endDate: null }))).toBe(false);
     });

     it("is false when end equals today", () => {
       vi.setSystemTime(new Date("2026-09-20T12:00:00"));
       expect(isTaskOverdue(taskItem("started", { endDate: "2026-09-20" }))).toBe(false);
     });
   });

   describe("phaseBounds", () => {
     it("returns derived MIN/MAX when no explicit date is set", () => {
       const ph = phase({ startDate: null, endDate: null });
       const items = [
         taskItem("started", { startDate: "2026-09-05", endDate: "2026-09-15" }),
         taskItem("started", { startDate: "2026-09-01", endDate: "2026-09-25" }),
       ];
       expect(phaseBounds(ph, items)).toEqual({
         startDate: "2026-09-01",
         endDate: "2026-09-25",
       });
     });

     it("honours an explicit start with a derived end (per-field fallback)", () => {
       const ph = phase({ startDate: "2026-09-01", endDate: null });
       const items = [
         taskItem("started", { startDate: "2026-09-10", endDate: "2026-09-25" }),
       ];
       expect(phaseBounds(ph, items)).toEqual({
         startDate: "2026-09-01",
         endDate: "2026-09-25",
       });
     });
   });

   describe("isPhaseOverdue", () => {
     afterEach(() => vi.useRealTimers());

     it("is false when a past explicit end has every task completed or canceled", () => {
       vi.setSystemTime(new Date("2026-10-05T12:00:00"));
       const ph = phase({ id: 9, endDate: "2026-09-20" });
       const items = [
         taskItem("completed", { phaseId: 9 }),
         taskItem("canceled", { phaseId: 9 }),
       ];
       expect(isPhaseOverdue(ph, items)).toBe(false);
     });

     it("is true for a past explicit end with zero tasks", () => {
       vi.setSystemTime(new Date("2026-10-05T12:00:00"));
       const ph = phase({ id: 9, endDate: "2026-09-20" });
       expect(isPhaseOverdue(ph, [])).toBe(true);
     });
   });

   describe("isProjectOverdue", () => {
     afterEach(() => vi.useRealTimers());

     it("inherits overdue from a date-only overdue phase", () => {
       vi.setSystemTime(new Date("2026-10-05T12:00:00"));
       const overduePhase = phase({ id: 9, projectId: 1, endDate: "2026-09-20" });
       const proj = project({ id: 1, phases: [overduePhase] });
       const items = [
         taskItem("started", { projectId: 1, phaseId: 9, endDate: null }),
         taskItem("started", { projectId: 1, phaseId: null, endDate: null }),
       ];
       expect(isProjectOverdue(proj, items)).toBe(true);
     });
   });
   ```

   ```typescript
   // client/src/lib/trackerUtils.test.ts
   //
   // trackerUtils.ts already exists with untested behaviour this task locks
   // down before trackerRollup.ts is built on top of it. No implementation
   // change is made here.
   import { describe, expect, it } from "vitest";
   import type { TrackerItem, TrackerVocabulary } from "../types";
   import {
     groupItemsByStatus,
     sortItemsOldestFirst,
     sortStatusesByPosition,
   } from "./trackerUtils";

   function vocab(id: number, name: string, position: number): TrackerVocabulary {
     return { id, kind: "status", name, position, colour: "#ccc" };
   }

   function item(id: number, statusId: number, createdAt: string): TrackerItem {
     return {
       id,
       key: `CA-${id}`,
       title: `Task ${id}`,
       description: "",
       status: {
         id: statusId,
         kind: "status",
         name: "Status",
         position: 0,
         colour: "#ccc",
       },
       priority: null,
       labels: [],
       assignees: [],
       version: 1,
       createdAt,
       updatedAt: createdAt,
     };
   }

   describe("sortStatusesByPosition", () => {
     it("orders statuses by ascending position", () => {
       const statuses = [
         vocab(3, "Done", 4096),
         vocab(1, "Backlog", 1024),
         vocab(2, "Todo", 2048),
       ];
       expect(sortStatusesByPosition(statuses).map((s) => s.name)).toEqual([
         "Backlog",
         "Todo",
         "Done",
       ]);
     });

     it("does not mutate the input array", () => {
       const statuses = [vocab(2, "Todo", 2048), vocab(1, "Backlog", 1024)];
       const copy = [...statuses];
       sortStatusesByPosition(statuses);
       expect(statuses).toEqual(copy);
     });
   });

   describe("sortItemsOldestFirst", () => {
     it("orders items by ascending createdAt", () => {
       const items = [
         item(1, 1, "2026-08-03T00:00:00.000Z"),
         item(2, 1, "2026-08-01T00:00:00.000Z"),
         item(3, 1, "2026-08-02T00:00:00.000Z"),
       ];
       expect(sortItemsOldestFirst(items).map((i) => i.id)).toEqual([2, 3, 1]);
     });
   });

   describe("groupItemsByStatus", () => {
     it("buckets items under their status id, sorted oldest first within each bucket", () => {
       const statuses = [vocab(1, "Backlog", 1024), vocab(2, "Done", 2048)];
       const items = [
         item(1, 1, "2026-08-02T00:00:00.000Z"),
         item(2, 2, "2026-08-01T00:00:00.000Z"),
         item(3, 1, "2026-08-01T00:00:00.000Z"),
       ];
       const grouped = groupItemsByStatus(items, statuses);
       expect(grouped.get(1)?.map((i) => i.id)).toEqual([3, 1]);
       expect(grouped.get(2)?.map((i) => i.id)).toEqual([2]);
     });

     it("initializes a bucket for every status even with no items", () => {
       const statuses = [vocab(1, "Backlog", 1024), vocab(2, "Done", 2048)];
       const grouped = groupItemsByStatus([], statuses);
       expect(grouped.get(1)).toEqual([]);
       expect(grouped.get(2)).toEqual([]);
     });

     it("drops items whose status id has no matching vocabulary", () => {
       const statuses = [vocab(1, "Backlog", 1024)];
       const items = [item(1, 999, "2026-08-01T00:00:00.000Z")];
       const grouped = groupItemsByStatus(items, statuses);
       expect(grouped.get(1)).toEqual([]);
       expect(grouped.get(999)).toBeUndefined();
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/lib/trackerRollup.test.ts`
   Expected failure: `Cannot find module './trackerRollup'`

3. Implement `client/src/lib/trackerRollup.ts` as pure functions over already-fetched data:
   - `rollup(items)` → a discriminated result: `{kind: "percent", completed, total, ratio}`,
     `{kind: "no-active-work"}`, or `{kind: "no-tasks"}`. Numerator counts
     `category === "completed"`; denominator counts `category !== "canceled"`
   - `isTaskOverdue(item)` → `endDate !== null && category not in {completed, canceled}
     && endDate < todayISODate()`, comparing ISO strings lexically
   - `phaseBounds(phase, items)` → per-field: explicit value wins, otherwise `MIN(startDate)`
     / `MAX(endDate)` across the phase's items
   - `isPhaseOverdue(phase, items)` → true if any task is overdue, OR the phase's explicit
     `endDate` is past AND not every task is `completed`/`canceled` (a phase with zero tasks
     counts as not-all-done, so it IS overdue)
   - `isProjectOverdue(project, items)` → true if any of its phases is overdue or any of its
     tasks is overdue
   - Import `todayISODate` from `./boardViewUtils` — read-only, do not edit that module.
     Do NOT use `date-fns`

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/lib/trackerRollup.test.ts src/lib/trackerUtils.test.ts`
   Expected: PASS

5. Refactor while green (bounded):
   - If category checks appear inline three or more times, extract a small predicate
     (`isCompleted`, `isCanceled`, `isLive`) inside this module and use it everywhere
   - Re-run both test files — must stay PASS

6. Commit:
   `git add client/src/lib/trackerRollup.ts client/src/lib/trackerRollup.test.ts client/src/lib/trackerUtils.test.ts`
   `git commit -m "feat(tracker): derive rollup, bounds and overdue from item lists"`

## REFERENCES LOADED

docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md —
rules: Rollup, Overdue; the three-branch rollup result and the phase-overdue carve-out
client/src/lib/boardViewUtils.ts:22-34,44-49 — `todayISODate`, `formatDueDate` and the
lexical ISO comparison this module reuses rather than reaching for `date-fns`
client/src/lib/trackerUtils.ts — the existing grouping helpers, whose behaviour this task
also locks with its first tests

## WHY THIS APPROACH

Justification: pure functions, but they encode every numeric and temporal rule in the spec,
and five UI surfaces depend on them agreeing.
Complexity: standard

## SANDWICH CONTEXT

[CRITICAL: the denominator EXCLUDES canceled tasks, and a zero denominator is `no-active-work` — never 0% and never 100%.]
You are implementing the rollup and schedule derivation for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — this module IS the rollup implementation; no server aggregate exists or may be added.
Files in scope: `client/src/lib/trackerRollup.ts` and the two test files — no other files.
Test framework: Vitest with jsdom; run with `npm run test --workspace=client`.
Available after: T11 (client types)
Architecture rule: pure functions only — no fetching, no React, no side effects. Dates are `YYYY-MM-DD` strings compared lexically; `date-fns` must not be introduced. `boardViewUtils.ts` is imported read-only and never edited.
[RESTATE: the denominator EXCLUDES canceled tasks, and a zero denominator is `no-active-work` — never 0% and never 100%.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given 5 Done, 2 Canceled and 3 In Progress tasks, When rollup runs, Then it reports 63% and 5 of 8
Given all tasks canceled, When rollup runs, Then the result is `no-active-work` with no percentage
Given zero tasks, When rollup runs, Then the result is `no-tasks` with no percentage
Given a project with 2 phases and 4 phase-less tasks, When its rollup runs, Then every task with that project id is counted
Given end 2026-09-20, status In Progress, today 2026-10-05, When checked, Then the task is overdue
Given end 2026-09-20 and status Done, When checked, Then not overdue
Given end equal to today, When checked, Then not overdue
Given no end date, When checked, Then not overdue
Given a phase with explicit end 2026-09-20 and all six tasks Done, today 2026-10-05, When checked, Then not overdue
Given a phase with explicit end 2026-09-20 and zero tasks, today 2026-10-05, When checked, Then overdue
Given a phase with explicit start 2026-09-01, no explicit end, latest task ending 2026-09-25, When bounds are computed, Then the range is 2026-09-01 to 2026-09-25
Given a project whose only overdue descendant is a date-only overdue phase, When checked, Then the project is overdue
[must-not] Given a phase with no explicit dates, When bounds are derived, Then no task is ever flagged as outside the range

All tests PASS. Commit exists with message matching `feat(tracker): …`.

## QUALITY BAR

Must-have:
  - Three-branch rollup result, not a bare number
  - Per-field date fallback, not all-or-nothing
  - Lexical ISO string comparison for every date check
  - Tests written BEFORE implementation

Must-not-have:
  - `date-fns` imported
  - Any edit to `boardViewUtils.ts`
  - React, hooks, or fetching inside this module
  - A general phase range check that flags tasks against derived bounds
  - Modifications to files outside the listed scope

Open question risks:
  - none

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Canceled tasks counted in the denominator → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, client tests green, commit created
Uncertain when: an item's status category is null because it predates the backfill
Escalate when: a rule cannot be expressed without fetching or server support

---

### Task 13: Glyphs read the category column [depends: T11] [parallel: T12]

## OBJECTIVE

Replace the name-regex inference in the status glyph with the `category` column, so a status
named "Batal" or "Selesai" renders correctly.

Files:
- Modify: `client/src/components/tracker/TrackerGlyphs.tsx`
- Test: `client/src/components/tracker/TrackerGlyphs.test.ts`

Steps:

1. Write failing tests in `client/src/components/tracker/TrackerGlyphs.test.ts` for:
   - a status named "Batal" with `category: "canceled"` yields the `cancelled` shape
   - a status named "Selesai" with `category: "completed"` yields the `done` shape
   - a status with `category: "backlog"` yields `pending`
   - a status with `category: "started"` yields `progress` with a fraction derived from
     position rank among the non-canceled statuses
   - a status whose `category` is null falls back to `pending` without throwing

   ```typescript
   // client/src/components/tracker/TrackerGlyphs.test.ts — REPLACES the
   // file's existing content. `category` is now the sole signal for shape,
   // so the old `vocab(id, name, position, kind)` helper (which had no
   // `category`) is replaced by `statusVocab`/`priorityVocab`. The
   // pre-existing position-rank assertions are kept, now driving fixtures
   // through explicit `category` rather than name matching, so this file
   // still locks the "started" fraction behaviour the objective calls out
   // as a required survivor.
   import { describe, expect, it } from "vitest";
   import type { TrackerVocabulary } from "../../types";
   import { priorityBars, statusGlyphSpec } from "./TrackerGlyphs";

   function statusVocab(
     id: number,
     name: string,
     position: number,
     category: TrackerVocabulary["category"] = null,
   ): TrackerVocabulary {
     return { id, kind: "status", name, position, colour: "#ccc", category };
   }

   function priorityVocab(
     id: number,
     name: string,
     position: number,
   ): TrackerVocabulary {
     return { id, kind: "priority", name, position, colour: "#ccc" };
   }

   const statuses = [
     statusVocab(1, "Backlog", 1024, "backlog"),
     statusVocab(2, "Todo", 2048, "backlog"),
     statusVocab(3, "In Progress", 3072, "started"),
     statusVocab(4, "Done", 4096, "completed"),
     statusVocab(5, "Canceled", 5120, "canceled"),
   ];

   describe("statusGlyphSpec", () => {
     it("marks the first workflow status as pending", () => {
       expect(statusGlyphSpec(statuses, 1)).toEqual({
         shape: "pending",
         fraction: 0,
       });
     });

     it("fills partially for mid-workflow statuses", () => {
       const spec = statusGlyphSpec(statuses, 3);
       expect(spec.shape).toBe("progress");
       expect(spec.fraction).toBeCloseTo(2 / 3);
     });

     it("marks the last workflow status as done", () => {
       expect(statusGlyphSpec(statuses, 4).shape).toBe("done");
     });

     it("excludes cancelled statuses from the progress scale", () => {
       expect(statusGlyphSpec(statuses, 5).shape).toBe("cancelled");
     });

     it("does not divide by zero for a lone started status among non-canceled ones", () => {
       const single = [statusVocab(9, "Only", 1024, "started")];
       const spec = statusGlyphSpec(single, 9);
       expect(spec.shape).toBe("progress");
       expect(Number.isFinite(spec.fraction)).toBe(true);
     });

     it("falls back to pending for an unknown status", () => {
       expect(statusGlyphSpec(statuses, 404).shape).toBe("pending");
     });

     it("renders the cancelled shape for a status named 'Batal' with category canceled", () => {
       const custom = [statusVocab(1, "Batal", 1024, "canceled")];
       expect(statusGlyphSpec(custom, 1).shape).toBe("cancelled");
     });

     it("renders the done shape for a status named 'Selesai' with category completed", () => {
       const custom = [statusVocab(1, "Selesai", 1024, "completed")];
       expect(statusGlyphSpec(custom, 1).shape).toBe("done");
     });

     it("renders pending for category backlog", () => {
       const custom = [statusVocab(1, "Antrian", 1024, "backlog")];
       expect(statusGlyphSpec(custom, 1).shape).toBe("pending");
     });

     it("renders progress for category started, fraction from position rank among non-canceled statuses", () => {
       const custom = [
         statusVocab(1, "Mulai", 1024, "started"),
         statusVocab(2, "Lanjut", 2048, "started"),
         statusVocab(3, "Selesai", 3072, "completed"),
       ];
       const spec = statusGlyphSpec(custom, 2);
       expect(spec.shape).toBe("progress");
       expect(spec.fraction).toBeCloseTo(1 / 2);
     });

     it("falls back to pending without throwing when category is null", () => {
       const custom = [statusVocab(1, "Legacy", 1024, null)];
       expect(() => statusGlyphSpec(custom, 1)).not.toThrow();
       expect(statusGlyphSpec(custom, 1).shape).toBe("pending");
     });

     it("ignores a name containing 'cancel' when its category is not canceled", () => {
       const custom = [
         statusVocab(1, "Cancel My Subscription Reminder", 1024, "started"),
         statusVocab(2, "Done", 2048, "completed"),
       ];
       const spec = statusGlyphSpec(custom, 1);
       expect(spec.shape).not.toBe("cancelled");
       expect(spec.shape).toBe("progress");
     });
   });

   describe("priorityBars", () => {
     const priorities = [
       priorityVocab(10, "High", 1024),
       priorityVocab(11, "Medium", 2048),
       priorityVocab(12, "Low", 3072),
     ];

     it("lights every bar for the highest priority", () => {
       expect(priorityBars(priorities, 10)).toBe(3);
     });

     it("lights one bar for the lowest priority", () => {
       expect(priorityBars(priorities, 12)).toBe(1);
     });

     it("returns no bars for an unknown priority", () => {
       expect(priorityBars(priorities, 99)).toBe(0);
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/components/tracker/TrackerGlyphs.test.ts`
   Expected failure: "Batal" is not recognised as cancelled because the regex does not match

3. Implement in `client/src/components/tracker/TrackerGlyphs.tsx`:
   - Delete the `CANCELLED = /cancel/i` constant at :9 and both its uses at :27 and :29
   - `statusGlyphSpec` selects the shape from `category`: `canceled` → `cancelled`,
     `completed` → `done`, `backlog` → `pending`, `started` → `progress`
   - Inside `started`, keep deriving the fill fraction from position rank among statuses
     whose category is not `canceled`, preserving today's visual behaviour
   - A null `category` falls back to `pending`

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/components/tracker/TrackerGlyphs.test.ts`
   Then: `npm run test --workspace=client` and `npm run typecheck`
   Expected: PASS

5. Refactor while green (bounded):
   - If the category-to-shape mapping is expressed as a chain of conditionals, replace it
     with a single lookup object
   - Re-run: `npm run test --workspace=client -- src/components/tracker/TrackerGlyphs.test.ts` — must stay PASS

6. Commit:
   `git add client/src/components/tracker/TrackerGlyphs.tsx client/src/components/tracker/TrackerGlyphs.test.ts`
   `git commit -m "fix(tracker): derive status glyphs from category instead of the name"`

## REFERENCES LOADED

docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md —
rule: Status semantics, "glyphs read the column, never the name"
client/src/components/tracker/TrackerGlyphs.tsx:9,20-36 — the regex and the position-rank
fraction logic that must survive for `started`
client/src/components/tracker/TrackerGlyphs.test.ts — the existing test file this extends

## WHY THIS APPROACH

Justification: one component file plus its test, with a precisely specified behaviour change
and an existing visual detail that must be preserved.
Complexity: lightweight

## SANDWICH CONTEXT

[CRITICAL: no name-based matching may remain — the `/cancel/i` regex is deleted, not kept as a fallback.]
You are implementing the glyph fix for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — `category` is the single machine-readable signal, shared by glyphs and rollup.
Files in scope: `client/src/components/tracker/TrackerGlyphs.tsx` and its test — no other files.
Test framework: Vitest with jsdom; run with `npm run test --workspace=client`.
Available after: T11 (the `category` field on `TrackerVocabulary`)
Architecture rule: preserve the existing `started` fill fraction derived from position rank — four categories alone cannot reproduce it, and losing it is a visual regression.
[RESTATE: no name-based matching may remain — the `/cancel/i` regex is deleted, not kept as a fallback.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a status named "Batal" with category `canceled`, When a row renders, Then the cancelled glyph shows
Given a status named "Selesai" with category `completed`, When a row renders, Then the done glyph shows
Given a status with category `started`, When rendered, Then the progress ring is filled proportionally to its position rank
Given a status with a null category, When rendered, Then it falls back to `pending` without throwing
[must-not] Given any status, When its glyph is computed, Then no name-based regex participates in the decision

All tests PASS. Commit exists with message matching `fix(tracker): …`.

## QUALITY BAR

Must-have:
  - `CANCELLED` regex deleted entirely
  - `started` fraction behaviour preserved
  - Null category handled without throwing
  - Tests written BEFORE implementation

Must-not-have:
  - Name matching retained as a fallback
  - Changes to the SVG rendering or sizing
  - Modifications to files outside the listed scope

Open question risks:
  - Grandfathered statuses carry `category: "backlog"` and will render flat `pending` — this
    is accepted, not a bug

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Any string comparison against a status name → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, client tests green, commit created
Uncertain when: an existing snapshot or test depends on the regex behaviour
Escalate when: preserving the `started` fraction proves impossible from category plus position

---

### Task 14: Tracker home — project cards, search into projects, new realtime [depends: T12, T13]

## OBJECTIVE

Turn `/tracker` into Tracker home: project cards above the existing status-grouped list of
unassigned items, with search that reaches into projects and handlers for the new events.

Files:
- Modify: `client/src/pages/TrackerPage.tsx`
- Create: `client/src/components/tracker/TrackerProjectCard.tsx`
- Create: `client/src/components/tracker/TrackerProgressBar.tsx`
- Create: `client/src/components/tracker/TrackerProjectCreateModal.tsx`
- Test: `client/src/pages/TrackerPage.test.tsx`

Steps:

1. Write failing tests in `client/src/pages/TrackerPage.test.tsx` for:
   - a workspace with items and no projects renders the status sections exactly as before,
     plus a "New project" affordance
   - clicking "New project" opens a modal; submitting a name calls `createTrackerProject`
     and the new card appears
   - submitting a blank name surfaces the server's 400 inline
   - at 10 projects the "New project" control is disabled and states the reason
   - project cards show name, percentage, task count and an overdue marker when applicable
   - searching a term that matches only an in-project item shows it under "In projects" with
     its `Project › Phase` trail, and the "No items match" state does NOT appear
   - the toolbar count includes in-project matches
   - searching a term with no match anywhere shows the "No items match" state
   - a `tracker.project.created` event refreshes the list
   - a `tracker.project.deleted` event removes the card and shows the released tasks

   ```typescript
   // Appended to client/src/pages/TrackerPage.test.tsx — reuses the
   // `mockListTrackerItems` / `mockUseBoard` / `mockNavigate` mocks and the
   // `makeItem` helper already declared at the top of this file. Extend the
   // existing `vi.hoisted` block and the `vi.mock("../api", …)` factory with
   // two more entries, following the exact shape already there:
   //
   //   mockListTrackerProjects: vi.fn(),
   //   mockCreateTrackerProject: vi.fn(),
   //   …
   //   listTrackerProjects: (...a: unknown[]) => mockListTrackerProjects(...a),
   //   createTrackerProject: (...a: unknown[]) => mockCreateTrackerProject(...a),
   //
   // Also import `ApiError` from "../api" (the mocked class already exported
   // by the top-level mock) and add `category` to the existing `statuses`
   // fixture — `TrackerVocabulary.category` is required from T11 onward:
   // Backlog → "backlog", In Progress → "started", Done → "completed".
   import { ApiError } from "../api";
   import type { TrackerPhase, TrackerProject } from "../types";

   const persiapan: TrackerPhase = {
     id: 9,
     projectId: 1,
     name: "Persiapan",
     subtitle: "",
     startDate: null,
     endDate: null,
     position: 1024,
     version: 1,
     createdAt: "2026-08-01T00:00:00Z",
     updatedAt: "2026-08-01T00:00:00Z",
   };

   const releaseProject: TrackerProject = {
     id: 1,
     name: "Rilis v2",
     startDate: null,
     endDate: null,
     position: 1024,
     version: 1,
     phases: [persiapan],
     createdAt: "2026-08-01T00:00:00Z",
     updatedAt: "2026-08-01T00:00:00Z",
   };

   function inProjectItem(
     overrides: Partial<TrackerItem> & { id: number },
   ): TrackerItem {
     return makeItem({
       projectId: 1,
       phaseId: 9,
       startDate: null,
       endDate: null,
       completedAt: null,
       position: 1024,
       ...overrides,
     });
   }

   beforeEach(() => {
     // Keeps every pre-existing test in this file seeing a project-less
     // workspace unless it opts into a project fixture below.
     mockListTrackerProjects.mockResolvedValue([]);
   });

   describe("TrackerPage projects", () => {
     it("renders unassigned items unchanged, plus a New project affordance, when no projects exist", async () => {
       render(<TrackerPage />);
       await waitFor(() => expect(screen.getByText("Backlog")).toBeTruthy());
       expect(screen.getByText("CA-1")).toBeTruthy();
       expect(screen.getByRole("button", { name: /new project/i })).toBeTruthy();
       expect(screen.queryByText("In projects")).toBeNull();
     });

     it("opens the project modal, creates a project and shows the card without a manual refresh", async () => {
       mockListTrackerProjects
         .mockResolvedValueOnce([])
         .mockResolvedValueOnce([releaseProject]);
       mockCreateTrackerProject.mockResolvedValue(releaseProject);
       render(<TrackerPage />);
       await waitFor(() => screen.getByText("Backlog"));
       fireEvent.click(screen.getByRole("button", { name: /new project/i }));
       const modal = within(screen.getByRole("dialog"));
       fireEvent.change(modal.getByLabelText(/project name/i), {
         target: { value: "Rilis v2" },
       });
       fireEvent.click(modal.getByRole("button", { name: /create project/i }));
       await waitFor(() =>
         expect(mockCreateTrackerProject).toHaveBeenCalledWith(7, {
           name: "Rilis v2",
         }),
       );
       await waitFor(() => expect(screen.getByText("Rilis v2")).toBeTruthy());
     });

     it("surfaces the server's 400 inline for a blank project name", async () => {
       mockCreateTrackerProject.mockRejectedValueOnce(
         new ApiError("Name is required", 400),
       );
       render(<TrackerPage />);
       await waitFor(() => screen.getByText("Backlog"));
       fireEvent.click(screen.getByRole("button", { name: /new project/i }));
       const modal = within(screen.getByRole("dialog"));
       fireEvent.click(modal.getByRole("button", { name: /create project/i }));
       expect(await modal.findByText("Name is required")).toBeTruthy();
       expect(screen.getByRole("dialog")).toBeTruthy();
     });

     it("disables New project with a visible reason at the 10-project cap", async () => {
       mockListTrackerProjects.mockResolvedValueOnce(
         Array.from({ length: 10 }, (_, i) => ({
           ...releaseProject,
           id: i + 1,
           name: `Project ${i + 1}`,
         })),
       );
       render(<TrackerPage />);
       await waitFor(() => screen.getByText("Project 1"));
       const button = screen.getByRole("button", { name: /new project/i });
       expect(button).toBeDisabled();
       expect(screen.getByText(/10/)).toBeTruthy();
     });

     it("shows name, percentage, task count and an overdue marker on a project card", async () => {
       vi.setSystemTime(new Date("2026-10-05T12:00:00"));
       mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
       mockListTrackerItems.mockResolvedValueOnce([
         inProjectItem({ id: 10, key: "CA-10", status: statuses[2]! }),
         inProjectItem({
           id: 11,
           key: "CA-11",
           status: statuses[1]!,
           endDate: "2026-09-20",
         }),
       ]);
       render(<TrackerPage />);
       await waitFor(() => screen.getByText("Rilis v2"));
       expect(screen.getByText("50%")).toBeTruthy();
       expect(screen.getByText(/2 tasks/i)).toBeTruthy();
       expect(screen.getByLabelText(/overdue/i)).toBeTruthy();
       vi.useRealTimers();
     });

     it('shows an in-project-only match under "In projects" with its trail, and never fires the empty state', async () => {
       mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
       mockListTrackerItems.mockResolvedValueOnce([
         inProjectItem({ id: 10, key: "CA-10", title: "Ship realtime sync" }),
       ]);
       render(<TrackerPage />);
       await waitFor(() => screen.getByText("Rilis v2"));
       fireEvent.change(screen.getByPlaceholderText(/search/i), {
         target: { value: "realtime" },
       });
       await waitFor(() => expect(screen.getByText("In projects")).toBeTruthy());
       expect(screen.getByText("CA-10")).toBeTruthy();
       expect(screen.getByText("Rilis v2 › Persiapan")).toBeTruthy();
       expect(screen.queryByText(/no items match/i)).toBeNull();
     });

     it("counts the in-project match in the toolbar total", async () => {
       mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
       mockListTrackerItems.mockResolvedValueOnce([
         inProjectItem({ id: 10, key: "CA-10", title: "Ship realtime sync" }),
       ]);
       render(<TrackerPage />);
       await waitFor(() => screen.getByText("Rilis v2"));
       fireEvent.change(screen.getByPlaceholderText(/search/i), {
         target: { value: "realtime" },
       });
       await waitFor(() => expect(screen.getByText("1 item")).toBeTruthy());
     });

     it("still shows the empty state when neither a project name nor any item matches", async () => {
       mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
       render(<TrackerPage />);
       await waitFor(() => screen.getByText("Rilis v2"));
       fireEvent.change(screen.getByPlaceholderText(/search/i), {
         target: { value: "nonexistent-zzz" },
       });
       await waitFor(() =>
         expect(screen.getByText(/no items match/i)).toBeTruthy(),
       );
     });

     it("reloads and shows the card on tracker.project.created without a manual refresh", async () => {
       let sseHandler: ((e: { type: string }) => void) | undefined;
       mockUseBoard.mockReturnValue({
         activeWorkspaceId: 7,
         subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
           sseHandler = cb;
           return () => {};
         },
         registerRefreshTrackerList: vi.fn(),
         refreshTrackerList: vi.fn(),
         showToast: mockShowToast,
       });
       render(<TrackerPage />);
       await waitFor(() => screen.getByText("Backlog"));
       mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
       sseHandler?.({ type: "tracker.project.created" });
       await waitFor(() => expect(screen.getByText("Rilis v2")).toBeTruthy());
     });

     it("removes the card and surfaces the released tasks on tracker.project.deleted", async () => {
       let sseHandler: ((e: { type: string }) => void) | undefined;
       mockUseBoard.mockReturnValue({
         activeWorkspaceId: 7,
         subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
           sseHandler = cb;
           return () => {};
         },
         registerRefreshTrackerList: vi.fn(),
         refreshTrackerList: vi.fn(),
         showToast: mockShowToast,
       });
       mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
       mockListTrackerItems.mockResolvedValueOnce([
         inProjectItem({ id: 10, key: "CA-10", title: "Ship realtime sync" }),
       ]);
       render(<TrackerPage />);
       await waitFor(() => screen.getByText("Rilis v2"));

       mockListTrackerProjects.mockResolvedValueOnce([]);
       mockListTrackerItems.mockResolvedValueOnce([
         makeItem({
           id: 10,
           key: "CA-10",
           title: "Ship realtime sync",
           projectId: null,
           phaseId: null,
         }),
       ]);
       sseHandler?.({ type: "tracker.project.deleted" });
       await waitFor(() => expect(screen.queryByText("Rilis v2")).toBeNull());
       await waitFor(() => expect(screen.getByText("CA-10")).toBeTruthy());
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/pages/TrackerPage.test.tsx`
   Expected failure: no project card rendered; empty state fires on an in-project-only match

3. Implement:
   - `TrackerProgressBar.tsx`: renders the three rollup branches. Fill uses primary-600
     `oklch(55.0% 0.076 250)` on a neutral-200 `oklch(92.0% 0.005 250)` track, per the
     creative brief — not success-green
   - `TrackerProjectCard.tsx`: name, progress bar, task count, derived date range, overdue
     marker using the Error role (`oklch(55% 0.100 25)` solid, `oklch(35% 0.085 25)` text on
     `oklch(95% 0.025 25)`); links to `/tracker/p/{id}`
   - `TrackerPage.tsx`:
     - fetch projects alongside statuses, priorities and items in the existing `Promise.all`
     - split items into unassigned (`projectId === null`) and in-project
     - status sections render unassigned items only, unchanged from today
     - fix the empty-state condition at :126 so it accounts for project-name matches and
       in-project item matches — this is the line that would otherwise kill the feature
     - render an "In projects" section during search, joining project and phase names by id
     - add the six new event types to the SSE handler, each calling `loadData()`. Do NOT
       merge from `event.payload` — the nearest precedent
       (`tracker-vocabularies.ts:141-144` + `TrackerPage.tsx:71-85`) is a payload handler
       that never fires
     - make the projects area collapsible
   - `TrackerProjectCreateModal.tsx`: a single-field modal following the composition of the
     existing `TrackerCreateModal`, calling `api.createTrackerProject` and surfacing the
     server's 400 or 409 inline in the brief's neutral-friendly register. The "New project"
     control is disabled with a visible reason once 10 non-deleted projects exist, mirroring
     the workspace-cap treatment in `client/src/lib/workspaceSwitcher.ts`

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/pages/TrackerPage.test.tsx`
   Then: `npm run test --workspace=client` and `npm run typecheck`
   Expected: PASS

5. Refactor while green (bounded):
   - `TrackerPage.tsx` is already 295 lines; if this work pushes it past ~300, extract the
     search-partitioning logic into `client/src/lib/trackerRollup.ts` or a sibling module
     rather than growing the component
   - Re-run: `npm run test --workspace=client -- src/pages/TrackerPage.test.tsx` — must stay PASS

6. Commit:
   `git add client/src/pages/TrackerPage.tsx client/src/components/tracker/TrackerProjectCard.tsx client/src/components/tracker/TrackerProgressBar.tsx client/src/components/tracker/TrackerProjectCreateModal.tsx client/src/pages/TrackerPage.test.tsx`
   `git commit -m "feat(tracker): add project cards and cross-project search to tracker home"`

## REFERENCES LOADED

docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md —
rules: Home and project page, Realtime; the Implementation Notes on `:126` and on reloading
rather than merging
client/src/pages/TrackerPage.tsx:40-55,68-107,109-126,255-281 — the load, SSE handler,
filter and render paths this task changes
docs/pocket/rule/creative-brief.md:30,52,66 — primary-600, neutral-200 and the Error role
client/src/lib/trackerRollup.ts — the derivation helper from T12, imported not reimplemented

## WHY THIS APPROACH

Justification: four files including two new components, plus a subtle empty-state condition
whose failure mode is a silently missing feature rather than an error.
Complexity: standard

## SANDWICH CONTEXT

[CRITICAL: the empty-state condition at `TrackerPage.tsx:126` currently short-circuits the entire render — it MUST account for project-name and in-project matches, or the "In projects" section can never appear.]
You are implementing Tracker home for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — rollup comes from `trackerRollup.ts` over the fetched item list; never fetch an aggregate.
Files in scope: `client/src/pages/TrackerPage.tsx`, `TrackerProjectCard.tsx`, `TrackerProgressBar.tsx`, `TrackerProjectCreateModal.tsx`, `TrackerPage.test.tsx` — no other files.
Test framework: Vitest with jsdom; run client tests with `npm run test --workspace=client`, not raw vitest from the repo root.
Available after: T12 (derivation), T13 (glyphs)
Architecture rule: existing behaviour for unassigned items must not regress — the status-grouped list stays on this route and keeps its reset-on-navigation collapse rule. New SSE handlers call `loadData()`; they do not merge from payloads.
[RESTATE: the empty-state condition at `TrackerPage.tsx:126` currently short-circuits the entire render — it MUST account for project-name and in-project matches, or the "In projects" section can never appear.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a workspace with 31 items and no projects, When `/tracker` opens, Then the items render grouped by status exactly as before, with only a "New project" affordance added
Given the only match for "realtime" is an item inside a project, When searched, Then it appears under "In projects" with its trail, the empty state does not appear, and the toolbar count includes it
Given no project name and no item matches, When searched, Then the "No items match" state appears
Given members A and B on `/tracker`, When A creates a project, Then B sees the card without refreshing
Given members A and B on `/tracker`, When A deletes a project holding 18 tasks, Then B's card disappears and the 18 released tasks appear in B's unassigned sections
Given a project card, When it renders, Then its percentage comes from `trackerRollup` and its bar uses primary-600 on neutral-200
Given a member clicks "New project" and submits "Rilis v2", When it succeeds, Then the card appears without a manual refresh
Given workspace W already has 10 non-deleted projects, When the home renders, Then the "New project" control is disabled with the reason visible
[must-not] Given a blank project name, When submitted, Then the server's 400 is surfaced inline rather than swallowed
[must-not] Given this change, When `/tracker` renders, Then no unassigned item is relocated to another route

All tests PASS. Commit exists with message matching `feat(tracker): …`.

## QUALITY BAR

Must-have:
  - Empty-state condition accounts for all three match sources
  - New SSE handlers reload via `loadData()`
  - Rollup imported from `trackerRollup.ts`, never reimplemented
  - Brief-compliant colours: primary-600 fill, neutral-200 track, Error role for overdue
  - Tests written BEFORE implementation

Must-not-have:
  - Unassigned items moved off `/tracker`
  - Merging state from `event.payload` in the new handlers
  - Any Roadmap or timeline rendering
  - Success-green progress fill
  - Modifications to files outside the listed scope

Open question risks:
  - The projects area is collapsible but expanded by default; if many projects crowd the
    list in practice, the next step is collapsing by default — not relocating the list

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - A local reimplementation of rollup → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, client tests green, commit created
Uncertain when: joining project and phase names by id proves ambiguous for a soft-deleted parent
Escalate when: preserving today's unassigned behaviour conflicts with a required new behaviour

---

### Task 15: Project WBS page [depends: T12, T13]

## OBJECTIVE

Add `/tracker/p/:id`: phases with rollup, date range and overdue, a "No phase" section, a
CTA empty state, persisted collapse, and a 404 state for unknown or cross-workspace ids.

Files:
- Create: `client/src/pages/TrackerProjectPage.tsx`
- Create: `client/src/components/tracker/TrackerPhaseSection.tsx`
- Test: `client/src/pages/TrackerProjectPage.test.tsx`
- Modify: `client/src/App.tsx`

Steps:

1. Write failing tests in `client/src/pages/TrackerProjectPage.test.tsx` for:
   - phases render with rollup percentage and derived date range
   - a "No phase" section appears when phase-less tasks exist and is absent otherwise
   - a project with zero phases and zero tasks shows a CTA empty state
   - an unknown project id renders the 404 state
   - a project belonging to another workspace renders the 404 state
   - collapsing a phase persists across navigation via `sessionStorage`
   - collapse survives an SSE-triggered `loadData()` reload
   - a `tracker.project.deleted` event for the open project shows the 404 state
   - a `tracker.updated` event for an item in this project refreshes the phase and project
     percentages
   - a `tracker.created` event for an item in this project makes the new row appear
   - a `tracker.deleted` event removes the row and updates the percentages
   - a `tracker.phase.deleted` event moves that phase's tasks into "No phase"

   ```typescript
   // client/src/pages/TrackerProjectPage.test.tsx
   // Mirrors the mock shape of TrackerPage.test.tsx and TrackerDetailPage.test.tsx:
   // `vi.hoisted` for every mock fn, `vi.mock("../api", …)` re-exporting `ApiError`,
   // a mocked `useBoard`, and `react-router`'s `useNavigate` / `useParams`.
   import {
     cleanup,
     fireEvent,
     render,
     screen,
     waitFor,
   } from "@testing-library/react";
   import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
   import type { TrackerItem, TrackerPhase, TrackerProject } from "../types";

   const {
     mockListTrackerProjects,
     mockListTrackerItems,
     mockNavigate,
     mockUseParams,
     mockUseBoard,
     mockShowToast,
   } = vi.hoisted(() => ({
     mockListTrackerProjects: vi.fn(),
     mockListTrackerItems: vi.fn(),
     mockNavigate: vi.fn(),
     mockUseParams: vi.fn(),
     mockUseBoard: vi.fn(),
     mockShowToast: vi.fn(),
   }));

   vi.mock("../api", () => ({
     api: {
       listTrackerProjects: (...a: unknown[]) => mockListTrackerProjects(...a),
       listTrackerItems: (...a: unknown[]) => mockListTrackerItems(...a),
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
     useParams: () => mockUseParams(),
   }));

   import TrackerProjectPage from "./TrackerProjectPage";

   const persiapan: TrackerPhase = {
     id: 9,
     projectId: 1,
     name: "Persiapan",
     subtitle: "",
     startDate: null,
     endDate: null,
     position: 1024,
     version: 1,
     createdAt: "2026-08-01T00:00:00Z",
     updatedAt: "2026-08-01T00:00:00Z",
   };

   const pengembangan: TrackerPhase = {
     id: 10,
     projectId: 1,
     name: "Pengembangan",
     subtitle: "",
     startDate: null,
     endDate: null,
     position: 2048,
     version: 1,
     createdAt: "2026-08-01T00:00:00Z",
     updatedAt: "2026-08-01T00:00:00Z",
   };

   const project: TrackerProject = {
     id: 1,
     name: "Rilis v2",
     startDate: null,
     endDate: null,
     position: 1024,
     version: 1,
     phases: [persiapan, pengembangan],
     createdAt: "2026-08-01T00:00:00Z",
     updatedAt: "2026-08-01T00:00:00Z",
   };

   const backlog = {
     id: 1,
     kind: "status" as const,
     name: "Backlog",
     position: 1000,
     colour: "oklch(0.7 0.1 200)",
     category: "backlog" as const,
   };
   const inProgress = {
     id: 2,
     kind: "status" as const,
     name: "In Progress",
     position: 2000,
     colour: "oklch(0.7 0.1 90)",
     category: "started" as const,
   };
   const done = {
     id: 3,
     kind: "status" as const,
     name: "Done",
     position: 3000,
     colour: "oklch(0.7 0.1 140)",
     category: "completed" as const,
   };

   function projectItem(
     overrides: Partial<TrackerItem> & { id: number },
   ): TrackerItem {
     return {
       key: `CA-${overrides.id}`,
       title: "Task",
       description: "",
       status: backlog,
       priority: null,
       labels: [],
       assignees: [],
       version: 1,
       createdAt: "2026-08-01T00:00:00Z",
       updatedAt: "2026-08-01T00:00:00Z",
       projectId: 1,
       phaseId: 9,
       startDate: null,
       endDate: null,
       completedAt: null,
       position: 1024,
       ...overrides,
     };
   }

   beforeEach(() => {
     mockUseParams.mockReturnValue({ projectId: "1" });
     mockListTrackerProjects.mockResolvedValue([project]);
     mockListTrackerItems.mockResolvedValue([
       projectItem({ id: 1, key: "CA-1", phaseId: 9, status: done }),
       projectItem({ id: 2, key: "CA-2", phaseId: 9, status: inProgress }),
     ]);
     mockUseBoard.mockReturnValue({
       activeWorkspaceId: 7,
       subscribeTrackerEvents: vi.fn(() => () => {}),
       showToast: mockShowToast,
     });
   });

   afterEach(() => {
     cleanup();
     vi.clearAllMocks();
     window.sessionStorage.clear();
   });

   describe("TrackerProjectPage", () => {
     it("renders phases with a rollup percentage and a derived date range", async () => {
       mockListTrackerItems.mockResolvedValueOnce([
         projectItem({
           id: 1,
           key: "CA-1",
           phaseId: 9,
           status: done,
           startDate: "2026-09-05",
           endDate: "2026-09-15",
         }),
         projectItem({
           id: 2,
           key: "CA-2",
           phaseId: 9,
           status: inProgress,
           startDate: "2026-09-10",
           endDate: "2026-09-25",
         }),
       ]);
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Persiapan"));
       expect(screen.getByText("50%")).toBeTruthy();
       expect(screen.getByText(/Sep 5.*Sep 25/)).toBeTruthy();
     });

     it('shows a "No phase" section when phase-less tasks exist for this project', async () => {
       mockListTrackerItems.mockResolvedValueOnce([
         projectItem({ id: 1, key: "CA-1", phaseId: null }),
       ]);
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("No phase"));
       expect(screen.getByTestId("tracker-row-CA-1")).toBeTruthy();
     });

     it('omits the "No phase" section when every task has a phase', async () => {
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Persiapan"));
       expect(screen.queryByText("No phase")).toBeNull();
     });

     it("shows a CTA empty state for a project with zero phases and zero tasks", async () => {
       mockListTrackerProjects.mockResolvedValueOnce([
         { ...project, id: 5, name: "Rilis v3", phases: [] },
       ]);
       mockListTrackerItems.mockResolvedValueOnce([]);
       mockUseParams.mockReturnValue({ projectId: "5" });
       render(<TrackerProjectPage />);
       expect(
         await screen.findByRole("button", { name: /create.*phase/i }),
       ).toBeTruthy();
     });

     it("renders the 404 state for an unknown project id", async () => {
       mockUseParams.mockReturnValue({ projectId: "999" });
       render(<TrackerProjectPage />);
       expect(await screen.findByText(/not found/i)).toBeTruthy();
       expect(screen.queryByText("Persiapan")).toBeNull();
     });

     it("renders the 404 state for a project id belonging to another workspace", async () => {
       // The list is workspace-scoped server-side, so a foreign id is simply
       // absent from it — the same code path as an unknown id.
       mockUseParams.mockReturnValue({ projectId: "42" });
       render(<TrackerProjectPage />);
       expect(await screen.findByText(/not found/i)).toBeTruthy();
     });

     it("persists a collapsed phase across a fresh mount within the same session", async () => {
       const { unmount } = render(<TrackerProjectPage />);
       await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
       fireEvent.click(screen.getByTestId("toggle-phase-Persiapan"));
       expect(screen.queryByTestId("tracker-row-CA-1")).toBeNull();
       unmount();

       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Persiapan"));
       expect(screen.queryByTestId("tracker-row-CA-1")).toBeNull();
     });

     it("keeps a collapsed phase collapsed through an SSE-triggered reload", async () => {
       let sseHandler: ((e: { type: string }) => void) | undefined;
       mockUseBoard.mockReturnValue({
         activeWorkspaceId: 7,
         subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
           sseHandler = cb;
           return () => {};
         },
         showToast: mockShowToast,
       });
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
       fireEvent.click(screen.getByTestId("toggle-phase-Persiapan"));
       expect(screen.queryByTestId("tracker-row-CA-1")).toBeNull();

       sseHandler?.({ type: "tracker.updated" });
       await waitFor(() => expect(mockListTrackerItems).toHaveBeenCalledTimes(2));
       expect(screen.queryByTestId("tracker-row-CA-1")).toBeNull();
     });

     it("shows the 404 state when tracker.project.deleted fires for the open project", async () => {
       let sseHandler: ((e: { type: string }) => void) | undefined;
       mockUseBoard.mockReturnValue({
         activeWorkspaceId: 7,
         subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
           sseHandler = cb;
           return () => {};
         },
         showToast: mockShowToast,
       });
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Persiapan"));

       mockListTrackerProjects.mockResolvedValueOnce([]);
       sseHandler?.({ type: "tracker.project.deleted" });
       await waitFor(() => expect(screen.getByText(/not found/i)).toBeTruthy());
     });

     it("reloads on every project/phase event plus the three item events (eight of the nine)", async () => {
       let sseHandler: ((e: { type: string }) => void) | undefined;
       mockUseBoard.mockReturnValue({
         activeWorkspaceId: 7,
         subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
           sseHandler = cb;
           return () => {};
         },
         showToast: mockShowToast,
       });
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Persiapan"));

       const eventTypes = [
         "tracker.project.created",
         "tracker.project.updated",
         "tracker.phase.created",
         "tracker.phase.updated",
         "tracker.phase.deleted",
         "tracker.created",
         "tracker.updated",
         "tracker.deleted",
       ];
       for (const type of eventTypes) {
         mockListTrackerItems.mockClear();
         sseHandler?.({ type });
         await waitFor(() => expect(mockListTrackerItems).toHaveBeenCalled());
       }
       // The ninth, tracker.project.deleted, is covered separately above since
       // it resolves to the 404 state rather than a fresh render of this page.
     });

     it("refreshes the phase and project percentages after a tracker.updated event", async () => {
       let sseHandler: ((e: { type: string }) => void) | undefined;
       mockUseBoard.mockReturnValue({
         activeWorkspaceId: 7,
         subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
           sseHandler = cb;
           return () => {};
         },
         showToast: mockShowToast,
       });
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("50%"));

       mockListTrackerItems.mockResolvedValueOnce([
         projectItem({ id: 1, key: "CA-1", phaseId: 9, status: done }),
         projectItem({ id: 2, key: "CA-2", phaseId: 9, status: done }),
       ]);
       sseHandler?.({ type: "tracker.updated" });
       await waitFor(() => expect(screen.getByText("100%")).toBeTruthy());
     });

     it("shows a new row from a tracker.created event without a manual refresh", async () => {
       let sseHandler: ((e: { type: string }) => void) | undefined;
       mockUseBoard.mockReturnValue({
         activeWorkspaceId: 7,
         subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
           sseHandler = cb;
           return () => {};
         },
         showToast: mockShowToast,
       });
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByTestId("tracker-row-CA-1"));

       mockListTrackerItems.mockResolvedValueOnce([
         projectItem({ id: 1, key: "CA-1", phaseId: 9, status: done }),
         projectItem({ id: 2, key: "CA-2", phaseId: 9, status: inProgress }),
         projectItem({ id: 3, key: "CA-3", phaseId: 9, title: "New task" }),
       ]);
       sseHandler?.({ type: "tracker.created" });
       await waitFor(() => expect(screen.getByTestId("tracker-row-CA-3")).toBeTruthy());
     });

     it("removes the row and updates the percentages on a tracker.deleted event", async () => {
       let sseHandler: ((e: { type: string }) => void) | undefined;
       mockUseBoard.mockReturnValue({
         activeWorkspaceId: 7,
         subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
           sseHandler = cb;
           return () => {};
         },
         showToast: mockShowToast,
       });
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("50%"));

       mockListTrackerItems.mockResolvedValueOnce([
         projectItem({ id: 1, key: "CA-1", phaseId: 9, status: done }),
       ]);
       sseHandler?.({ type: "tracker.deleted" });
       await waitFor(() => expect(screen.queryByTestId("tracker-row-CA-2")).toBeNull());
       expect(screen.getByText("100%")).toBeTruthy();
     });

     it('moves a deleted phase\'s tasks into "No phase" on tracker.phase.deleted', async () => {
       let sseHandler: ((e: { type: string }) => void) | undefined;
       mockUseBoard.mockReturnValue({
         activeWorkspaceId: 7,
         subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
           sseHandler = cb;
           return () => {};
         },
         showToast: mockShowToast,
       });
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Persiapan"));

       mockListTrackerProjects.mockResolvedValueOnce([
         { ...project, phases: [pengembangan] },
       ]);
       mockListTrackerItems.mockResolvedValueOnce([
         projectItem({ id: 1, key: "CA-1", phaseId: null, status: done }),
         projectItem({ id: 2, key: "CA-2", phaseId: null, status: inProgress }),
       ]);
       sseHandler?.({ type: "tracker.phase.deleted" });
       await waitFor(() => expect(screen.queryByText("Persiapan")).toBeNull());
       expect(screen.getByText("No phase")).toBeTruthy();
       expect(screen.getByTestId("tracker-row-CA-1")).toBeTruthy();
     });

     it("carries the overdue marker on a near-complete phase with one live task past its end date", async () => {
       vi.setSystemTime(new Date("2026-10-05T12:00:00"));
       mockListTrackerItems.mockResolvedValueOnce([
         projectItem({ id: 1, key: "CA-1", phaseId: 9, status: done }),
         projectItem({ id: 2, key: "CA-2", phaseId: 9, status: done }),
         projectItem({
           id: 3,
           key: "CA-3",
           phaseId: 9,
           status: inProgress,
           endDate: "2026-09-20",
         }),
       ]);
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Persiapan"));
       expect(screen.getByLabelText(/overdue/i)).toBeTruthy();
       vi.useRealTimers();
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/pages/TrackerProjectPage.test.tsx`
   Expected failure: `Cannot find module './TrackerProjectPage'`

3. Implement:
   - `TrackerPhaseSection.tsx`: header with name, subtitle, `TrackerProgressBar`, date range
     and overdue marker; rows beneath, reusing `TrackerRow`
   - `TrackerProjectPage.tsx`: reads the project id from the route, fetches projects and
     items, filters items to this project, groups by `phaseId` with a "No phase" bucket,
     derives everything from `trackerRollup.ts`, persists collapse per project in
     `sessionStorage`, and subscribes to **nine** event types calling `loadData()`: the six
     new project/phase types PLUS the three existing item types
     `tracker.created` / `tracker.updated` / `tracker.deleted` (`realtime.ts:59-61`).
     Without the item types a teammate completing a task leaves this page's rollup stale,
     which the Realtime criterion forbids
   - Register the route in `client/src/App.tsx` as `tracker/p/:projectId`, placed so it can
     never fall through to `tracker/:key` (:72-77) whose handler would treat "p" as a key

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/pages/TrackerProjectPage.test.tsx`
   Then: `npm run test --workspace=client` and `npm run typecheck`
   Expected: PASS

5. Refactor while green (bounded):
   - If phase grouping duplicates the bucket logic already in `trackerRollup.ts`, import it
     rather than repeating it
   - If `TrackerProjectPage.tsx` passes ~300 lines, extract the sessionStorage collapse
     handling into a small named hook module
   - Re-run: `npm run test --workspace=client -- src/pages/TrackerProjectPage.test.tsx` — must stay PASS

6. Commit:
   `git add client/src/pages/TrackerProjectPage.tsx client/src/components/tracker/TrackerPhaseSection.tsx client/src/pages/TrackerProjectPage.test.tsx client/src/App.tsx`
   `git commit -m "feat(tracker): add the project work breakdown page"`

## REFERENCES LOADED

docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md —
rules: Home and project page, Rollup, Overdue, Phase lifecycle
client/src/App.tsx:66-77 — the `tracker` and `tracker/:key` routes the new route must not collide with
client/src/components/tracker/TrackerSection.tsx — the section header + flush rows pattern to mirror
client/src/lib/trackerRollup.ts — the derivation helper from T12

## WHY THIS APPROACH

Justification: a new page plus a new component and a routing change, with several distinct
states (empty, 404, collapsed, overdue) that each need their own verification.
Complexity: standard

## SANDWICH CONTEXT

[CRITICAL: `/tracker/p/:projectId` must never fall through to the `tracker/:key` route — that handler would parse "p" as an item key and 400.]
You are implementing the project WBS page for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — all progress, bounds and overdue come from `trackerRollup.ts` over fetched items.
Files in scope: `client/src/pages/TrackerProjectPage.tsx`, `TrackerPhaseSection.tsx`, the page test, `client/src/App.tsx` — no other files.
Test framework: Vitest with jsdom; run client tests with `npm run test --workspace=client`.
Available after: T12 (derivation), T13 (glyphs)
Architecture rule: this page persists phase collapse in `sessionStorage` per project — `/tracker` keeps its reset-on-navigation rule and must not change. React hooks rules are enforced in `client/src/`; unused imports fail typecheck.
[RESTATE: `/tracker/p/:projectId` must never fall through to the `tracker/:key` route — that handler would parse "p" as an item key and 400.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given project P, When its card is clicked, Then `/tracker/p/P` renders phases with rollups, date ranges, and a "No phase" section when needed
Given project P with zero phases and zero tasks, When opened, Then a CTA empty state invites creating the first phase
Given a member collapsed "Persiapan", When they return to `/tracker/p/P`, Then it is still collapsed
Given a collapsed phase, When an SSE event triggers the full `loadData()` reload, Then the collapse survives
Given a phase whose bar reads 83% (5 of 6) and whose one remaining live task is past its end date, When rendered, Then the phase carries the overdue marker beside the bar (a phase cannot be at 100% and hold a live task — a live task counts in the denominator)
Given member B viewing `/tracker/p/P`, When member A deletes project P, Then B is shown the 404 state rather than a stale page
Given member B on `/tracker/p/P`, When member A marks a task Done, Then B's phase and project percentages update without refreshing
Given member B on `/tracker/p/P`, When member A deletes phase "Persiapan", Then B's view moves those tasks into "No phase" without refreshing
[must-not] Given a nonexistent project id or a project from another workspace, When opened, Then a 404 state renders rather than an error
[must-not] Given this page, When it renders, Then no Gantt or timeline visualisation appears

All tests PASS. Commit exists with message matching `feat(tracker): …`.

## QUALITY BAR

Must-have:
  - Route registered so it cannot collide with the key pattern
  - Collapse persisted per project and reload-safe
  - CTA empty state per the calm-Linear direction
  - Derivation imported from `trackerRollup.ts`
  - Tests written BEFORE implementation

Must-not-have:
  - Any timeline, Gantt or roadmap rendering
  - A change to `/tracker`'s collapse behaviour
  - A local reimplementation of rollup or overdue
  - Modifications to files outside the listed scope

Open question risks:
  - Project date columns exist but are unused; the page shows a derived range only

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Timeline rendering added → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, client tests green, commit created
Uncertain when: the 404 state for a deleted-under-you project conflicts with the reload path
Escalate when: the route cannot be registered without disturbing `tracker/:key`

---

### Task 16: Date fields and project/phase pickers on input surfaces [depends: T11]

## OBJECTIVE

Let people actually set the new fields: dates on the create modal, and dates plus project
and phase pickers on the detail page.

Files:
- Create: `client/src/components/tracker/TrackerDateFields.tsx`
- Modify: `client/src/components/tracker/TrackerCreateModal.tsx`
- Modify: `client/src/pages/TrackerDetailPage.tsx`
- Test: `client/src/components/tracker/TrackerCreateModal.test.tsx`
- Test: `client/src/pages/TrackerDetailPage.test.tsx`

Steps:

1. Write failing tests for:
   - the create modal submits `startDate` and `endDate` when both are filled
   - the create modal submits without dates when they are left empty
   - the create modal surfaces the server's 400 for an inverted range as an inline message
   - the detail page renders start and end fields and saves them
   - the detail page offers project and phase pickers, and choosing a project resets the
     phase selection
   - the detail page shows the overdue marker for a past end date with a live status

   ```typescript
   // Appended to client/src/components/tracker/TrackerCreateModal.test.tsx —
   // reuses `renderModal`, `createTrackerItem` and the `statuses`/`priorities`
   // fixtures already declared at the top of this file. Import `ApiError`
   // alongside the existing `../../api` import (the mocked class the module
   // factory already exports).
   describe("TrackerCreateModal dates", () => {
     it("submits startDate and endDate when both are filled", async () => {
       renderModal();
       fireEvent.change(screen.getByLabelText("Item title"), {
         target: { value: "Ship the release" },
       });
       fireEvent.change(screen.getByLabelText(/start date/i), {
         target: { value: "2026-09-21" },
       });
       fireEvent.change(screen.getByLabelText(/end date/i), {
         target: { value: "2026-09-30" },
       });
       fireEvent.click(screen.getByRole("button", { name: "Create item" }));
       await waitFor(() =>
         expect(createTrackerItem).toHaveBeenCalledWith(7, {
           title: "Ship the release",
           statusId: 1,
           priorityId: null,
           startDate: "2026-09-21",
           endDate: "2026-09-30",
         }),
       );
     });

     it("submits without startDate or endDate when both are left empty", async () => {
       renderModal();
       fireEvent.change(screen.getByLabelText("Item title"), {
         target: { value: "No dates" },
       });
       fireEvent.click(screen.getByRole("button", { name: "Create item" }));
       await waitFor(() => expect(createTrackerItem).toHaveBeenCalled());
       const [, body] = createTrackerItem.mock.calls[0] as [number, Record<string, unknown>];
       expect(body).not.toHaveProperty("startDate");
       expect(body).not.toHaveProperty("endDate");
     });

     it("surfaces the server's 400 for an inverted date range inline", async () => {
       createTrackerItem.mockRejectedValueOnce(
         new ApiError("End date must be on or after the start date.", 400),
       );
       renderModal();
       fireEvent.change(screen.getByLabelText("Item title"), {
         target: { value: "Bad range" },
       });
       fireEvent.change(screen.getByLabelText(/start date/i), {
         target: { value: "2026-09-30" },
       });
       fireEvent.change(screen.getByLabelText(/end date/i), {
         target: { value: "2026-09-21" },
       });
       fireEvent.click(screen.getByRole("button", { name: "Create item" }));
       expect(
         await screen.findByText("End date must be on or after the start date."),
       ).toBeTruthy();
       expect(screen.getByLabelText("Item title")).toBeTruthy();
     });
   });
   ```

   ```typescript
   // Appended to client/src/pages/TrackerDetailPage.test.tsx — reuses the
   // mocked api, `item` fixture, `backlog`/`inProgress` statuses and `ApiError`
   // import already declared at the top of this file. Extend the top-level
   // `vi.hoisted` block and `vi.mock("../api", …)` factory with one more entry
   // (`mockListTrackerProjects` → `listTrackerProjects`), matching the shape
   // already there, and default it to `[projectA, projectB]` below.
   import type { TrackerPhase, TrackerProject } from "../types";

   const persiapan: TrackerPhase = {
     id: 9,
     projectId: 1,
     name: "Persiapan",
     subtitle: "",
     startDate: null,
     endDate: null,
     position: 1024,
     version: 1,
     createdAt: "2026-08-01T00:00:00Z",
     updatedAt: "2026-08-01T00:00:00Z",
   };

   const projectA: TrackerProject = {
     id: 1,
     name: "Rilis v2",
     startDate: null,
     endDate: null,
     position: 1024,
     version: 1,
     phases: [persiapan],
     createdAt: "2026-08-01T00:00:00Z",
     updatedAt: "2026-08-01T00:00:00Z",
   };

   const projectB: TrackerProject = {
     id: 2,
     name: "Rilis v3",
     startDate: null,
     endDate: null,
     position: 2048,
     version: 1,
     phases: [],
     createdAt: "2026-08-01T00:00:00Z",
     updatedAt: "2026-08-01T00:00:00Z",
   };

   beforeEach(() => {
     mockListTrackerProjects.mockResolvedValue([projectA, projectB]);
   });

   describe("TrackerDetailPage dates and project/phase pickers", () => {
     it("sets and saves start and end dates from the property rail", async () => {
       mockUpdateTrackerItem.mockResolvedValue({
         ...item,
         startDate: "2026-09-21",
         endDate: "2026-09-30",
         version: 2,
       });
       render(<TrackerDetailPage />);
       await waitFor(() => screen.getByDisplayValue("Workspace Rename"));
       fireEvent.change(screen.getByLabelText(/start date/i), {
         target: { value: "2026-09-21" },
       });
       fireEvent.change(screen.getByLabelText(/end date/i), {
         target: { value: "2026-09-30" },
       });
       fireEvent.click(screen.getByRole("button", { name: /save/i }));
       await waitFor(() =>
         expect(mockUpdateTrackerItem).toHaveBeenCalledWith(7, "CK-42", {
           title: "Workspace Rename",
           description: "details",
           startDate: "2026-09-21",
           endDate: "2026-09-30",
           version: 1,
         }),
       );
     });

     it("resets the phase selection when a different project is picked", async () => {
       mockUpdateTrackerItem
         .mockResolvedValueOnce({ ...item, projectId: 1, phaseId: null, version: 2 })
         .mockResolvedValueOnce({ ...item, projectId: 1, phaseId: 9, version: 3 })
         .mockResolvedValueOnce({ ...item, projectId: 2, phaseId: null, version: 4 });
       render(<TrackerDetailPage />);
       await waitFor(() => screen.getByDisplayValue("Workspace Rename"));

       // Assign the first project — the phase starts unset.
       fireEvent.click(await screen.findByRole("button", { name: /project/i }));
       fireEvent.click(screen.getByRole("option", { name: /rilis v2/i }));
       await waitFor(() =>
         expect(mockUpdateTrackerItem).toHaveBeenCalledWith(7, "CK-42", {
           projectId: 1,
           phaseId: null,
           version: 1,
         }),
       );

       // Pick a phase within that project.
       fireEvent.click(screen.getByRole("button", { name: /phase/i }));
       fireEvent.click(screen.getByRole("option", { name: /persiapan/i }));
       await waitFor(() =>
         expect(mockUpdateTrackerItem).toHaveBeenLastCalledWith(7, "CK-42", {
           projectId: 1,
           phaseId: 9,
           version: 2,
         }),
       );

       // Switching projects clears the now-inconsistent phase in the same request.
       fireEvent.click(screen.getByRole("button", { name: /rilis v2/i }));
       fireEvent.click(screen.getByRole("option", { name: /rilis v3/i }));
       await waitFor(() =>
         expect(mockUpdateTrackerItem).toHaveBeenLastCalledWith(7, "CK-42", {
           projectId: 2,
           phaseId: null,
           version: 3,
         }),
       );
     });

     it("shows the overdue marker for a past end date with a live status", async () => {
       mockGetTrackerItem.mockResolvedValue({
         ...item,
         status: inProgress,
         endDate: "2026-07-01",
       });
       vi.setSystemTime(new Date("2026-08-05T12:00:00"));
       render(<TrackerDetailPage />);
       await waitFor(() => screen.getByDisplayValue("Workspace Rename"));
       expect(screen.getByLabelText(/overdue/i)).toBeTruthy();
       vi.useRealTimers();
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/components/tracker/TrackerCreateModal.test.tsx src/pages/TrackerDetailPage.test.tsx`
   Expected failure: no date inputs found

3. Implement:
   - `TrackerDateFields.tsx`: a shared start/end date field pair, created **unconditionally**
     in this task — not as a conditional refactor. Both surfaces below use it, and T18 reuses
     it for explicit phase dates, so it must exist by the end of this task
   - `TrackerCreateModal.tsx`: add the shared date fields to the existing chip-row property
     layout, following its current picker composition
   - `TrackerDetailPage.tsx`: add date fields to the property rail, plus project and phase
     pickers built on `TrackerPropertyPicker`; selecting a project clears the phase choice
     so an inconsistent pair can never be submitted
   - Both surfaces send `YYYY-MM-DD` strings and rely on server validation for the inverted
     range, rendering the returned message inline

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/components/tracker/TrackerCreateModal.test.tsx src/pages/TrackerDetailPage.test.tsx`
   Then: `npm run test --workspace=client` and `npm run typecheck`
   Expected: PASS

5. Refactor while green (bounded):
   - Confirm neither surface carries its own copy of the date markup — both must render
     `TrackerDateFields`. If either inlined it, move it into the shared component
   - Re-run both test files — must stay PASS

6. Commit:
   `git add client/src/components/tracker/TrackerDateFields.tsx client/src/components/tracker/TrackerCreateModal.tsx client/src/pages/TrackerDetailPage.tsx client/src/components/tracker/TrackerCreateModal.test.tsx client/src/pages/TrackerDetailPage.test.tsx`
   `git commit -m "feat(tracker): add schedule fields and project pickers to item surfaces"`

## REFERENCES LOADED

docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md —
rules: Scheduling, Project / phase assignment
client/src/components/tracker/TrackerCreateModal.tsx — the chip-row property layout to extend
client/src/pages/TrackerDetailPage.tsx — the document-with-property-rail layout to extend
client/src/components/tracker/TrackerPropertyPicker.tsx — the picker the new selectors reuse
docs/pocket/rule/creative-brief.md — input states, 6px radius, Work Sans, neutral-friendly copy

## WHY THIS APPROACH

Justification: two established surfaces, both extended with the same field set, where the
picker interaction rule (project resets phase) carries real correctness weight.
Complexity: standard

## SANDWICH CONTEXT

[CRITICAL: choosing a project MUST reset the phase selection — the client must never submit a phase belonging to a different project.]
You are implementing the item input surfaces for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — these surfaces submit raw ids and dates; the server validates and the client derives display state.
Files in scope: `TrackerDateFields.tsx`, `TrackerCreateModal.tsx`, `TrackerDetailPage.tsx` and the two test files — no other files.
Test framework: Vitest with jsdom; run client tests with `npm run test --workspace=client`.
Available after: T11 (client types and API)
Architecture rule: dates travel as `YYYY-MM-DD` strings; reuse `TrackerPropertyPicker` rather than building a new picker; follow the creative brief for input states and copy.
[RESTATE: choosing a project MUST reset the phase selection — the client must never submit a phase belonging to a different project.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given the create modal, When a member sets start 2026-09-21 and end 2026-09-30, Then both are submitted as `YYYY-MM-DD` strings
Given the create modal, When dates are left empty, Then the item is created without them
Given the detail page, When a member sets dates, Then they save and the range renders
Given the detail page, When a member picks a different project, Then the phase selection resets
Given a task with a past end date and a live status, When the detail page renders, Then the overdue marker appears
[must-not] Given an inverted range, When submitted, Then the server's 400 is surfaced inline rather than swallowed
[must-not] Given the pickers, When used, Then a phase from another project can never be submitted

All tests PASS. Commit exists with message matching `feat(tracker): …`.

## QUALITY BAR

Must-have:
  - Project change resets phase selection
  - Dates submitted as calendar strings
  - Server validation errors surfaced inline in the brief's neutral-friendly register
  - Tests written BEFORE implementation

Must-not-have:
  - Client-side duplication of the server's date validation rules beyond basic input typing
  - A second picker implementation
  - Comments or attachments UI
  - Modifications to files outside the listed scope

Open question risks:
  - none

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - A phase from a different project submittable → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, client tests green, commit created
Uncertain when: the detail page's existing save path cannot carry the new fields without restructuring
Escalate when: the picker cannot express the project→phase dependency without a new component

---

### Task 17: Drag reorder UI [depends: T15, T8, T18]

## OBJECTIVE

Let people drag tasks into order inside a phase, calling the reorder endpoint. This is the
last task and is cuttable — the endpoint and column ship regardless.

Files:
- Modify: `client/src/pages/TrackerProjectPage.tsx`
- Modify: `client/src/components/tracker/TrackerPhaseSection.tsx`
- Test: `client/src/pages/TrackerProjectPage.test.tsx`

Steps:

1. Write failing tests in `client/src/pages/TrackerProjectPage.test.tsx` for:
   - dropping a task at a new index calls `reorderTrackerItem` with that target
   - the list shows the new order optimistically before the request resolves
   - a failed reorder restores the previous order and shows an error toast
   - dragging is scoped within one phase — a drop outside the source phase is rejected

   ```typescript
   // Appended to client/src/pages/TrackerProjectPage.test.tsx — reuses the
   // mocked api, `project`/`persiapan`/`pengembangan` fixtures, `projectItem`
   // helper and `mockUseBoard`/`mockShowToast` already declared in this file
   // (see T15). Extend the top-level `vi.hoisted` block and the
   // `vi.mock("../api", …)` factory with `mockReorderTrackerItem` →
   // `reorderTrackerItem`, matching the shape already there.
   //
   // dnd-kit's keyboard sensor is exercised directly — focus the row's drag
   // handle, Space to pick up, Arrow to move, Space to drop — rather than
   // simulating pointer geometry jsdom does not lay out. This is the
   // documented accessible path through `sortableKeyboardCoordinates` and
   // exercises the same `onDragEnd` callback a pointer drag would.
   function pressReorder(handleName: RegExp, direction: "ArrowDown" | "ArrowUp") {
     const handle = screen.getByRole("button", { name: handleName });
     handle.focus();
     fireEvent.keyDown(handle, { key: " " });
     fireEvent.keyDown(handle, { key: direction });
     fireEvent.keyDown(handle, { key: " " });
   }

   beforeEach(() => {
     // Two tasks in Persiapan (CA-1, CA-2) and two in Pengembangan (CB-1,
     // CB-2), so cross-phase scoping has something to violate if it is broken.
     mockListTrackerItems.mockResolvedValue([
       projectItem({ id: 1, key: "CA-1", phaseId: 9, position: 1024 }),
       projectItem({ id: 2, key: "CA-2", phaseId: 9, position: 2048 }),
       projectItem({ id: 3, key: "CB-1", phaseId: 10, position: 1024 }),
       projectItem({ id: 4, key: "CB-2", phaseId: 10, position: 2048 }),
     ]);
   });

   describe("TrackerProjectPage drag reorder", () => {
     it("calls reorderTrackerItem with the drop target when a task moves within its phase", async () => {
       mockReorderTrackerItem.mockResolvedValue(
         projectItem({ id: 1, key: "CA-1", phaseId: 9, position: 3072 }),
       );
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
       pressReorder(/reorder ca-1/i, "ArrowDown");
       await waitFor(() =>
         expect(mockReorderTrackerItem).toHaveBeenCalledWith(
           7,
           "CA-1",
           expect.any(Object),
         ),
       );
     });

     it("shows the new order optimistically before the request resolves", async () => {
       let resolveReorder: (value: TrackerItem) => void = () => {};
       mockReorderTrackerItem.mockImplementation(
         () =>
           new Promise((resolve) => {
             resolveReorder = resolve;
           }),
       );
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
       pressReorder(/reorder ca-1/i, "ArrowDown");
       await waitFor(() => expect(mockReorderTrackerItem).toHaveBeenCalled());
       const order = screen
         .getAllByTestId(/^tracker-row-CA-/)
         .map((row) => row.dataset.testid);
       expect(order).toEqual(["tracker-row-CA-2", "tracker-row-CA-1"]);
       resolveReorder(projectItem({ id: 1, key: "CA-1", phaseId: 9 }));
     });

     it("restores the previous order and shows an error toast when the reorder fails", async () => {
       mockReorderTrackerItem.mockRejectedValue(new Error("network down"));
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
       pressReorder(/reorder ca-1/i, "ArrowDown");
       await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
       expect(mockShowToast.mock.calls[0]?.[1]).toBe("error");
       const order = screen
         .getAllByTestId(/^tracker-row-CA-/)
         .map((row) => row.dataset.testid);
       expect(order).toEqual(["tracker-row-CA-1", "tracker-row-CA-2"]);
     });

     it("never lets a drag inside one phase touch another phase's order or items", async () => {
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
       const phaseBBefore = screen
         .getAllByTestId(/^tracker-row-CB-/)
         .map((row) => row.dataset.testid);

       pressReorder(/reorder ca-1/i, "ArrowDown");
       await waitFor(() => expect(mockReorderTrackerItem).toHaveBeenCalled());

       expect(mockReorderTrackerItem).toHaveBeenCalledTimes(1);
       expect(mockReorderTrackerItem.mock.calls[0]?.[1]).toBe("CA-1");
       const phaseBAfter = screen
         .getAllByTestId(/^tracker-row-CB-/)
         .map((row) => row.dataset.testid);
       expect(phaseBAfter).toEqual(phaseBBefore);
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/pages/TrackerProjectPage.test.tsx`
   Expected failure: no drag handlers wired; `reorderTrackerItem` never called

3. Implement using the **legacy dnd-kit preset API** already used by Board
   (`@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0):
   - Wrap each phase's rows in `DndContext` with `PointerSensor` and `KeyboardSensor`
     (`sortableKeyboardCoordinates`), `collisionDetection={closestCenter}`
   - `SortableContext` with `verticalListSortingStrategy` over that phase's item ids
   - `onDragEnd` computes old and new index, applies `arrayMove` optimistically, then calls
     `api.reorderTrackerItem`; on failure restore the snapshot and toast, mirroring the
     rollback style already in `TrackerPage.tsx:140-203`
   - Do NOT use the newer `@dnd-kit/react` `useSortable` API — it is not installed

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/pages/TrackerProjectPage.test.tsx`
   Then: `npm run test --workspace=client` and `npm run typecheck`
   Expected: PASS

5. Refactor while green (bounded):
   - If the optimistic-then-rollback pattern now appears in both `TrackerPage.tsx` and here,
     extract it into a named module under `client/src/lib/` and use it in both
   - Re-run: `npm run test --workspace=client -- src/pages/TrackerProjectPage.test.tsx` — must stay PASS

6. Commit:
   `git add client/src/pages/TrackerProjectPage.tsx client/src/components/tracker/TrackerPhaseSection.tsx client/src/pages/TrackerProjectPage.test.tsx`
   `git commit -m "feat(tracker): add drag reordering inside phases"`

## REFERENCES LOADED

docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md —
rule: Ordering, including that this UI is cuttable while the endpoint is not
context7 `/clauderic/dnd-kit` — `SortableContext` + `verticalListSortingStrategy` + `arrayMove`
in `onDragEnd`; the installed version uses this legacy preset API, not `@dnd-kit/react`
client/src/pages/TrackerPage.tsx:133-203 — the existing optimistic-update-with-rollback and
in-flight-request discipline to mirror

## WHY THIS APPROACH

Justification: two files with well-understood library usage and an existing rollback pattern
to follow, but real interaction state to get right.
Complexity: standard

## SANDWICH CONTEXT

[CRITICAL: use the LEGACY dnd-kit preset API (`@dnd-kit/core` + `@dnd-kit/sortable`) — the `@dnd-kit/react` `useSortable` API in current docs is NOT installed in this repo.]
You are implementing drag reordering for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — the client reorders optimistically and the server owns the fractional position.
Files in scope: `client/src/pages/TrackerProjectPage.tsx`, `TrackerPhaseSection.tsx`, the page test — no other files.
Test framework: Vitest with jsdom; run client tests with `npm run test --workspace=client`.
Available after: T15 (the page), T8 (the endpoint)
Architecture rule: this task is CUTTABLE — if it is dropped, the reorder endpoint and the `position` column must remain shipped and tested. Do not make anything else depend on this task.
[RESTATE: use the LEGACY dnd-kit preset API (`@dnd-kit/core` + `@dnd-kit/sortable`) — the `@dnd-kit/react` `useSortable` API in current docs is NOT installed in this repo.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given tasks A, B, C in a phase, When C is dragged between A and B, Then `reorderTrackerItem` is called with that target position
Given a drag in progress, When the drop lands, Then the new order shows before the request resolves
Given a failed reorder, When the request rejects, Then the previous order is restored and an error toast appears
[must-not] Given a drop outside the source phase, When it lands, Then no cross-phase reorder is submitted
[must-not] Given this task is cut, When the cycle ships, Then the reorder endpoint and `position` column remain present and tested

All tests PASS. Commit exists with message matching `feat(tracker): …`.

## QUALITY BAR

Must-have:
  - Legacy dnd-kit preset API
  - Optimistic update with rollback on failure
  - Keyboard sensor wired for accessibility, as the Board usage does
  - Tests written BEFORE implementation

Must-not-have:
  - `@dnd-kit/react` imports
  - Cross-phase drag (that is assignment, handled by T7 and T16)
  - Any change to Board's drag code
  - Modifications to files outside the listed scope

Open question risks:
  - none

Rollback note:
  - Cutting this task leaves the endpoint and column intact; nothing else depends on it.

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Another task made dependent on this one → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, client tests green, commit created
Uncertain when: the installed dnd-kit version's API differs from the legacy preset expected here
Escalate when: reordering cannot be scoped to a single phase with the chosen collision strategy

---

### Task 18: Project and phase management UI [depends: T15, T16]

## OBJECTIVE

Make the project page's management affordances real: rename and delete the project, and
create, rename and delete phases — including the delete confirmation that names how many
tasks will be released and the 409 conflict UX.

Without this task the API methods T11 ships are never called by anything, and four
acceptance criteria render as inert UI.

Files:
- Modify: `client/src/pages/TrackerProjectPage.tsx`
- Modify: `client/src/components/tracker/TrackerPhaseSection.tsx`
- Create: `client/src/components/tracker/TrackerPhaseEditor.tsx`
- Test: `client/src/pages/TrackerProjectPage.test.tsx`

Steps:

1. Write failing tests in `client/src/pages/TrackerProjectPage.test.tsx` for:
   - renaming the project calls `updateTrackerProject` with the current version and the
     header shows the new name
   - a stale rename returns 409 and shows the card-mirror conflict UX (warning toast plus a
     refresh), matching the existing handling in `TrackerPage.tsx:180-188`
   - clicking Delete on a project holding 18 tasks shows a confirmation stating
     "18 tasks will be released to the unassigned list"
   - confirming the delete calls `deleteTrackerProject` and navigates back to `/tracker`
   - an empty project's CTA creates the first phase via `createTrackerPhase`
   - adding a phase appends it after the existing last phase
   - renaming a phase calls `updateTrackerPhase`; a stale version shows the same 409 UX
   - deleting a phase confirms, calls `deleteTrackerPhase`, and its tasks appear under
     "No phase" without a manual refresh
   - setting explicit phase dates calls `updateTrackerPhase` and an inverted range surfaces
     the server's 400 inline

   ```typescript
   // Appended to client/src/pages/TrackerProjectPage.test.tsx — reuses the
   // mocked api, `project`/`persiapan`/`pengembangan` fixtures, `projectItem`
   // helper, `ApiError` and `mockUseBoard`/`mockShowToast`/`mockNavigate`
   // already declared in this file (see T15). Extend the top-level
   // `vi.hoisted` block and the `vi.mock("../api", …)` factory with five more
   // entries, matching the shape already there:
   //
   //   mockUpdateTrackerProject, mockDeleteTrackerProject,
   //   mockCreateTrackerPhase, mockUpdateTrackerPhase, mockDeleteTrackerPhase
   //   → updateTrackerProject, deleteTrackerProject, createTrackerPhase,
   //     updateTrackerPhase, deleteTrackerPhase

   describe("TrackerProjectPage project and phase management", () => {
     it("renames the project with the current version and updates the header", async () => {
       mockUpdateTrackerProject.mockResolvedValue({
         ...project,
         name: "Rilis v2.1",
         version: 2,
       });
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Rilis v2"));
       fireEvent.click(screen.getByRole("button", { name: /rename project/i }));
       fireEvent.change(screen.getByLabelText(/project name/i), {
         target: { value: "Rilis v2.1" },
       });
       fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
       await waitFor(() =>
         expect(mockUpdateTrackerProject).toHaveBeenCalledWith(7, 1, {
           name: "Rilis v2.1",
           version: 1,
         }),
       );
       expect(await screen.findByText("Rilis v2.1")).toBeTruthy();
     });

     it("shows the card-mirror conflict UX when a project rename is stale", async () => {
       mockUpdateTrackerProject.mockRejectedValueOnce(
         new ApiError("conflict", 409, "version_conflict"),
       );
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Rilis v2"));
       fireEvent.click(screen.getByRole("button", { name: /rename project/i }));
       fireEvent.change(screen.getByLabelText(/project name/i), {
         target: { value: "Rilis v2.1" },
       });
       fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
       await waitFor(() =>
         expect(mockShowToast).toHaveBeenCalledWith(
           expect.stringMatching(/someone else updated this project/i),
           "warning",
         ),
       );
       // The conflict path reloads rather than trusting the failed response.
       expect(mockListTrackerProjects).toHaveBeenCalledTimes(2);
     });

     it("states the released task count in the delete confirmation", async () => {
       mockListTrackerItems.mockResolvedValueOnce(
         Array.from({ length: 18 }, (_, i) =>
           projectItem({ id: i + 1, key: `CA-${i + 1}`, phaseId: 9 }),
         ),
       );
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Rilis v2"));
       fireEvent.click(screen.getByRole("button", { name: /project menu/i }));
       fireEvent.click(screen.getByRole("menuitem", { name: /delete project/i }));
       expect(
         await screen.findByText(/18 tasks will be released to the unassigned list/i),
       ).toBeTruthy();
     });

     it("deletes the project on confirmation and returns to /tracker", async () => {
       mockDeleteTrackerProject.mockResolvedValue(undefined);
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Rilis v2"));
       fireEvent.click(screen.getByRole("button", { name: /project menu/i }));
       fireEvent.click(screen.getByRole("menuitem", { name: /delete project/i }));
       await screen.findByText(/will be released to the unassigned list/i);
       fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
       await waitFor(() => expect(mockDeleteTrackerProject).toHaveBeenCalledWith(7, 1));
       expect(mockNavigate).toHaveBeenCalledWith("/tracker");
     });

     it("creates the first phase from the empty project's CTA", async () => {
       mockListTrackerProjects.mockResolvedValueOnce([
         { ...project, id: 5, name: "Rilis v3", phases: [] },
       ]);
       mockListTrackerItems.mockResolvedValueOnce([]);
       mockUseParams.mockReturnValue({ projectId: "5" });
       mockCreateTrackerPhase.mockResolvedValue(persiapan);
       render(<TrackerProjectPage />);
       fireEvent.click(await screen.findByRole("button", { name: /create.*phase/i }));
       fireEvent.change(screen.getByLabelText(/phase name/i), {
         target: { value: "Persiapan" },
       });
       fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
       await waitFor(() =>
         expect(mockCreateTrackerPhase).toHaveBeenCalledWith(7, 5, {
           name: "Persiapan",
         }),
       );
     });

     it("appends a new phase after the existing last phase", async () => {
       mockCreateTrackerPhase.mockResolvedValue({
         ...pengembangan,
         id: 11,
         name: "Peluncuran",
         position: 3072,
       });
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Pengembangan"));
       fireEvent.click(screen.getByRole("button", { name: /add phase/i }));
       fireEvent.change(screen.getByLabelText(/phase name/i), {
         target: { value: "Peluncuran" },
       });
       fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
       await waitFor(() => expect(mockCreateTrackerPhase).toHaveBeenCalled());
       const order = screen
         .getAllByTestId(/^phase-/)
         .map((section) => section.dataset.testid);
       expect(order).toEqual(["phase-Persiapan", "phase-Pengembangan", "phase-Peluncuran"]);
     });

     it("renames a phase and shows the same 409 conflict UX on a stale version", async () => {
       mockUpdateTrackerPhase.mockResolvedValueOnce({
         ...persiapan,
         name: "Persiapan awal",
         version: 2,
       });
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Persiapan"));
       fireEvent.click(screen.getByRole("button", { name: /rename phase persiapan/i }));
       fireEvent.change(screen.getByLabelText(/phase name/i), {
         target: { value: "Persiapan awal" },
       });
       fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
       await waitFor(() =>
         expect(mockUpdateTrackerPhase).toHaveBeenCalledWith(7, 1, 9, {
           name: "Persiapan awal",
           version: 1,
         }),
       );
       expect(await screen.findByText("Persiapan awal")).toBeTruthy();

       mockUpdateTrackerPhase.mockRejectedValueOnce(
         new ApiError("conflict", 409, "version_conflict"),
       );
       fireEvent.click(screen.getByRole("button", { name: /rename phase persiapan awal/i }));
       fireEvent.change(screen.getByLabelText(/phase name/i), {
         target: { value: "Persiapan lagi" },
       });
       fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
       await waitFor(() =>
         expect(mockShowToast).toHaveBeenCalledWith(
           expect.stringMatching(/someone else updated this phase/i),
           "warning",
         ),
       );
     });

     it('deletes a phase on confirmation and moves its tasks into "No phase" without a manual refresh', async () => {
       mockDeleteTrackerPhase.mockResolvedValue(undefined);
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Persiapan"));

       // Queued before the click so the reload the delete triggers picks it up —
       // queuing it after would race the component's own refetch.
       mockListTrackerProjects.mockResolvedValueOnce([
         { ...project, phases: [pengembangan] },
       ]);
       mockListTrackerItems.mockResolvedValueOnce([
         projectItem({ id: 1, key: "CA-1", phaseId: null }),
         projectItem({ id: 2, key: "CA-2", phaseId: null }),
       ]);
       fireEvent.click(screen.getByRole("button", { name: /delete phase persiapan/i }));
       fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
       await waitFor(() => expect(mockDeleteTrackerPhase).toHaveBeenCalledWith(7, 1, 9));
       await waitFor(() => expect(screen.getByText("No phase")).toBeTruthy());
       expect(screen.getByTestId("tracker-row-CA-1")).toBeTruthy();
     });

     it("sets explicit phase dates and surfaces the server's 400 for an inverted range inline", async () => {
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Persiapan"));
       fireEvent.click(screen.getByRole("button", { name: /rename phase persiapan/i }));
       fireEvent.change(screen.getByLabelText(/start date/i), {
         target: { value: "2026-09-01" },
       });
       fireEvent.change(screen.getByLabelText(/end date/i), {
         target: { value: "2026-09-20" },
       });
       fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
       await waitFor(() =>
         expect(mockUpdateTrackerPhase).toHaveBeenCalledWith(7, 1, 9, {
           name: "Persiapan",
           startDate: "2026-09-01",
           endDate: "2026-09-20",
           version: 1,
         }),
       );

       mockUpdateTrackerPhase.mockRejectedValueOnce(
         new ApiError("End date must be on or after the start date.", 400),
       );
       fireEvent.click(screen.getByRole("button", { name: /rename phase persiapan/i }));
       fireEvent.change(screen.getByLabelText(/start date/i), {
         target: { value: "2026-09-30" },
       });
       fireEvent.change(screen.getByLabelText(/end date/i), {
         target: { value: "2026-09-01" },
       });
       fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
       expect(
         await screen.findByText("End date must be on or after the start date."),
       ).toBeTruthy();
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/pages/TrackerProjectPage.test.tsx`
   Expected failure: no rename control found; `updateTrackerProject` never called

3. Implement:
   - `TrackerPhaseEditor.tsx`: the create/rename form for a phase — name, subtitle, optional
     start and end dates — reusing the date fields T16 introduces rather than duplicating
     them, and surfacing server validation inline
   - `TrackerPhaseSection.tsx`: add rename and delete affordances to the phase header,
     revealed on hover/focus in the same low-visibility manner the existing section header
     uses for its create control
   - `TrackerProjectPage.tsx`: project header gains rename (inline edit) and delete (menu),
     both carrying `version` and handling 409 by toasting and reloading; the delete
     confirmation counts this project's tasks via the already-fetched item list and states
     the number; on success navigate to `/tracker`
   - All copy follows the creative brief's neutral-friendly register

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/pages/TrackerProjectPage.test.tsx`
   Then: `npm run test --workspace=client` and `npm run typecheck`
   Expected: PASS

5. Refactor while green (bounded):
   - The 409 conflict handling now appears on project rename, phase rename and the item
     paths in `TrackerPage.tsx` — if it is written a third time, extract a named helper
     under `client/src/lib/` and use it in all three
   - If `TrackerProjectPage.tsx` passes ~300 lines, extract the project header into its own
     component file
   - Re-run: `npm run test --workspace=client -- src/pages/TrackerProjectPage.test.tsx` — must stay PASS

6. Commit:
   `git add client/src/pages/TrackerProjectPage.tsx client/src/components/tracker/TrackerPhaseSection.tsx client/src/components/tracker/TrackerPhaseEditor.tsx client/src/pages/TrackerProjectPage.test.tsx`
   `git commit -m "feat(tracker): manage projects and phases from the work breakdown page"`

## REFERENCES LOADED

docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md —
rules: Project lifecycle, Phase lifecycle; the delete confirmation copy is fixed by the spec
client/src/pages/TrackerPage.tsx:173-194 — the existing 409 conflict UX (warning toast then
reload) this task mirrors
client/src/components/tracker/TrackerSection.tsx — the hover-revealed header control pattern
client/src/api.ts — the project and phase methods T11 ships, which this task is the only caller of

## WHY THIS APPROACH

Justification: three files with several mutation flows, each needing optimistic-locking
conflict handling and a destructive confirmation whose copy is specified.
Complexity: standard

## SANDWICH CONTEXT

[CRITICAL: the project delete confirmation MUST state how many tasks will be released — this is the one irreversible operation in the cycle and the user is entitled to the number before confirming.]
You are implementing project and phase management for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — the task count in the confirmation is derived from the already-fetched item list, not a new endpoint.
Files in scope: `client/src/pages/TrackerProjectPage.tsx`, `TrackerPhaseSection.tsx`, `TrackerPhaseEditor.tsx`, the page test — no other files.
Test framework: Vitest with jsdom; run client tests with `npm run test --workspace=client`.
Available after: T15 (the page these controls live on)
Architecture rule: every mutation sends `version` and handles 409 with the card-mirror UX. No new endpoint may be added — use the API methods from T11.
[RESTATE: the project delete confirmation MUST state how many tasks will be released — this is the one irreversible operation in the cycle and the user is entitled to the number before confirming.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given project P is named "Rilis v2", When renamed to "Rilis v2.1" with the current version, Then the header shows the new name
Given project P holds 18 tasks, When Delete is clicked, Then the confirmation states that 18 tasks will be released to the unassigned list
Given the confirmation is accepted, When the delete succeeds, Then the user lands back on `/tracker` and the released tasks appear there
Given project P has phases "Persiapan" and "Pengembangan", When "Peluncuran" is added, Then it appears after "Pengembangan"
Given phase "Persiapan" with 5 tasks, When renamed then deleted, Then rename succeeds and its tasks appear under "No phase" without a manual refresh
Given a project with zero phases and zero tasks, When the CTA is used, Then the first phase is created
[must-not] Given a stale version on a project or phase rename, When saved, Then a 409 surfaces as the card-mirror conflict UX rather than a silent failure
[must-not] Given an inverted explicit phase range, When saved, Then the server's 400 is surfaced inline

All tests PASS. Commit exists with message matching `feat(tracker): …`.

## QUALITY BAR

Must-have:
  - Delete confirmation states the task count, in the spec's wording
  - `version` sent on every mutation; 409 handled with the existing conflict UX
  - Date fields reused from T16, not duplicated
  - Tests written BEFORE implementation

Must-not-have:
  - A new endpoint or a count query just for the confirmation
  - Deleting a project without confirmation
  - Any Roadmap or timeline rendering
  - Modifications to files outside the listed scope

Open question risks:
  - none

Rollback note:
  - Project deletion is not reversible by deploy revert; the confirmation is the last
    safeguard before an irreversible release.

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Destructive delete without the count in the confirmation → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, client tests green, commit created
Uncertain when: the task count for the confirmation is unavailable because items have not loaded
Escalate when: the 409 UX cannot be reused without changing `TrackerPage.tsx`

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|-----------------|
| T1 | Schema migration | prereq | standard | Re-running the migration changes no category and no position |
| T2 | Shared contracts — types + event union | T1 | lightweight | `npm run typecheck` passes with the new tables and events |
| T3 | Vocabulary seeding at creation | T2 | standard | A newly created workspace already holds 5 statuses with categories |
| T4 | Vocabulary route — category + lock | T2 | lightweight | `kind=status` POST returns 400; label POST still 201 |
| T5 | Item parsers — extract + validate | T2 | standard | `{projectId: null, phaseId: X}` is rejected; gated integration suite passes |
| T6 | Item read path | T5 | standard | Payload carries `projectId`, `phaseId` and `status.category`, no names |
| T7 | Item write path — create + update | T6 | standard | Created items get a non-NULL position; assignment bumps version; `completed_at` stamps once and clears |
| T8 | Reorder endpoint | T7 | lightweight | Midpoint position written with version unchanged |
| T9 | Project routes | T5 | standard | 11th project returns 409; delete releases tasks and records triples |
| T10 | Phase routes | T9 | standard | Deleted phase releases tasks to "No phase" keeping project_id |
| T11 | Client contracts | T4, T6, T9, T10 | lightweight | API methods hit the right paths; item type carries raw ids only |
| T12 | Rollup derivation helper | T11 | standard | 63% with 5 of 8; all-canceled is "no active work" |
| T13 | Glyphs read category | T11 | lightweight | "Batal" renders cancelled with no name regex anywhere |
| T14 | Tracker home | T12, T13 | standard | In-project-only search shows results instead of the empty state; project creation works and the cap disables the control |
| T15 | Project WBS page | T12, T13 | standard | Phases show rollup and range; collapse survives reload; item events keep rollup live; 404 states work |
| T16 | Schedule fields + pickers | T11 | standard | Changing project resets phase; dates submit as calendar strings |
| T18 | Project + phase management UI | T15, T16 | standard | Delete confirmation names the released task count; 409 shows conflict UX |
| T17 | Drag reorder UI | T15, T8, T18 | standard | Drop calls reorder endpoint; failure restores order (CUTTABLE) |
