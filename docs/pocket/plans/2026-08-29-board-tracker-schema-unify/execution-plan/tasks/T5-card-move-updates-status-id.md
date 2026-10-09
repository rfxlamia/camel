# Task T5 — Card move updates status_id

**Phase:** 3
**Depends:** T4
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
