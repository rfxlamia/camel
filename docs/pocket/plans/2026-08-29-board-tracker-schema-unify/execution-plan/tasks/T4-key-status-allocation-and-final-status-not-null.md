# Task T4 — Key/status allocation and final status NOT NULL

**Phase:** 2
**Depends:** T3
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
