# Task T1 — Column-to-slot mapping helper

**Phase:** 1
**Depends:** T0
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
