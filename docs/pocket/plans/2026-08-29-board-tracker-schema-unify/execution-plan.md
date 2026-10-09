# EXECUTION PLAN — Board / Tracker schema unify (additive shared vocab)

**Date:** 2026-08-30
**Spec:** docs/pocket/spec/2026-08-29-board-tracker-schema-unify/additive-shared-vocab.md
**Status:** draft
**Total tasks:** 11 (T0–T10)

---

## Execution Overview

### Recommended Order

```text
T0 → T1 → T2 → (T3, T6) → (T4, T7) → T5 → T8 → T9 → T10
```

The parentheses identify tasks that may run in parallel. T10 is the final
cross-task gate and cannot start until every implementation task is complete.

### Parallelizable Groups

| Group | Tasks | Unblocked After | File-safety rule |
|------|------|-----------------|------------------|
| A | T3, T6 | T2 | T3 owns response/serializer files; T6 owns columns/remap files. |
| B | T4, T7 | T3 | T4 owns server insert paths; T7 owns client display files. |

`server/src/routes/cards.ts` is edited by T3, T4, T5, and T8 in series. Do
not parallelize those tasks. T10 owns the final fixture sweep and regression
gate.

### Constraints Reminder

**Architecture:** Keep the additive two-table design. Board cards remain in
`cards` and retain `column_id`; tracker work remains in `tracker_items`.
`tracker_vocabularies.slot` is the five-way status marker. A shared `core/`
allocator must be called by both human card creation and agent `insertCard`.
Use the workspace counter for keys, optimistic `version` locking, and
`recordActivity()` to write `card_events`. Use NodeNext `.js` imports on the
server and fractional positions. Migrations remain idempotent and are applied
by the canonical `migrate.ts` order: `schema.sql`, then `agent-schema.sql`,
then `chat-schema.sql`, in one transaction.

**Out of scope:** Roadmap UI; merging `cards` and `tracker_items`; unifying
`card_events` and `tracker_events`; column reorder/delete UI; status
vocabulary CRUD; a status picker or `statusId` writes on cards; tracker
search/detail resolving board keys; agent pipeline changes; edits to
`agent-schema.sql`; chat, Lottie, auth, and session contracts.

**Migration boundary:** `schema.sql` runs before `agent-schema.sql`, so the
T2 backfill must not statically reference `columns.board_id`. It must use a
conditional/dynamic SQL branch: on a fresh database without that column,
group columns by `workspace_id`; on an existing database where the column is
present, group by `(workspace_id, board_id)` using `IS NOT DISTINCT FROM`.
That branch must cover historical agent cards and soft-deleted cards. No
change to `agent-schema.sql` is permitted.

**Effective project boundary:** The existing `parseProjectPhase` parser is
reused for workspace/project/phase consistency. Board PATCH adds a guard based
on the card's current project and the request body: a phase requires an
effective project, phase-only is allowed when the current card already has a
project and the phase belongs to it, and `projectId: null` with a non-null
phase is always 4xx. The plan must not claim that the existing parser rejects
every phase-only request.

**Test command policy:** T0 changes the server test script to
`vitest run --silent=true`. Every single-file server test uses
`npm run test --workspace=server -- src/...`; every single-file client test
uses `npm run test --workspace=client -- src/...`. Integration commands add
`RUN_INTEGRATION=1` and use the server workspace. Root `npm run test` is used
only for the complete monorepo suite.

### File Structure Map

```text
T0: test-command preflight
  Modify: server/package.json

T1: Rule 2 column-to-slot mapping
  Create: server/src/core/column-status-map.ts
          server/src/core/column-status-map.test.ts

T2: schema, slots, indexes, and idempotent backfill
  Modify: server/src/db/schema.sql
          server/src/db/types.ts
          server/src/core/tracker-vocabulary-seed.ts
          server/src/core/tracker-vocabulary-seed.test.ts
          server/src/db/tracker-migration.test.ts
  Create: server/src/db/board-tracker-unify-migration.test.ts
          server/src/db/board-tracker-unify-migration.integration.test.ts

T3: shared vocabulary/card response and batched hydration
  Create: server/src/routes/vocabulary-response.ts
          server/src/routes/vocabulary-response.test.ts
          server/src/routes/card-response.ts
          server/src/routes/card-response.test.ts
          server/src/routes/card-response.integration.test.ts
  Modify: server/src/routes/cards.ts
          server/src/routes/board.ts
          server/src/routes/tracker-items.ts
          server/src/routes/board.test.ts
          client/src/types.ts

T4: key/status allocation and final status NOT NULL
  Create: server/src/core/allocate-card-identity.ts
          server/src/core/allocate-card-identity.test.ts
          server/src/routes/cards-identity.integration.test.ts
  Modify: server/src/routes/cards.ts
          server/src/agent/routes.ts (insertCard only)
          server/src/db/seed.ts
          server/src/db/schema.sql
          server/src/db/tracker-migration.test.ts

T5: move-time status mapping
  Modify: server/src/routes/cards.ts
  Test:   server/src/routes/cards-identity.integration.test.ts

T6: column overlay and transactional is_done remap
  Create: server/src/core/remap-card-statuses.ts
          server/src/core/remap-card-statuses.test.ts
          server/src/routes/columns-is-done-remap.integration.test.ts
  Modify: server/src/routes/columns.ts
          client/src/components/ColumnView.tsx
          client/src/components/ColumnView.test.tsx

T7: key display on board surfaces
  Modify: client/src/components/CardView.tsx
          client/src/components/ListView.tsx
          client/src/components/ListView.test.tsx
  Test:   client/src/components/CardView.test.tsx

T8: card taxonomy PATCH and shared diff helper
  Create: server/src/core/diff-ids.ts
          server/src/core/diff-ids.test.ts
          server/src/routes/card-labels.ts
          server/src/routes/card-labels.test.ts
          server/src/routes/cards-taxonomy.integration.test.ts
  Modify: server/src/routes/cards.ts
          server/src/routes/card-assignees.ts
          server/src/routes/tracker-items.ts
          server/src/routes/tracker-item-parsers.ts
          server/src/routes/tracker-item-parsers.test.ts

T9: board panel taxonomy fields and dirty-state protection
  Create: client/src/components/BoardCardTaxonomyFields.tsx
          client/src/components/BoardCardTaxonomyFields.test.tsx
  Modify: client/src/api.ts
          client/src/components/ContextPanel.tsx
          client/src/components/ContextPanel.test.tsx

T10: canonical migration smoke, fixture sweep, and final regression gate
  Create: server/src/db/full-migration.integration.test.ts
  Modify: server/src/db/tracker-migration.test.ts
          server/src/routes.integration.test.ts
          server/src/notifications/service.test.ts
          server/src/notifications/scheduler.test.ts
          server/src/routes/cards.notification.test.ts
          server/src/routes/cards-mutations.integration.test.ts
          server/src/agent/routes.test.ts
          server/src/agent/ticket-intake/history.test.ts
          server/src/db/board-tracker-unify-migration.integration.test.ts
          server/src/routes/cards-identity.integration.test.ts
          server/src/routes/columns-is-done-remap.integration.test.ts
          server/src/routes/cards-taxonomy.integration.test.ts
          all other T10-owned direct-card integration fixtures
```

---

## Pocket Packets

---

### Task 0: Test-command preflight [prereq]

## OBJECTIVE

Make single-file server test commands deterministic before any feature task
starts. Change only the server test script from `vitest run --silent` to
`vitest run --silent=true`; the explicit boolean prevents Vitest from
consuming the positional path as the value of `--silent`.

Files:
- Modify: `server/package.json`
- Test: existing `server/src/core/position.test.ts` as the command smoke test

Steps:

1. Record the baseline command behavior:

   ```text
   npm run test --workspace=server -- src/core/position.test.ts
   ```

   With the current script, verify that the positional path is not bounded to
   the requested file because `--silent` consumes it. Do not treat the broad
   run as feature evidence.

2. Change `server/package.json` exactly to:

   ```json
   "test": "vitest run --silent=true"
   ```

3. Run the same command again and verify that Vitest discovers only
   `src/core/position.test.ts` and exits successfully. The command must not
   invoke the client workspace.

4. Commit the bounded configuration change:

   ```text
   git add server/package.json
   git commit -m "fix(test): preserve server single-file test paths"
   ```

## REFERENCES LOADED

`package.json`, `server/package.json`, and the repository test conventions in
`AGENTS.md`.

## WHY THIS APPROACH

The existing root script runs both workspaces and the server script's bare
`--silent` consumes a path argument. Fixing the script once makes every later
TDD command reviewable and avoids false green/red results.

## SANDWICH CONTEXT

[CRITICAL: Use workspace-specific commands for every single-file test. Do not
use `npx vitest` directly and do not restore bare `--silent`.]

## DELIVERABLE

The server test script is `vitest run --silent=true`, and the smoke command
selects only the requested server test file.

## QUALITY BAR

- No source or test behavior changes.
- The smoke command has a bounded file list and passes.
- Conventional commit message.

## STOP CONDITIONS

Escalate if npm/Vitest still interprets the positional path as a flag value
after the exact script change; do not alter feature tasks to compensate.

---

### Task 1: Column-to-slot mapping helper [depends: T0]

## OBJECTIVE

Ship one pure `core/` mapper for Rule 2. Given columns ordered by
`position`, `is_done` always maps to `done`; the leftmost non-done column maps
to `backlog`; the next maps to `todo`; every remaining non-done column maps to
`in_progress`. Mapping never uses column titles or vocabulary `category`, and
the `canceled` slot is never assigned from a column. Expose the slot-to-vocab
resolver needed by SQL authors and live routes without duplicating Rule 2.

Files:
- Create: `server/src/core/column-status-map.ts`
- Test: `server/src/core/column-status-map.test.ts`

Steps:

1. Write the complete unit suite before implementation. Cover:

   - software-dev columns, including In Review, map by ordered non-done
     geometry and keep column ids in the result;
   - Inbox | Finished (`is_done`) maps to backlog/done, even though Finished
     is the second column;
   - an `is_done` column at the leftmost position still maps to done;
   - four or more non-done columns share `in_progress` from the third onward;
   - an extra `kind=status` vocabulary row with `slot = null` is ignored when
     resolving slot ids; only the five slotted rows are eligible;
   - title/category renames do not affect the mapping.

   Exercise public functions such as `mapColumnSlots` and
   `statusIdForSlot`. Do not mock the mapper.

2. Run the complete unit file and verify one honest RED caused by the missing
   module/export:

   ```text
   npm run test --workspace=server -- src/core/column-status-map.test.ts
   ```

   Do not split the suite into later artificial RED cycles. All Rule 2
   examples are already specified before implementation.

3. Implement the full minimal helper and slot resolver. Sort by `position`
   (with a stable id tie-breaker if required), apply `is_done` before counting
   non-done columns, and accept only non-null slots from the five default
   status rows. Do not import Express routes or database clients.

4. Run the same command and verify all tests PASS. Refactor only while green
   if a concrete duplicate or oversized function appears; rerun the file.

5. Commit:

   ```text
   git add server/src/core/column-status-map.ts server/src/core/column-status-map.test.ts
   git commit -m "feat(board-tracker): add column-to-slot mapping helper"
   ```

## REFERENCES LOADED

The spec Rules 1–2; `server/src/core/wip.ts`; `server/src/core/tracker-key.ts`;
and `server/src/core/position.test.ts` for the colocated Vitest pattern.

## WHY THIS APPROACH

The mapper is pure and testable once, while migration SQL, allocation, move,
and remap code consume the same documented formula. Grouping all scenarios
before implementation keeps the RED phase genuine and avoids speculative
commits.

## SANDWICH CONTEXT

[CRITICAL: `is_done` wins; then non-done order. Never map by title, category,
or a fifth invented slot.]

## DELIVERABLE

All Rule 2 examples and slotted-id resolution pass through the public helper.

## QUALITY BAR

- One pure mapper; no duplicated Rule 2 logic.
- TDD suite is written before implementation and has one expected missing-module RED.
- NodeNext `.js` imports and conventional commit.
- No files outside this task.

## STOP CONDITIONS

Escalate if a caller asks the helper to map canceled or to infer a slot from a
column/vocabulary name.

---

### Task 2: Schema, slot seed, indexes, and idempotent backfill [depends: T1]

## OBJECTIVE

Add the shared vocabulary marker, additive card identity/taxonomy columns,
card labels, justified indexes, and a migration backfill that works in both
schema states exposed by the canonical migration order. Backfill
`status_id` for every card (live and soft-deleted), including historical agent
cards, using T1 Rule 2. Allocate `key_number` only to live cards through the
workspace counter. Every write is null-only and safe to rerun. Leave
`status_id` nullable during T2; T4 adds the final `SET NOT NULL` after both
insert paths are safe. Never touch `started_at` or `done_at`, and never add a
cross-table or card-level key UNIQUE constraint.

Files:
- Modify: `server/src/db/schema.sql`, `server/src/db/types.ts`,
  `server/src/core/tracker-vocabulary-seed.ts`,
  `server/src/core/tracker-vocabulary-seed.test.ts`,
  `server/src/db/tracker-migration.test.ts`
- Create: `server/src/db/board-tracker-unify-migration.test.ts`,
  `server/src/db/board-tracker-unify-migration.integration.test.ts`

Steps:

1. Write the static, seed, and integration scenarios before implementation:

   - `schema.sql` declares nullable `slot` with a five-value CHECK and a
     partial unique index scoped to status rows:
     `UNIQUE (workspace_id, slot) WHERE kind = 'status' AND slot IS NOT NULL`;
   - cards gain nullable `status_id`, `key_number`, `priority_id`,
     `project_id`, and `phase_id` with idempotent `ADD COLUMN IF NOT EXISTS`;
   - `card_labels(card_id, vocabulary_id)` has the correct card FK and does
     not reuse `tracker_item_labels`;
   - indexes exist for live key lookups and the new FK/query paths:
     `cards.status_id`, `cards.priority_id`, `cards.project_id`,
     `cards.phase_id` (partial on live cards where appropriate), and
     `card_labels.vocabulary_id`;
   - no `UNIQUE (workspace_id, key_number)` is added to cards;
   - the five default status seed rows carry slots
     `backlog`, `todo`, `in_progress`, `done`, and `canceled`; priority and
     label rows have no slot;
   - existing live and soft-deleted human cards map by Rule 2, with column
     ids and timestamps unchanged;
   - an existing database with `columns.board_id` maps human columns and
     agent-board columns independently by `(workspace_id, board_id)`, using
     null-safe equality, and historical agent cards receive status ids;
   - a fresh database where `columns.board_id` is not yet present can apply
     the schema block without a missing-column error and maps the columns that
     exist by workspace;
   - a deleted card receives `status_id` but no key; live null keys receive
     consecutive counter values after existing tracker keys;
   - already-filled keys/statuses and tracker keys are unchanged on rerun;
   - no migration statement writes `started_at` or `done_at`.

   Static tests must assert stable final requirements and null-only predicates.
   T4 will append the final constraint and extend the ordering assertion;
   earlier tests must remain valid after that extension.

2. Run the static and seed files before implementation:

   ```text
   npm run test --workspace=server -- src/db/board-tracker-unify-migration.test.ts
   npm run test --workspace=server -- src/core/tracker-vocabulary-seed.test.ts
   ```

   Verify honest RED for missing DDL/slot fields. Keep the assertions focused
   on durable requirements so the later backfill and NOT NULL statement can be
   added without rewriting a transient expectation.

3. Implement the additive DDL and types. Keep the unify block clearly marked
   and ordered as: DDL/indexes → slot seed/update → null-only backfills. Add
   the new FK indexes, including `card_labels.vocabulary_id`, and keep all
   columns nullable until the T4 migration step.

4. Add the five slots to `DEFAULT_TRACKER_VOCABULARY` and its insert values;
   keep `category` unchanged because glyph semantics are separate from slot.
   Run both static/unit files with the workspace-specific commands and verify
   PASS.

5. Implement the status backfill as an idempotent conditional/dynamic SQL
   block. The implementation must follow this shape:

   - Seed/update the five named default status rows with `slot IS NULL` only.
   - Use a `DO` block that checks `information_schema.columns` for
     `columns.board_id` before preparing any SQL that mentions that column.
     The no-column branch joins cards to columns by `workspace_id` only. The
     column-present branch joins by `workspace_id` and
     `col.board_id IS NOT DISTINCT FROM target.board_id`.
   - In either branch, rank non-done columns within each grouping by
     `position`, apply `is_done` first, and update only
     `cards.status_id IS NULL`. Include cards regardless of `deleted_at`, so
     historical agent cards and soft-deleted cards are covered. Resolve ids
     only through `tracker_vocabularies.kind = 'status'` and non-null slots;
     an extra unslotted status must be ignored.
   - Lock each workspace row before key allocation. Iterate live cards with
     `deleted_at IS NULL AND key_number IS NULL` in stable id order, increment
     `tracker_key_counter`, and assign the returned number. This avoids
     double-incrementing already-filled rows and keeps deleted-at-migration
     cards keyless. Do not decrement the counter.
   - Do not refer to `columns.board_id` outside the guarded dynamic branch;
     fresh `schema.sql` must be valid before `agent-schema.sql` adds it.

6. Run the migration integration scenarios against a real PostgreSQL service:

   ```text
   RUN_INTEGRATION=1 npm run test --workspace=server -- src/db/board-tracker-unify-migration.integration.test.ts
   ```

   The fixture must cover both branches: a fresh pre-agent state with no
   `board_id`, and an existing state with human plus agent columns/cards,
   including a soft-deleted historical agent card. Verify status mapping,
   key allocation, counter advancement, timestamp preservation, and a second
   application of the null-only backfill. Do not rely only on text extraction
   of the marker; T10 adds the canonical full migration smoke.

7. Refactor only while green, then commit the complete T2 slice:

   ```text
   git add server/src/db/schema.sql server/src/db/types.ts server/src/core/tracker-vocabulary-seed.ts server/src/core/tracker-vocabulary-seed.test.ts server/src/db/tracker-migration.test.ts server/src/db/board-tracker-unify-migration.test.ts server/src/db/board-tracker-unify-migration.integration.test.ts
   git commit -m "feat(board-tracker): add slotted vocab and idempotent card backfill"
   ```

## REFERENCES LOADED

`server/src/db/migrate.ts` (schema order and one transaction),
`server/src/db/agent-schema.sql` (the later `columns.board_id` addition; do not
edit), `server/src/db/schema.sql`, `server/src/db/types.ts`,
`server/src/core/tracker-vocabulary-seed.ts`, and existing migration tests.

## WHY THIS APPROACH

The dynamic branch is required by the real migration order. A filter that
selects only null board ids misses agent cards and a static reference fails on a
fresh database. Workspace-row locking plus null-only updates gives a
repeatable counter allocation without a misleading UNIQUE constraint.

## SANDWICH CONTEXT

[CRITICAL: Keep status nullable until T4; backfill status for all rows,
including deleted and historical agent rows; allocate keys only for live null
rows; do not touch timestamps, agent-schema.sql, or tracker_item_labels.]

## DELIVERABLE

Fresh and existing migration fixtures pass; all five slots seed; human and
agent status overlays map correctly; live cards receive counter keys; deleted
cards receive status but no key; rerun is idempotent; timestamps are byte-for-
byte unchanged.

## QUALITY BAR

- Conditional/dynamic `board_id` handling is explicit and null-safe.
- All new FK/query indexes are specified and non-unique where required.
- Static tests assert final invariants/order, never a transient absence.
- TDD and conventional commit.

## STOP CONDITIONS

Escalate if the implementation requires changing `agent-schema.sql`, a trigger,
a cross-table UNIQUE, timestamp mutation, or a static unguarded reference to
`columns.board_id`.

---

### Task 3: Shared vocabulary/card response and batched hydration [depends: T2]

## OBJECTIVE

Extract one shared vocabulary response serializer and one card response
contract. GET board and GET card must expose additive `key`, `status` (with
slot), `priority`, `labels`, `project`, and `phase` fields while preserving
existing camelCase/timestamp/assignee fields. Hydration must batch labels and
assignees so multiple cards do not multiply rows or trigger an N+1 query.
The tracker route must consume the shared vocabulary serializer; do not import
the tracker router into card responses.

Files:
- Create: `server/src/routes/vocabulary-response.ts`,
  `server/src/routes/vocabulary-response.test.ts`,
  `server/src/routes/card-response.ts`,
  `server/src/routes/card-response.test.ts`,
  `server/src/routes/card-response.integration.test.ts`
- Modify: `server/src/routes/cards.ts`, `server/src/routes/board.ts`,
  `server/src/routes/tracker-items.ts`, `server/src/routes/board.test.ts`,
  `client/src/types.ts`

Steps:

1. Write unit tests for the complete response contract before implementation:

   - `serializeVocabulary` emits the existing id/kind/name/position/colour and
     emits `slot` only when supplied; tracker status output remains compatible;
   - a keyed card maps `formatKey(derivePrefix(workspace.name), key_number)`;
   - status includes id, kind, name, position, colour, category, and slot;
   - priority/labels use the shared serializer, and null taxonomy remains
     explicit (`null` or `[]`);
   - a null key number produces `key: null`, never a formatted null string;
   - board and card builders call the shared mapper rather than private inline
     camelCase maps.

2. Run the unit files and verify missing-module RED:

   ```text
   npm run test --workspace=server -- src/routes/vocabulary-response.test.ts
   npm run test --workspace=server -- src/routes/card-response.test.ts
   ```

3. Implement `vocabulary-response.ts` and use it from both
   `tracker-items.ts` and `card-response.ts`. Keep slot optional so tracker
   priority/label payloads do not change. Implement the card select/join and
   mapper, remove duplicated inline maps from `cards.ts` and `board.ts`, and
   update the client `Card` type with optional additive fields so old
   fixtures remain valid.

4. Add the real DB/HTTP integration test before declaring the task complete.
   Seed several cards with different priorities, projects, phases, two or
   more labels each, and assignees. GET the board and GET an individual card;
   assert each card occurs exactly once, every label is present, and all
   hydration fields match. The loader must use batched `IN (card ids)` label
   and assignee queries. Instrument the test executor/query hook (or the
   loader boundary) to prove one labels query and one assignee query for the
   board rather than one query per card; do not accept a test that merely
   checks the shape of one mocked row.

5. Run all server unit/integration files:

   ```text
   npm run test --workspace=server -- src/routes/vocabulary-response.test.ts
   npm run test --workspace=server -- src/routes/card-response.test.ts
   npm run test --workspace=server -- src/routes/board.test.ts
   RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/card-response.integration.test.ts
   ```

   Refactor only while green. Commit:

   ```text
   git add server/src/routes/vocabulary-response.ts server/src/routes/vocabulary-response.test.ts server/src/routes/card-response.ts server/src/routes/card-response.test.ts server/src/routes/card-response.integration.test.ts server/src/routes/cards.ts server/src/routes/board.ts server/src/routes/tracker-items.ts server/src/routes/board.test.ts client/src/types.ts
   git commit -m "feat(board-tracker): share vocabulary and card response serializers"
   ```

## REFERENCES LOADED

`server/src/routes/cards.ts`, `server/src/routes/board.ts`,
`server/src/routes/tracker-items.ts`, `server/src/core/tracker-key.ts`,
`client/src/types.ts`, and tracker serialization tests.

## WHY THIS APPROACH

There are already two card response maps and a private tracker vocabulary
serializer. A small route-layer vocabulary serializer and batched hydration
remove the concrete duplication while keeping the two table owners separate.

## SANDWICH CONTEXT

[CRITICAL: JSON is additive camelCase; reuse `formatKey`/`derivePrefix`; no
status writes, tracker key resolution, row multiplication, or tracker-router
import from card responses.]

## DELIVERABLE

GET board and GET card expose the same hydrated card contract, including
batched labels and slotted status. Tracker vocabulary responses remain
compatible.

## QUALITY BAR

- Shared serializer is used by tracker and card paths.
- Integration coverage proves labels are batched and cards are not duplicated.
- Null key/taxonomy semantics are explicit.
- TDD, `.js` imports, and conventional commit.

## STOP CONDITIONS

Escalate if hydration requires resolving tracker items by board key or if a
solution imports the entire tracker router instead of the shared serializer.

---

### Task 4: Key/status allocation and final status NOT NULL [depends: T3]

## OBJECTIVE

Allocate keys and status ids on every new board card. A shared `core/` helper
must increment `workspaces.tracker_key_counter`, map the destination column
using T1 among columns with the same `(workspace_id, board_id)` (null-safe),
and return `key_number` plus `status_id`. Wire it into human POST `/cards`,
agent `insertCard` only, and seed. Reject `statusId` on POST/PATCH card writes.
After both insert paths and all migration backfill rows are safe, make
`cards.status_id` NOT NULL. Soft delete keeps an issued key.

Files:
- Create: `server/src/core/allocate-card-identity.ts`,
  `server/src/core/allocate-card-identity.test.ts`,
  `server/src/routes/cards-identity.integration.test.ts`
- Modify: `server/src/routes/cards.ts`, `server/src/agent/routes.ts`
  (`insertCard` only), `server/src/db/seed.ts`, `server/src/db/schema.sql`,
  `server/src/db/tracker-migration.test.ts`

Steps:

1. Write unit tests for the allocator before implementation. A real mapper
   import is required; fake only the transaction executor. Cover counter
   return, In Review → `in_progress`, `is_done` precedence, and same-board
   sibling isolation. Verify the missing-module RED with:

   ```text
   npm run test --workspace=server -- src/core/allocate-card-identity.test.ts
   ```

2. Implement the allocator with a workspace-row counter update/returning
   query and T1 mapping. Use `board_id IS NOT DISTINCT FROM` in the sibling
   query. The caller owns the surrounding transaction; the helper must not
   publish events or write activity.

3. Write one route integration suite covering all insert contracts before
   wiring the routes:

   - human POST into In Review receives the next key, `in_progress`, and the
     T3 formatted response;
   - POST and PATCH containing `statusId` return 4xx before mutation;
   - concurrent card and tracker creates serialize on the same workspace
     counter and cannot display a duplicate key;
   - agent `insertCard` on a real `columns.board_id` board receives a key and
     the status for that board's sibling geometry, without
     `recordActivity`/`card_events`;
   - soft delete keeps `key_number` and the next item receives the next
     counter value;
   - after T2 backfill, final `SET NOT NULL` rejects a null status insert and
     seed cards receive allocated key/status values.

   Characterization cases that already pass (for example, soft delete only
   setting `deleted_at`) are allowed to begin GREEN; do not break production
   behavior just to manufacture a RED phase.

4. Implement POST within its existing WIP/position transaction, call the
   allocator, and preserve human activity/signable behavior. Export or expose
   only the `insertCard` function needed by its test, call the allocator in a
   transaction, and do not edit `agent-schema.sql`, `service.ts`, or pipeline
   orchestration. Update seed to call the allocator (or an equivalent
   transactionally returned identity) for every demo row.

5. Append idempotent `ALTER TABLE cards ALTER COLUMN status_id SET NOT NULL`
   after the T2 null-only backfills in the unify block. Upgrade the static
   migration test to assert the stable order:

   ```text
   additive DDL → slot seed → null-only status/key backfill → SET NOT NULL
   ```

   Make the assertion about ordering rather than an intermediate file state.
   Ensure the guard is safe when the table is already NOT NULL.

6. Run the unit and integration files:

   ```text
   npm run test --workspace=server -- src/core/allocate-card-identity.test.ts
   RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/cards-identity.integration.test.ts
   ```

   Fix all direct fixtures in this task that insert cards without status, and
   leave the repository-wide fixture sweep to T10. Refactor while green and
   commit:

   ```text
   git add server/src/core/allocate-card-identity.ts server/src/core/allocate-card-identity.test.ts server/src/routes/cards.ts server/src/agent/routes.ts server/src/db/seed.ts server/src/db/schema.sql server/src/db/tracker-migration.test.ts server/src/routes/cards-identity.integration.test.ts
   git commit -m "feat(board-tracker): allocate card identity on every insert path"
   ```

## REFERENCES LOADED

`server/src/routes/cards.ts`, `server/src/agent/routes.ts`,
`server/src/routes/tracker-items.ts`, `server/src/db/seed.ts`,
`server/src/core/tracker-key.ts`, and T1's mapper.

## WHY THIS APPROACH

The two production insert paths are the concrete architecture seam. One
transactional helper prevents counter races and prevents agent cards from
being created without identity; NOT NULL is delayed until both paths and old
rows are safe.

## SANDWICH CONTEXT

[CRITICAL: Use the helper from human create and `insertCard`; keep
`recordActivity` out of agent inserts; reject `statusId`; never decrement the
counter or edit agent schema/pipeline.]

## DELIVERABLE

Human, tracker-concurrent, agent, seed, delete, statusId-rejection, and final
NOT NULL scenarios pass with no duplicate app-issued keys.

## QUALITY BAR

- Same counter and T1 sibling mapping in both insert paths.
- WIP/activity/version behavior remains unchanged for human routes.
- Agent insert remains activity-free.
- Static migration assertion covers final ordering.
- TDD and conventional commit.

## STOP CONDITIONS

Escalate if the allocator needs a database trigger, a cross-table UNIQUE, an
agent-schema/pipeline edit, or statusId acceptance.

---

### Task 5: Card move updates status_id [depends: T4]

## OBJECTIVE

When a card moves, update `status_id` from the destination column's T1 slot
inside the existing WIP/position/version transaction. Preserve destination
WIP, policy, signable, and the current `started_at`/`done_at` CASE behavior.
Agent-board moves use their own null-safe `board_id` sibling set.

Files:
- Modify: `server/src/routes/cards.ts`
- Test: `server/src/routes/cards-identity.integration.test.ts`

Steps:

1. Add the move GWT to the existing integration suite before implementation:
   To Do → In Review changes only the column and status overlay, WIP applies,
   and timestamps/version semantics remain current. Add an agent-board sibling
   case. Run:

   ```text
   RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/cards-identity.integration.test.ts
   ```

   Verify the new assertion is RED if the current move leaves `status_id`.

2. Implement the destination status lookup through T1; do not copy Rule 2 or
   accept a statusId body. Keep the optimistic version predicate and all
   existing move checks in the same transaction.

3. Rerun the integration file, refactor only while green, and commit:

   ```text
   git add server/src/routes/cards.ts server/src/routes/cards-identity.integration.test.ts
   git commit -m "feat(board-tracker): update card status on column move"
   ```

## REFERENCES LOADED

The spec Rule 5; `server/src/routes/cards.ts`; T1 mapper; and WIP/position
helpers.

## WHY THIS APPROACH

Move is the only normal board write that changes placement. Reusing the
destination overlay keeps status derived from placement and keeps all current
concurrency/timestamp guarantees together.

## SANDWICH CONTEXT

[CRITICAL: Destination column is the status source; statusId is never accepted
on move; no Roadmap reverse mapping.]

## DELIVERABLE

Human and agent-board move scenarios pass with status, WIP, version, and
timestamp behavior intact.

## QUALITY BAR

- T1 mapping is reused.
- One transaction covers move mutation and optimistic lock.
- TDD and conventional commit.

## STOP CONDITIONS

Escalate if a same-column reorder is asked to remap a status or if a caller
requests status picker behavior.

---

### Task 6: Column overlay and transactional is_done remap [depends: T2] [parallel: T3]

## OBJECTIVE

Keep POST `/columns` append-right with no card remap. For PATCH `isDone`,
remap only live cards whose slot changes under T1, without changing
`column_id`; bump `version`, apply move-equivalent timestamps, and call
`recordActivity` for each card event inside the transaction. Publish every
`card.updated` and `column.updated` event only after the transaction commits.
Clearing the last done column remains allowed and shows a non-blocking client
tip.

Files:
- Create: `server/src/core/remap-card-statuses.ts`,
  `server/src/core/remap-card-statuses.test.ts`,
  `server/src/routes/columns-is-done-remap.integration.test.ts`
- Modify: `server/src/routes/columns.ts`,
  `client/src/components/ColumnView.tsx`,
  `client/src/components/ColumnView.test.tsx`

Steps:

1. Write pure remap-plan tests before implementation: unchanged slots are
   omitted, changed live cards are included with new ids, soft-deleted cards
   are excluded, and T1's `is_done`-wins geometry is used. Run:

   ```text
   npm run test --workspace=server -- src/core/remap-card-statuses.test.ts
   ```

   Verify missing-module RED, then implement and rerun PASS.

2. Write one integration suite containing the complete route contract before
   wiring the route. Cover:

   - moving is_done swaps live card slots in place, bumps versions, writes one
     `card_events` row per remapped card, and applies timestamp CASE rules;
   - the old done column's cards are remapped according to final geometry;
   - soft-deleted cards retain status/version;
   - clearing the last done column succeeds and remaps Rule 2;
   - unchanged slots do not bump version or emit card events;
   - concurrent true/false PATCHes serialize on the workspace row and final
     statuses match the winning geometry;
   - a stale card PATCH after remap returns 409;
   - POST column appends right and does not remap existing cards, including
     Inbox | Finished → added Blocked (`todo` overlay), and a single Inbox →
     added Doing (`todo` overlay);
   - title/color/WIP-only PATCH and rename leave status/version unchanged;
   - a forced transaction failure/rollback emits no `card.updated` or
     `column.updated` event before rollback (when the harness can inject the
     failure).

3. Implement the transaction/event boundary explicitly:

   - For both `isDone: true` and `isDone: false`, lock the workspace row,
     mutate columns, compute final columns and remap plan, update card status,
     version, and timestamps, and call `recordActivity(trx, ...)` for card
     events. Keep all of that inside one transaction.
   - Return the updated column payload and a list of remapped card event
     payloads from the transaction. After commit, publish `card.updated` once
     per remapped card and then `column.updated`. A rollback must return no
     publish calls. Publishing is never performed from the transaction
     callback.
   - Do not use a broad column-scoped update: filter live rows and plan ids so
     unchanged and soft-deleted cards are untouched.

4. Add the ColumnView copy-only tip test and implement it without blocking
   the PATCH. Run server and client files:

   ```text
   RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/columns-is-done-remap.integration.test.ts
   npm run test --workspace=server -- src/core/remap-card-statuses.test.ts
   npm run test --workspace=client -- src/components/ColumnView.test.tsx
   ```

5. Refactor only while green and commit:

   ```text
   git add server/src/core/remap-card-statuses.ts server/src/core/remap-card-statuses.test.ts server/src/routes/columns.ts server/src/routes/columns-is-done-remap.integration.test.ts client/src/components/ColumnView.tsx client/src/components/ColumnView.test.tsx
   git commit -m "feat(board-tracker): remap card statuses after is_done changes"
   ```

## REFERENCES LOADED

The spec Rules 3–4; `server/src/routes/columns.ts`;
`server/src/routes/cards.ts` move timestamp CASE;
`server/src/routes/helpers.ts`; and existing concurrent is_done route tests.

## WHY THIS APPROACH

The remap is a transactionally coupled server operation, but event delivery is
an external side effect. Returning payloads and publishing after commit avoids
clients observing rolled-back card or column state.

## SANDWICH CONTEXT

[CRITICAL: No column_id moves, no remap on column creation/rename, no
tracker_events, and no SSE publish inside the transaction.]

## DELIVERABLE

All remap, concurrency, rollback, no-op, soft-delete, append-right, and tip
scenarios pass. Every emitted event describes committed state.

## QUALITY BAR

- Transaction contains DB writes and activity only.
- Post-commit publishes are explicit and tested.
- Only changed live slots bump versions.
- TDD and conventional commits.

## STOP CONDITIONS

Escalate if clearing the last done column is made blocking, if event delivery
must occur before commit, or if a solution edits cards.ts move behavior here.

---

### Task 7: Show formatted key on card face and list view [depends: T3] [parallel: T4]

## OBJECTIVE

Render the server-provided `card.key` on the kanban `CardBody` (including its
existing drag overlay) and in the list-view ID column. Keep the numeric id out
of the user-facing ID cell, use the tracker mono/tabular treatment, and do not
add a status picker.

Files:
- Modify: `client/src/components/CardView.tsx`,
  `client/src/components/ListView.tsx`,
  `client/src/components/ListView.test.tsx`
- Test: `client/src/components/CardView.test.tsx`
- Do not modify: `client/src/pages/BoardPage.tsx` (it already renders CardBody
  for the drag overlay)

Steps:

1. Write both display tests first: `CA-41` is visible on the card face and in
   the list ID column while the title remains; a longer prefix remains
   readable. Run:

   ```text
   npm run test --workspace=client -- src/components/CardView.test.tsx
   npm run test --workspace=client -- src/components/ListView.test.tsx
   ```

   Verify RED where the current UI renders no key or raw numeric id.

2. Implement with the existing tracker visual language. Use the server string
   directly (no client formatKey fork), widen/minmax the first list grid track
   beyond the current numeric 48px assumption, and render nothing for an old
   SSE payload with no key.

3. Run both client files again, refactor while green, and commit:

   ```text
   git add client/src/components/CardView.tsx client/src/components/ListView.tsx client/src/components/CardView.test.tsx client/src/components/ListView.test.tsx
   git commit -m "feat(board-tracker): show formatted card keys on board surfaces"
   ```

## REFERENCES LOADED

T3 `Card` type/response, `client/src/components/CardView.tsx`,
`client/src/components/ListView.tsx`, `TrackerRow`, and the creative brief.

## WHY THIS APPROACH

This is display-only against the additive server payload. Reusing `CardBody`
automatically covers the existing drag preview.

## SANDWICH CONTEXT

[CRITICAL: Do not add a status picker, tracker-key search, or BoardPage edit.]

## DELIVERABLE

Live cards show the same formatted key on card face and list row without
breaking old payloads.

## QUALITY BAR

- No client-side key formatting fork.
- Long keys fit the list layout.
- TDD and conventional commit.

## STOP CONDITIONS

Escalate if product changes the agreed list ID contract back to numeric ids.

---

### Task 8: PATCH card priority, labels, project, and phase [depends: T5]

## OBJECTIVE

Extend PATCH `/cards/:id` with nullable `priorityId`, `labelIds`, `projectId`,
and `phaseId`, using existing tracker parsers for workspace/kind validation,
the existing optional-version/409 behavior, `card_labels`, and
`recordActivity` to `card_events`. Introduce one domain-neutral `diffIds`
helper for assignees, tracker labels, and card labels. Preserve the exact
board effective-project contract described in the overview.

Files:
- Create: `server/src/core/diff-ids.ts`, `server/src/core/diff-ids.test.ts`,
  `server/src/routes/card-labels.ts`, `server/src/routes/card-labels.test.ts`,
  `server/src/routes/cards-taxonomy.integration.test.ts`
- Modify: `server/src/routes/cards.ts`, `server/src/routes/card-assignees.ts`,
  `server/src/routes/tracker-items.ts`, `server/src/routes/tracker-item-parsers.ts`,
  `server/src/routes/tracker-item-parsers.test.ts`

Steps:

1. Write unit tests before implementation for `diffIds`, parser validation,
   and card label synchronization. `diffIds` must dedupe `next`, return added
   and removed ids, and be imported by assignee and both label sync paths.
   Parser tests cover valid/null priority, wrong kind/workspace labels and
   priority, and existing `parseProjectPhase` consistency behavior. Do not
   change tracker route semantics while changing its import.

2. Run the unit files and verify RED only for missing helper/parser/module
   exports:

   ```text
   npm run test --workspace=server -- src/core/diff-ids.test.ts
   npm run test --workspace=server -- src/routes/tracker-item-parsers.test.ts
   npm run test --workspace=server -- src/routes/card-labels.test.ts
   ```

3. Implement `diffIds`; replace the misleading `diffAssigneeIds` reuse in
   `card-assignees.ts`, `tracker-items.ts`, and `card-labels.ts`. Keep the
   assignee behavior unchanged. Implement `parsePriorityId` beside the other
   parsers and `syncCardLabels` against `card_labels`, never
   `tracker_item_labels`.

4. Write one HTTP integration suite containing all PATCH scenarios before
   wiring `cards.ts`:

   - set and clear priority/labels/project/phase, with version bump and
     `card_events`, and GET fields present;
   - stale version returns the existing 409 shape and leaves fields unchanged;
   - cross-workspace/wrong-kind project, priority, label, and phase values
     return 4xx before mutation;
   - phase-only on a card with no project returns 4xx;
   - phase-only on a card with an existing project is allowed only when the
     phase belongs to that effective project;
   - `projectId: null` with a non-null phase is 4xx even if the card currently
     has a project;
   - labels-only PATCH without a version key retains today's optional-version
     behavior; this characterization may begin GREEN;
   - POST/PATCH `statusId` remains 4xx from T4.

   The test must invoke real HTTP routes and real `parseProjectPhase`; do not
   claim that the parser itself rejects every phase-only request. The board
   route loads the current `project_id`, computes the effective project from
   current row plus body, then applies the board-specific guard around the
   parser result.

5. Implement the PATCH wiring. Expand `hasSets`, parse before writing, update
   the card and label junction in the existing transaction, preserve optional
   version semantics, and record card activity. Clear priority to `null` and
   labels to `[]`. Do not add status writes or modify tracker item routes
   beyond the shared diff import.

6. Run all tests:

   ```text
   npm run test --workspace=server -- src/core/diff-ids.test.ts
   npm run test --workspace=server -- src/routes/tracker-item-parsers.test.ts
   npm run test --workspace=server -- src/routes/card-labels.test.ts
   RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/cards-taxonomy.integration.test.ts
   ```

   Refactor while green and commit:

   ```text
   git add server/src/core/diff-ids.ts server/src/core/diff-ids.test.ts server/src/routes/card-labels.ts server/src/routes/card-labels.test.ts server/src/routes/cards.ts server/src/routes/card-assignees.ts server/src/routes/tracker-items.ts server/src/routes/tracker-item-parsers.ts server/src/routes/tracker-item-parsers.test.ts server/src/routes/cards-taxonomy.integration.test.ts
   git commit -m "feat(board-tracker): add card taxonomy patch validation"
   ```

## REFERENCES LOADED

`server/src/routes/cards.ts`, `server/src/routes/tracker-item-parsers.ts`,
`server/src/routes/tracker-items.ts`, `server/src/routes/card-assignees.ts`,
`server/src/routes/helpers.ts`, and the spec Rule 8.

## WHY THIS APPROACH

The shared diff operation now has three concrete consumers, so a domain-neutral
helper removes a real naming violation without a speculative utility layer.
Existing parsers provide validation knowledge; the board-only effective-project
guard adapts their tracker semantics without changing the parser contract.

## SANDWICH CONTEXT

[CRITICAL: `card_events`, not `tracker_events`; statusId remains rejected;
reuse parser checks; phase requires an effective project; no tracker table
merge or status picker.]

## DELIVERABLE

Card taxonomy can be set/cleared with correct validation, version conflicts,
activity, and board effective-project behavior; labels use the card junction
and `diffIds`.

## QUALITY BAR

- `diffIds` is shared by assignee and label paths.
- Real HTTP tests prove every 4xx/409 contract.
- Current optional-version behavior is characterized, not tightened silently.
- TDD and conventional commit.

## STOP CONDITIONS

Escalate if the requested behavior requires accepting statusId, writing
tracker events, changing tracker list/detail resolution, or weakening the
phase-without-effective-project rule.

---

### Task 9: Board panel pickers and dirty-state protection [depends: T8]

## OBJECTIVE

Add board ContextPanel controls for priority, labels, project, and phase by
reusing `TrackerPropertyPicker` and the same workspace lists as tracker. Save
through the existing `DetailsSection`/`saveCard` version path. Add no status
picker. Extend dirty-state protection so taxonomy edits are not overwritten by
SSE, successful saves update the baseline, and loading/error/empty option
lists do not destructively clear current selections.

Files:
- Create: `client/src/components/BoardCardTaxonomyFields.tsx`,
  `client/src/components/BoardCardTaxonomyFields.test.tsx`
- Modify: `client/src/api.ts`, `client/src/components/ContextPanel.tsx`,
  `client/src/components/ContextPanel.test.tsx`

Steps:

1. Write component and ContextPanel tests before implementation. Cover:

   - all four pickers render from mocked workspace option props and selection
     sends priority/label/project/phase ids, never `statusId`;
   - priority and labels clear to `null`/`[]`;
   - save includes the current version and updates the panel baseline after a
     successful PATCH;
   - an incoming SSE card update cannot overwrite unsaved taxonomy changes;
   - an SSE update after a successful save can update the now-clean baseline;
   - loading, request-error, and empty vocabulary/project/phase lists show a
     non-destructive state and retain existing selections; no crash or silent
     reset occurs;
   - the rendered panel has no status picker.

2. Run the client files and verify RED for the missing component/fields:

   ```text
   npm run test --workspace=client -- src/components/BoardCardTaxonomyFields.test.tsx
   npm run test --workspace=client -- src/components/ContextPanel.test.tsx
   ```

3. Implement `BoardCardTaxonomyFields` with `TrackerPropertyPicker`, mount it
   from `DetailsSection`, extend `api.ts` PATCH types, and load the same
   workspace vocabularies/projects/phases as tracker. Keep the outer panel's
   dirty guard, but include taxonomy values in its snapshot/baseline. Do not
   invent a board-only picker or a status control.

4. Run both files again and verify PASS. Refactor while green, remove unused
   imports/parameters required by client typecheck, and commit:

   ```text
   git add client/src/components/BoardCardTaxonomyFields.tsx client/src/components/BoardCardTaxonomyFields.test.tsx client/src/api.ts client/src/components/ContextPanel.tsx client/src/components/ContextPanel.test.tsx
   git commit -m "feat(board-tracker): add board taxonomy panel fields"
   ```

## REFERENCES LOADED

`client/src/components/ContextPanel.tsx`,
`client/src/components/tracker/TrackerPropertyPicker.tsx`, `client/src/api.ts`,
`client/src/lib/cardPanel.ts`, and the creative brief.

## WHY THIS APPROACH

The existing tracker picker and workspace loaders are the concrete reusable
surface. A dedicated section keeps the large ContextPanel bounded and makes
dirty/baseline behavior testable without a second picker implementation.

## SANDWICH CONTEXT

[CRITICAL: No status picker, no statusId payload, no Roadmap UI, and no
destructive reset when option requests are loading/empty/error.]

## DELIVERABLE

Users can set/clear all four taxonomy fields, save with version, preserve
unsaved edits across SSE, and recover safely from option-list states.

## QUALITY BAR

- Same workspace lists and picker chrome as tracker.
- Taxonomy participates in dirty/baseline/SSE semantics.
- Client tests and no-unused typecheck remain green.
- TDD and conventional commit.

## STOP CONDITIONS

Escalate if a status picker or Roadmap surface is requested, or if preserving
unsaved values would require changing the server SSE contract.

---

### Task 10: Canonical migration smoke, fixture sweep, and final regression gate [depends: T4, T5, T6, T7, T8, T9]

## OBJECTIVE

Close the feature with a full migration-order proof, all existing direct card
insert fixtures updated for `cards.status_id NOT NULL`, and the complete
monorepo quality gate. This task is the only place allowed to declare the
plan executable.

Files:
- Create: `server/src/db/full-migration.integration.test.ts`
- Modify every direct card fixture affected by the final constraint:
  `server/src/routes.integration.test.ts`,
  `server/src/notifications/service.test.ts`,
  `server/src/notifications/scheduler.test.ts`,
  `server/src/routes/cards.notification.test.ts`,
  `server/src/routes/cards-mutations.integration.test.ts`,
  `server/src/agent/routes.test.ts`,
  `server/src/agent/ticket-intake/history.test.ts`,
  `server/src/db/board-tracker-unify-migration.integration.test.ts`,
  `server/src/routes/cards-identity.integration.test.ts`,
  `server/src/routes/columns-is-done-remap.integration.test.ts`,
  `server/src/routes/cards-taxonomy.integration.test.ts`, and
  `server/src/db/tracker-migration.test.ts`.

Steps:

1. Inventory with `rg` every `insertInto("cards")` and equivalent raw card
   insert in the repository. The known affected fixture set includes
   `server/src/routes.integration.test.ts`,
   `server/src/routes/cards-mutations.integration.test.ts`,
   `server/src/notifications/service.test.ts`,
   `server/src/notifications/scheduler.test.ts`,
   `server/src/routes/cards.notification.test.ts`,
   `server/src/agent/routes.test.ts`,
   `server/src/agent/ticket-intake/history.test.ts`, and the four new feature
   integration files listed above. For each fixture, use a real slotted
   `status_id`/T1 helper or the allocator as appropriate; do not skip a
   fixture because it is outside the feature's primary route suite. Preserve
   fixture intent and agent tests' no-activity contract.

2. Write/extend `full-migration.integration.test.ts` to exercise the same
   canonical sequence as `server/src/db/migrate.ts`, not only a marker-extracted
   SQL fragment:

   - fresh state: execute `schema.sql`, assert the base state before
     `agent-schema.sql`, then execute `agent-schema.sql`, then
     `chat-schema.sql`, all in one transaction; verify `columns.board_id` and
     chat tables appear only at their respective stages and the final schema
     migrates successfully;
   - existing state: start from a pre-unify schema with human cards,
     `columns.board_id`, historical agent cards, soft-deleted cards, existing
     tracker keys, and partially populated identity fields; run the full
     canonical migration and verify both branches, all status rows, keys,
     indexes, final NOT NULL, and untouched timestamps;
   - apply the canonical migration a second time and verify no key/status
     rewrites, no counter double increment, no duplicate slots, and no schema
     error.

   The test must use the real PostgreSQL transaction boundary and the three
   files in order. Marker-extracted tests may remain as focused unit coverage,
   but they cannot be the only migration-order evidence.

3. Run the focused migration/fixture tests with services and migration
   available:

   ```text
   docker compose up -d db redis
   make db-migrate
   RUN_INTEGRATION=1 npm run test --workspace=server -- src/db/full-migration.integration.test.ts
   RUN_INTEGRATION=1 npm run test --workspace=server -- src/db/board-tracker-unify-migration.integration.test.ts
   ```

   Fix any direct fixture failures by adding the correct status id, never by
   weakening the final constraint.

4. Run the complete quality gate from repository root:

   ```text
   npm run test
   npm run lint
   npm run typecheck
   npm run build
   RUN_INTEGRATION=1 npm run test:integration:routes --workspace=server
   ```

   The canonical route integration command must run with PostgreSQL/Redis
   services and the migrated schema. The command uses the server's
   `--no-file-parallelism` script to avoid cross-file database races.

5. Review the final diff for scope, stale commands, event placement, and
   migration predicates. Commit fixture/test-only corrections and this gate
   only after every command passes:

   ```text
   git add server/src/db/full-migration.integration.test.ts server/src/db/board-tracker-unify-migration.integration.test.ts server/src/routes/cards-identity.integration.test.ts server/src/routes/columns-is-done-remap.integration.test.ts server/src/routes/cards-taxonomy.integration.test.ts server/src/db/tracker-migration.test.ts server/src/routes.integration.test.ts server/src/routes/cards-mutations.integration.test.ts server/src/notifications/service.test.ts server/src/notifications/scheduler.test.ts server/src/routes/cards.notification.test.ts server/src/agent/routes.test.ts server/src/agent/ticket-intake/history.test.ts
   git commit -m "test(board-tracker): close migration and regression gates"
   ```

## REFERENCES LOADED

`server/src/db/migrate.ts`, all direct card insert fixtures found by `rg`,
`AGENTS.md` command conventions, the T2 migration tests, and the server route
integration script.

## WHY THIS APPROACH

`status_id NOT NULL` is a repository-wide contract, not only a new-route
contract. A canonical full migration smoke catches schema-load-order failures
that marker extraction cannot, while the explicit fixture inventory prevents
false confidence from a partial suite.

## SANDWICH CONTEXT

[CRITICAL: Do not weaken NOT NULL, skip direct fixtures, run only a marker
fragment, or claim completion without the root quality gate and canonical
route integration.]

## DELIVERABLE

Fresh/existing/idempotent canonical migration, all direct card fixtures,
server/client tests, lint, typecheck, build, and full route integration pass.

## QUALITY BAR

- No stale root single-file commands remain in the plan.
- Migration order and post-commit event behavior are evidenced.
- All direct inserts set a valid status id under the final schema.
- TDD/regression evidence is recorded before completion.

## STOP CONDITIONS

Stop with a concrete failure report if services are unavailable, migration
rollback is not clean, any direct fixture still inserts a null status, or any
quality-gate command fails. Do not mark the plan DONE on skipped integration
tests.

---

## Plan Summary

| Task | Name | Depends | Parallel | Key verification |
|------|------|---------|----------|------------------|
| T0 | Test-command preflight | prereq | no | `--silent=true` selects one server file |
| T1 | Column-to-slot mapping | T0 | no | Rule 2 and slotted-id unit suite |
| T2 | Schema, indexes, and idempotent backfill | T1 | no | fresh/no-board_id + existing/agent + rerun |
| T3 | Shared vocabulary/card response | T2 | Group A | GET board/card, batched labels, no row multiplication |
| T4 | Key/status allocation and NOT NULL | T3 | Group B | human/agent/seed/concurrent/reject statusId |
| T5 | Card move status mapping | T4 | no | destination slot, WIP, version, timestamps |
| T6 | Column overlay/is_done remap | T2 | Group A | transaction-only writes, post-commit SSE, rollback |
| T7 | Key on card/list surfaces | T3 | Group B | formatted key, no status picker |
| T8 | Card taxonomy PATCH and diffIds | T5 | no | validation, effective project, 409, card_events |
| T9 | Board panel taxonomy fields | T8 | no | dirty/baseline/SSE and non-destructive list states |
| T10 | Full migration and regression gate | T4,T5,T6,T7,T8,T9 | no | canonical migration + all quality commands |

### Final Acceptance Checklist

- Additive two-table architecture, no Roadmap/status CRUD/table merge.
- T0 workspace-specific command fix is applied before feature work.
- T2 works before and after `agent-schema.sql`; all card rows get status,
  only live null-key cards get keys, and rerun is null-only.
- T3 uses one vocabulary serializer and batched card hydration.
- T4/T5 derive status only from column placement and both insert paths share
  the counter allocator; final status is NOT NULL.
- T6 writes activity in the transaction and publishes SSE only after commit.
- T8 enforces the effective-project phase contract and uses `diffIds`.
- T9 protects taxonomy dirty state and has no status picker.
- T10 updates every direct card fixture and runs canonical migration, tests,
  lint, typecheck, build, and route integration.
