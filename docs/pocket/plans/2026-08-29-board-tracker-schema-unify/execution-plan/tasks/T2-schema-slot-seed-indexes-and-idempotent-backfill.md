# Task T2 — Schema, slot seed, indexes, and idempotent backfill

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
