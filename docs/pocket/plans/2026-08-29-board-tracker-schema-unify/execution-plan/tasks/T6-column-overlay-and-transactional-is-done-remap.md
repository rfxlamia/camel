# Task T6 — Column overlay and transactional is_done remap

**Phase:** 2
**Depends:** T2
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
