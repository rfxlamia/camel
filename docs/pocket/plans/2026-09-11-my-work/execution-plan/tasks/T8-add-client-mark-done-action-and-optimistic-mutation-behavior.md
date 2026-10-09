# Task T8 — Add client Mark done action and optimistic mutation behavior

**Phase:** 3
**Depends:** T3, T7
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 8: Add client Mark done action and optimistic mutation behavior [depends: T3, T7]

## OBJECTIVE

Connect the approved Mark done command to My Work through `workItemMutations.ts`, expose only the mapping/terminal/pending-allowed action, remove successful items from Active, and rollback/refresh on conflict or failure.

Files:

- Create: `client/src/components/my-work/MyWorkDoneAction.tsx`
- Modify: `client/src/lib/workItemMutations.ts`
- Modify: `client/src/components/my-work/MyWorkRow.tsx`
- Modify: `client/src/components/my-work/MyWorkDetailSheet.tsx`
- Test: `client/src/lib/workItemMutations.test.ts`
- Test: `client/src/components/my-work/MyWorkDoneAction.test.tsx`

Steps:

1. Write failing test for: mutation router source/version contract.
   Test file: `client/src/lib/workItemMutations.test.ts`
   Level: unit
   Test intent: Given Board/Tracker MyWorkItem, when markWorkItemDone runs, then My Work command receives workspace/source/key/version and preserves source.
   Exercise through: exported mutation helper.
   Test doubles: fake api.markMyWorkDone; do not mock routing decision.
   Expected RED: helper does not exist.

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/lib/workItemMutations.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

3. Implement minimal behavior:
   Implement mutation router.

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/lib/workItemMutations.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

5. Write failing test for: mapping/terminal/pending disabled action.
   Test file: `client/src/components/my-work/MyWorkDoneAction.test.tsx`
   Level: component
   Test intent: Given canMarkDone=false because mapping is missing, item is terminal, or a mutation is pending, when action renders, then it is disabled with the specific reason and makes no mutation call.
   Exercise through: MyWorkDoneAction.
   Test doubles: fake mutation callback; do not mock disabled rendering.
   Expected RED: action component does not exist.

6. Run test — verify FAIL:
   `npm run test --workspace=client -- src/lib/workItemMutations.test.ts src/components/my-work/MyWorkDoneAction.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

7. Implement minimal behavior:
   Implement disabled action state.

8. Run test — verify PASS:
   `npm run test --workspace=client -- src/lib/workItemMutations.test.ts src/components/my-work/MyWorkDoneAction.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

9. Write failing test for: successful Mark done removes Active item.
   Test file: `client/src/components/my-work/MyWorkDoneAction.test.tsx`
   Level: component
   Test intent: Given eligible item and success, when clicked, then Active removes it, All retains Done, and success feedback appears.
   Exercise through: action/page callback.
   Test doubles: fake mutation success/page callback; do not mock state transition.
   Expected RED: success wiring is absent.

10. Run test — verify FAIL:
   `npm run test --workspace=client -- src/lib/workItemMutations.test.ts src/components/my-work/MyWorkDoneAction.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

11. Implement minimal behavior:
   Implement success reconciliation and row/detail slots.

12. Run test — verify PASS:
   `npm run test --workspace=client -- src/lib/workItemMutations.test.ts src/components/my-work/MyWorkDoneAction.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

13. Write failing test for: conflict/transient failure rollback.
   Test file: `client/src/components/my-work/MyWorkDoneAction.test.tsx`
   Level: component
   Test intent: Given conflict/transient failure, when action resolves, then optimistic state rolls back, refresh runs, and correct warning/error appears.
   Exercise through: action/page callback.
   Test doubles: fake conflict/error/refresh; do not mock rollback.
   Expected RED: recovery behavior is absent.

14. Run test — verify FAIL:
   `npm run test --workspace=client -- src/lib/workItemMutations.test.ts src/components/my-work/MyWorkDoneAction.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

15. Implement minimal behavior:
   Implement error mapping and rollback/refresh.

16. Run test — verify PASS:
   `npm run test --workspace=client -- src/lib/workItemMutations.test.ts src/components/my-work/MyWorkDoneAction.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

17. Write failing test for: membership/assignment 404 recovery.
   Test file: `client/src/components/my-work/MyWorkDoneAction.test.tsx`
   Level: component/integration
   Test intent: Given Mark done returns 404/not_found because membership or assignment was revoked, when the action resolves, then the stale item is removed/refresh is requested and no stale detail/action content remains.
   Exercise through: action/page refresh and unavailable-state collaboration.
   Test doubles: fake 404 mutation response and refresh callback; do not mock recovery logic.
   Expected RED: revoked-action recovery is absent.

18. Run test — verify FAIL:
   `npm run test --workspace=client -- src/lib/workItemMutations.test.ts src/components/my-work/MyWorkDoneAction.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

19. Implement minimal behavior:
   Map 404/not_found to refresh/removal and unavailable state without treating it as success.

20. Run test — verify PASS:
   `npm run test --workspace=client -- src/lib/workItemMutations.test.ts src/components/my-work/MyWorkDoneAction.test.tsx`
   Expected: the 404 recovery cycle passes without weakening adjacent behavior.

21. Write failing test for: Mark done race and direct-API must-not.
   Test file: `client/src/components/my-work/MyWorkDoneAction.test.tsx`
   Level: component/integration
   Test intent: Given Mark done succeeds while an older refresh is in flight, when the old snapshot arrives, then item is not reinserted and components never call updateCard/updateTrackerItem directly.
   Exercise through: row/detail/page collaboration.
   Test doubles: fake mutation/refresh responses and forbidden-call spies; do not mock reconciliation.
   Expected RED: race/must-not behavior is absent.

22. Run test — verify FAIL:
   `npm run test --workspace=client -- src/lib/workItemMutations.test.ts src/components/my-work/MyWorkDoneAction.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

23. Implement minimal behavior:
   Implement newest mutation precedence and keep all writes in workItemMutations.ts.

24. Run test — verify PASS:
   `npm run test --workspace=client -- src/lib/workItemMutations.test.ts src/components/my-work/MyWorkDoneAction.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

25. Refactor while green (bounded):
   Keep logic within the task's declared files, reuse existing helpers, and do not implement out-of-scope behavior. Re-run the task test command.

26. Commit:
   git add client/src/components/my-work/MyWorkDoneAction.tsx client/src/lib/workItemMutations.ts client/src/components/my-work/MyWorkRow.tsx client/src/components/my-work/MyWorkDetailSheet.tsx client/src/lib/workItemMutations.test.ts client/src/components/my-work/MyWorkDoneAction.test.tsx
   git commit -m "feat(my-work): add mark done action"

## REFERENCES LOADED

- Spec Mark done, membership/assignment reauthorization, mapping/terminal/pending availability, conflict, idempotency, and rollback criteria.
- `client/src/lib/workItemMutations.ts` and test — existing source-aware mutation router.
- `client/src/api/myWork.ts` — Mark done API contract from T1.
- `client/src/pages/MyWorkPage.tsx`, `MyWorkRow`, and `MyWorkDetailSheet` — action slots from T6/T7.

## WHY THIS APPROACH

Complexity: standard
Justification: Client mutation behavior must remain separate from read/list state and must prove source routing, mapping/terminal availability state, optimistic removal, and rollback.

## SANDWICH CONTEXT

[CRITICAL: All My Work writes must pass through `workItemMutations.ts` and the server source-aware command; the page must never call table-specific update APIs directly.]
You are implementing the single allowed My Work mutation.
Spec: `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md`
Design decision: Mark done only; full inline edit and bulk actions are out of scope.
Files in scope: mutation helper, action component, row/detail wiring, and listed tests.
Available after: T3 and T7.
Architecture rule: preserve version conflict, idempotency, membership/assignment reauthorization, and mapping/terminal/pending disabled behavior.
[RESTATE: All My Work writes must pass through `workItemMutations.ts` and the server source-aware command; the page must never call table-specific update APIs directly.]

## DELIVERABLE

Given an eligible Board/Tracker item, when Mark done succeeds, then Active removes it and All can show it as done.
Given missing mapping, terminal/pending state, or conflict, when Mark done is attempted, then no incorrect source write is exposed and the UI recovers/refreshes.
[must-not] Given a My Work component, when it writes, then it must not call `api.updateCard` or `api.updateTrackerItem` directly.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Client tests cover disabled reason, source-aware routing, success, version conflict, transient failure, rollback, and refresh.
- Mutation routing guard remains green.
- No duplicate action implementation between row and detail.

Must-not-have:

- No full edit/bulk/reassignment controls.
- No direct table-specific API calls from My Work page/components.

Open question risks:

- Revoked membership/assignment must map to the existing 404/not_found response without turning authorization failures into empty state.

Rollback note:

- Hide the Mark done action; existing Board/Tracker editing remains.

## STOP CONDITIONS

Done when: mutation/action tests pass and `npm run check:mutation-routing` is green.
Uncertain when: the API cannot expose a stable idempotent success/conflict result.
Escalate when: client mutation requires bypassing `workItemMutations.ts` or active workspace guards.
