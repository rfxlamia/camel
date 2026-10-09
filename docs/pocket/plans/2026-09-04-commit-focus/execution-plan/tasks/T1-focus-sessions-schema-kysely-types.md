# Task T1 — `focus_sessions` schema + Kysely types

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 1: `focus_sessions` schema + Kysely types [prereq]

## OBJECTIVE

Add the `focus_sessions` table to `server/src/db/schema.sql` and its Kysely type to `server/src/db/types.ts`, so that a personal focus session is persistable with a database-enforced "at most one active session per (user, workspace)" guarantee.

Files:
- Modify: `server/src/db/schema.sql`
- Modify: `server/src/db/types.ts`
- Test: `server/src/db/focus-session-schema.test.ts`

The DDL is verified by asserting against the **text of `schema.sql`**, exactly as `server/src/db/board-tracker-unify-migration.test.ts` does. This needs no running database. Read that file before writing the test — it is the pattern.

Steps:

1. Write failing test for: `focus_sessions` table declares the personal-session columns and constraints
   Test file: `server/src/db/focus-session-schema.test.ts`
   Level: unit

   Test intent:
   Given `schema.sql` read as a string
   When the `focus_sessions` DDL is inspected
   Then:
   - a `CREATE TABLE IF NOT EXISTS focus_sessions` block exists
   - `user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE`
   - `workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
   - `task_source TEXT NOT NULL` with `CHECK (task_source IN ('board','tracker'))`
   - `task_id INTEGER NOT NULL` **with no `REFERENCES` clause** — the task link is logical (ADR #103), never a cross-table FK
   - `task_key TEXT` (nullable)
   - `return_path TEXT NOT NULL`
   - `state TEXT NOT NULL` with `CHECK (state IN ('ready','running','paused','finished'))`
   - `accumulated_seconds INTEGER NOT NULL DEFAULT 0` with `CHECK (accumulated_seconds >= 0)`
   - `running_since TIMESTAMPTZ` (nullable)
   - `version INTEGER NOT NULL DEFAULT 1`
   - `created_at` / `updated_at` `TIMESTAMPTZ NOT NULL DEFAULT now()`, `finished_at TIMESTAMPTZ` nullable
   - a table-level `CHECK` binding the two together: `running_since` is non-null exactly when `state = 'running'`

   Exercise through:
   - the file contents of `server/src/db/schema.sql` (read with `readFileSync(new URL("./schema.sql", import.meta.url), "utf8")`)

   Test doubles:
   - none — this reads a real file
   - do NOT mock: `node:fs`

   Expected RED:
   - `schema.sql` contains no `focus_sessions` DDL, so the first `expect(schemaSql).toMatch(...)` fails

2. Run test — verify FAIL: `npm run test --workspace=server -- src/db/focus-session-schema.test.ts`
   Expected failure: `AssertionError: expected '...' to match /CREATE TABLE IF NOT EXISTS focus_sessions/`

3. Implement minimal code to satisfy the test:
   File: `server/src/db/schema.sql`
   Implement: append a `-- Commit Focus: personal focus sessions` section at the end of the file with the `CREATE TABLE IF NOT EXISTS focus_sessions (...)` block. Follow the two-space-indented column style of `tracker_items`. `id SERIAL PRIMARY KEY`. Idempotent DDL only (`IF NOT EXISTS`) — `migrate()` re-runs the whole file on every `make db-migrate`.

4. Run test — verify PASS: `npm run test --workspace=server -- src/db/focus-session-schema.test.ts`
   Expected: PASS

5. Write failing test for: at most one non-finished session per (user, workspace)
   Test file: `server/src/db/focus-session-schema.test.ts`
   Level: unit

   Test intent:
   Given `schema.sql` read as a string
   When the focus session indexes are inspected
   Then:
   - a `CREATE UNIQUE INDEX IF NOT EXISTS` on `focus_sessions (user_id, workspace_id)` exists
   - it carries a `WHERE state <> 'finished'` partial predicate — so finished rows are retained and do not block a new session
   - a non-unique lookup index on `(user_id, workspace_id, finished_at)` exists for session history reads

   Exercise through:
   - the file contents of `server/src/db/schema.sql`

   Test doubles:
   - none

   Expected RED:
   - no unique index on `focus_sessions` exists yet

6. Run test — verify FAIL: `npm run test --workspace=server -- src/db/focus-session-schema.test.ts`
   Expected failure: assertion on the unique-index regex fails

7. Implement, then verify PASS: add both indexes below the table block. Run `npm run test --workspace=server -- src/db/focus-session-schema.test.ts` — expected PASS.

8. Write failing test for: Kysely `DB` registry exposes `focus_sessions`
   Test file: `server/src/db/focus-session-schema.test.ts`
   Level: unit

   Test intent:
   Given `server/src/db/types.ts` read as a string
   When the type registry is inspected
   Then:
   - an exported `interface FocusSessions` exists
   - it declares `id: Generated<number>`, `version: Generated<number>`, `accumulated_seconds: Generated<number>`, `created_at: Generated<Timestamp>`, `updated_at: Generated<Timestamp>`
   - it declares `running_since: Timestamp | null` and `finished_at: Timestamp | null`
   - the `DB` interface maps `focus_sessions: FocusSessions`

   Exercise through:
   - the file contents of `server/src/db/types.ts`, mirroring how `board-tracker-unify-migration.test.ts` asserts on `typesTs`

   Test doubles:
   - none

   Expected RED:
   - `types.ts` has no `FocusSessions` interface

9. Run test — verify FAIL: `npm run test --workspace=server -- src/db/focus-session-schema.test.ts`

10. Implement `FocusSessions` in `server/src/db/types.ts` (alphabetical field order, matching the file's existing style) and register it on `DB`. Verify PASS with the same command, then confirm the whole server suite is green: `npm run test`.

    Note: `types.ts` opens with `This file was generated by kysely-codegen. Please do not edit it manually.` Ignore it. `kysely-codegen` is a devDependency with no npm script wired up, and the repo edits this file by hand — `board-tracker-unify-migration.test.ts` asserts on its text for exactly that reason. Do not try to regenerate it.

11. Refactor while green (bounded):
    - Rule of three: no logic is introduced here; nothing to extract
    - Only `schema.sql` and `types.ts` may be touched
    - Re-run `npm run test --workspace=server -- src/db/focus-session-schema.test.ts` — must stay PASS

11a. Verify the DDL actually executes (the tests above only regex over file *text* — they cannot catch a SQL syntax error):
    `make db-migrate`
    Expected: migration completes with no error. Then run it a second time — it must be a no-op, proving idempotency.
    A malformed table-level `CHECK` passes every assertion in this task and fails only at deploy time. This step is the only gate that catches it. If no local database is reachable, report NEEDS_CONTEXT rather than committing unverified DDL.

12. Commit:
    `git add server/src/db/schema.sql server/src/db/types.ts server/src/db/focus-session-schema.test.ts`
    `git commit -m "feat(focus): add focus_sessions schema and Kysely types"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — rule: Focus entry (session persisted with `{source, id}`); Design Decision → "Proposed technical shape" table row `Schema`
- `docs/pocket/adr/2026-09-board-tracker-dual-table.md` — why `task_id` gets no cross-table FK and why `key_number` alone must never identify a task
- `server/src/db/schema.sql` — `tracker_items` block is the column-style and partial-index precedent (`idx_tracker_items_workspace_active`)
- `server/src/db/board-tracker-unify-migration.test.ts` — the regex-over-`schema.sql` test pattern this task reuses
- `server/src/db/types.ts` — `TrackerItems` shows the `Generated<T>` / `Timestamp | null` convention
- `server/src/db/migrate.ts` — confirms `schema.sql` is re-executed wholesale, so all DDL must be idempotent
- `Makefile` `db-migrate` target — applies `schema.sql`, `agent-schema.sql`, and `chat-schema.sql`; the only step in this task that actually executes the SQL

## WHY THIS APPROACH

Complexity: lightweight
Justification: two files, no branching logic, and the verification pattern already exists in the repo. The only judgment call — logical vs. real FK — is settled by ADR #103.

## SANDWICH CONTEXT

[CRITICAL: `focus_sessions.task_id` must have NO `REFERENCES` clause. The board/tracker dual-table shim (ADR #103) means a task id is only meaningful together with `task_source`; a real FK to either table is unrepresentable and would have to be ripped out.]

You are implementing the `focus_sessions` schema for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A — dedicated `/focus` surface backed by a server-persisted `focus_sessions` table with optimistic locking.
Files in scope: `server/src/db/schema.sql`, `server/src/db/types.ts`, `server/src/db/focus-session-schema.test.ts` — no other files.
Test framework: Vitest, node environment. Single file: `npm run test --workspace=server -- src/db/focus-session-schema.test.ts`.
Available after: none (prereq).
Architecture rule: all DDL in `schema.sql` is re-executed on every migration — it MUST be idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). Do not add a `focus_events` table; it is deferred to issue #107.

[RESTATE: `focus_sessions.task_id` must have NO `REFERENCES` clause — the task link is logical, discriminated by `task_source`, per ADR #103.]

## DELIVERABLE

Verification — task is DONE when all pass:

[derived] Given `schema.sql`, When the `focus_sessions` DDL is read, Then it declares `user_id`, `workspace_id`, `task_source`, `task_id`, `task_key`, `return_path`, `state`, `accumulated_seconds`, `running_since`, `version`, `created_at`, `updated_at`, `finished_at` with the constraints listed in Step 1
[derived] Given `schema.sql`, When the focus indexes are read, Then a unique index on `(user_id, workspace_id) WHERE state <> 'finished'` exists
[derived] Given `types.ts`, When the registry is read, Then `FocusSessions` is exported and mapped on `DB.focus_sessions`
[must-not] Given the `focus_sessions` DDL, When `task_id` is inspected, Then it must NOT carry a `REFERENCES cards(...)` or `REFERENCES tracker_items(...)` clause
[must-not] Given the `focus_sessions` DDL, When the unique index predicate is inspected, Then it must NOT be unconditional — finished sessions must remain insertable alongside a new active one

All tests PASS. `make db-migrate` applies the schema cleanly and is idempotent on a second run. Commit exists with message matching `feat(focus): add focus_sessions schema and Kysely types`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- Partial unique index enforces single active session per `(user_id, workspace_id)` at the database level, not in application code
- All DDL idempotent — safe to run twice, proven by running `make db-migrate` twice rather than by reading the DDL
- The DDL is executed against a real PostgreSQL before commit — text assertions alone cannot detect invalid SQL
- Tests written BEFORE the DDL (TDD — not after)
- Commit message follows conventional commits format

Must-not-have:
- A `focus_events` table (deferred — issue #107)
- Any change to `cards`, `tracker_items`, `settings`, or `workspace_settings`
- A cross-table foreign key on `task_id`
- `focus_events` table in the schema task; audit wiring belongs to the mutation tasks and is validated there

Open question risks:
- Session rows are assumed retained after Finish (`finished_at` set, row kept). If retention turns out to be unwanted, the partial index predicate changes → report NEEDS_CONTEXT before altering it.

Rollback note:
- Rollback plan drops `focus_sessions` only after confirming no active sessions in production. Nothing here touches task data, so a drop is safe in isolation.

Red flags:
- Work outside `schema.sql`, `types.ts`, and the new test file → DONE_WITH_CONCERNS
- Adding a `REFERENCES` clause to `task_id` → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE assertions pass, `npm run test` is green, `make db-migrate` succeeds twice, commit created
Uncertain when: the retention assumption (keep finished rows) proves wrong
Escalate when: satisfying the schema appears to require a change to `cards` or `tracker_items`, or a cross-table FK
