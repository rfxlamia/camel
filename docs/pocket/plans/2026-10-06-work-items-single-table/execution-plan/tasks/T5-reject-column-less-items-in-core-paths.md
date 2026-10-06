# Task T5 — Reject column-less items in core paths

**Phase:** 2
**Depends:** T2
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 5: Reject column-less items in core paths [depends: T2]

## OBJECTIVE
Make status-change, my-work mark-done (board branch) and focus board lookup treat column-less rows as not found.

Steps:
1. Write failing test for: "Core paths treat column-less items as board-missing"
   Test file: `server/src/core/column-less-guards.integration.test.ts`
   Level: integration
   Test intent: Given a column-less card / When `board-card-status-change` is invoked for its id, `my-work-mark-done` takes the board branch for it, and `focus-session-repo` `findTask("board", id)` is called / Then each yields its existing not-found result and writes nothing
   Exercise through: the exported functions at `core/board-card-status-change.ts:39-194`, `core/my-work-mark-done.ts:101-109,221,230`, `modules/focus/focus-session-repo.ts:229`
   Test doubles: none
   Expected RED: status-change selects the row and proceeds with a NULL column; focus returns the task
2. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/core/column-less-guards.integration.test.ts`
3. Add `column_id IS NOT NULL` to the three lookups. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "fix(core): ignore column-less items in board-only code paths"`.
4. Write failing test for: "Board behavior unchanged"
   Test file: same
   Level: integration
   Test intent: Given a normal board card / When the same functions run / Then results equal the pre-change behavior
   Exercise through: same functions
   Test doubles: none
   Expected RED: none expected; labeled regression guard. Prove it can fail by temporarily inverting one added predicate, confirm RED, then restore
5. Run test — verify PASS on the final code: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/core/column-less-guards.integration.test.ts`; refactor while green (re-run the same command), then commit: `git commit -m "test(core): pin board-only path behavior"`.

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Appendix C rows for `board-card-status-change.ts`, `my-work-mark-done.ts`, `focus-session-repo.ts:229`
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: lightweight
Justification: three one-line predicates with one shared fixture.

## SANDWICH CONTEXT
[CRITICAL: Board-only code paths must never act on a row with NULL `column_id`.]
You are implementing core-path guards for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B
Files in scope: the three source files above and the test file
Available after: T2
Architecture rule: keep existing not-found result shapes
[RESTATE: Column-less rows are invisible to board-only paths.]

## DELIVERABLE
Given a column-less card, When those paths are called, Then not-found and no writes
Given a board card, When called, Then unchanged

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Only the board branch changes; tracker branches are left for T12
Must-not-have:
  - Touching tracker branches or event readers
Open question risks:
  - none
Rollback note:
  - Revert commit.
Red flags:
  - Edits in `my-work-mark-done.ts` tracker branch → STOP (T12 owns it)

## STOP CONDITIONS
Done when: both scenarios pass; existing `core/my-work-mark-done.test.ts` green
Uncertain when: function signatures differ from the assumed ones
Escalate when: a guard changes a public response shape
