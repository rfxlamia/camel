# Task T11 — TrackerRow.test.tsx — unit regression suite

**Phase:** 3
**Depends:** T10
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 11: TrackerRow.test.tsx — unit regression suite [depends: T10]

## OBJECTIVE
Round out `TrackerRow.test.tsx` (started in T10 with the kebab-class test) with the
cross-cutting unit-level coverage that can only be fully exercised once every trigger exists:
single-picker-mutex across all 8 triggers (status + 6 new property triggers + kebab), independent state across
rows, read-only compatibility, navigation isolation, and placeholder rendering.

Files:
- Modify: `client/src/components/tracker/TrackerRow.test.tsx`
- Modify: `client/src/components/tracker/TrackerRow.tsx` (only if the regression test exposes a
  row-state fix; otherwise no production change is made)

Test harness: mark the file as jsdom and mock `react-router`'s `useNavigate`, or wrap every
render in `MemoryRouter`, because `TrackerRowShell` calls `useNavigate` even for direct Row tests.
Use a stable `mockNavigate` so every new trigger can prove it does not navigate.

Steps:

1. Write regression tests for: opening one picker closes another on the same row (Story 6 Example A)
   Test file: `client/src/components/tracker/TrackerRow.test.tsx`
   Level: unit

   Test intent:
   Given `TrackerRow` rendered directly with a fully-populated fixture, exercise this pairwise
   transition table: `status → date`, `date → project`, `project → phase`, `phase → priority`,
   `priority → assignees`, `assignees → labels`, `labels → kebab`, and `kebab → status`. For each
   transition, click the source trigger and then the destination trigger. Then the source content
   is gone and only the destination picker is open. When the source is `date` after a draft edit,
   also assert its `onDateChange` callback fires exactly once before the destination opens.

   Exercise through: the transition table above, asserting source content is gone and destination
   content is present after each click pair; scope kebab child queries within its labeled panel.

   Test doubles: all `on*` props as `vi.fn()`

   Regression check: if `TrackerRow`'s "which picker" union state isn't correctly wired to close
   on any other trigger's click — this exercises all 8 trigger values and the date close contract
   across
   T3 (added "date"), T5 (added "project", "phase"), T6 (added "priority"), T9 (added
   "assignees", "labels"), T10 (added "kebab") — verifying the whole accumulated state
   machine works, not any single field in isolation

2. Run regression test — verify PASS (this may already pass if each prior task correctly extended
   the same single state variable rather than introducing parallel booleans — verify by
   running, don't assume; if it fails, that reveals an earlier task introduced a
   second/independent open-state instead of extending the shared union):
   `npm run test -- client/src/components/tracker/TrackerRow.test.tsx`

3. (Implement fix only if Step 2 failed — consolidate any independent boolean state found back
   into the single "which picker" union, or correct the date-close transition in
   `TrackerRow.tsx`. If this conditional production fix is needed, include it in the task commit;
   otherwise keep this task test-only.)

4. Write regression test for: "Set project" placeholder renders and is clickable when item has no project
   Test file: `client/src/components/tracker/TrackerRow.test.tsx`
   Level: unit
   Test intent: Given a fixture item with `projectId: null`, When `TrackerRow` renders, Then a "Set project" element is present and clicking it opens the project picker
   Exercise through: rendering with the null-project fixture, querying and clicking
   Test doubles: `onProjectChange` as `vi.fn()`
   Regression check: behavior specified and implemented in T5; if it fails, preserve the
   assertion, fix the Row, and rerun.

5. Run test — verify PASS (verify): `npm run test -- client/src/components/tracker/TrackerRow.test.tsx`

6. Write regression test for: "Set phase" placeholder, same pattern
   Test file: `client/src/components/tracker/TrackerRow.test.tsx`
   Level: unit
   Test intent: Given a fixture item with a project but `phaseId: null`, When `TrackerRow` renders, Then a "Set phase" element is present and clickable
   Exercise through: same pattern as Step 4, for phase
   Test doubles: `onPhaseChange` as `vi.fn()`
   Regression check: behavior specified and implemented in T5; if it fails, preserve the
   assertion, fix the Row, and rerun.

7. Run test — verify PASS (verify): `npm run test -- client/src/components/tracker/TrackerRow.test.tsx`

8. Write regression test for: "Set date" placeholder when both dates unset (Story 1 Example H)
   Test file: `client/src/components/tracker/TrackerRow.test.tsx`
   Level: unit
   Test intent: Given a fixture item with `startDate: null, endDate: null`, When `TrackerRow` renders, Then a "Set date" element is present
   Exercise through: rendering with the null-dates fixture, querying
   Test doubles: `onDateChange` as `vi.fn()`
   Regression check: behavior specified and implemented in T4; if it fails, preserve the
   assertion, fix the Row, and rerun.

9. Run test — verify PASS (verify): `npm run test -- client/src/components/tracker/TrackerRow.test.tsx`

10. Write regression test for: two rows keep independent picker state
    Given Row A and Row B both render with editable assignee pickers, When both triggers are
    opened, Then both rows retain their own open popover and choosing a field on Row B does not
    close or mutate Row A's local picker state.

11. Write regression test for: read-only date compatibility and navigation isolation
    Given a Row rendered without `onDateChange`, Then it still renders the existing `createdAt`
    `<time>` value and no date trigger. Given the editable Row, When each representative new
    trigger (date, project, phase, priority, assignee, label, and kebab) is clicked, Then
    `mockNavigate` remains unused. Also assert the new controls, including the kebab trigger and
    its labeled panel, live beneath the
    `pointer-events-auto` content path.

12. Run the complete Row test file — verify PASS:
    `npm run test -- client/src/components/tracker/TrackerRow.test.tsx`

13. Refactor while green: if this test file has accumulated 3+ near-identical fixture-item
    constructions across its tests (from T10's test plus Steps 1-9), extract a shared
    `makeRowItem(overrides)` helper at the top of the file (test-file-local, not exported —
    this is normal test-fixture practice, not a Rule of Three violation of production code)
    Re-run: `npm run test -- client/src/components/tracker/TrackerRow.test.tsx` — must stay PASS

14. Commit:
    If Step 3 required the conditional production fix, stage both
    `client/src/components/tracker/TrackerRow.tsx` and the test; otherwise stage only
    `client/src/components/tracker/TrackerRow.test.tsx`.
    `git commit -m "test(tracker): add unit regression suite for row picker mutex and placeholders"`

15. Run the full repository test suite once, to confirm the entire feature's tests pass together
    (not just each file in isolation):
    `npm run test`
    Expected: all tests PASS, including every file touched across T1-T11. Then run the remaining
    repository gates from the repository root: `npm run typecheck`, `npm run lint`, and
    `npm run build`; all four commands must pass before the plan is marked complete.

## REFERENCES LOADED
`docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md` — Story 6 Rule 1, Story 2 Examples A/C, Story 1 Example H
`client/src/components/tracker/TrackerRow.tsx` (post-T10) — the fully-wired component under test

## WHY THIS APPROACH
Complexity: standard
Justification: This is the first point where the accumulated "which picker" state machine (extended incrementally across 6 prior tasks) can be exercised as a whole, and where fast, isolated unit tests (mounting `TrackerRow` directly, not the whole `TrackerPage`) are more appropriate than further integration tests — this is a deliberate test-level choice, not an afterthought.

## SANDWICH CONTEXT
[CRITICAL: This task's tests must render TrackerRow directly (not through TrackerPage) — they are unit tests verifying the row component's own state machine, not integration tests of data fetching or mutation]
You are implementing Task 11 for Camel's Tracker row inline-editing feature.
Spec: `docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md`
Design decision: dedicated unit-level regression suite, distinct from TrackerPage.test.tsx's integration coverage
Files in scope: `client/src/components/tracker/TrackerRow.test.tsx`
Available after: T10
Architecture rule: unit-level only — render `TrackerRow` directly with mock props, do not render `TrackerPage`
[RESTATE: Render TrackerRow directly, not TrackerPage — this is unit-level verification]

## DELIVERABLE
Given a picker open on a row, When another trigger on the SAME row is clicked, Then the first closes and the second opens
Given two rows have pickers open, When a trigger on one row is used, Then the other row's picker state remains independent
Given item has no project, When row renders, Then "Set project" placeholder is present and clickable
Given item has no phase, When row renders, Then "Set phase" placeholder is present and clickable
Given both dates unset, When row renders, Then "Set date" placeholder is present
Given a read-only Row has no `onDateChange`, When it renders, Then the existing `createdAt` time remains visible and no date trigger exists
Given any new Row trigger is clicked, Then row navigation is not invoked

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Every test in this file renders `TrackerRow` directly, not `TrackerPage`
  - The mutex matrix covers all 8 trigger values, including date commit-before-switch and kebab panel scoping
  - Tests written BEFORE any fixes they reveal are needed
  - Full root `npm run test` run confirms no cross-file regressions

Must-not-have:
  - Re-testing mutation/API/queue behavior already covered in `TrackerPage.test.tsx` (T2, T4, T5, T6, T7, T9) — this file is for the row's own presentational/state-machine logic only
  - Modifications to files outside listed scope

Open question risks:
  - None specific

Rollback note:
  - Test-only additions; safe to revert independently

## STOP CONDITIONS
Done when: all listed DELIVERABLE scenarios pass, the full root test/typecheck/lint/build gate
passes, and the commit is created
Uncertain when: N/A
Escalate when: the full-suite run in Step 15 surfaces a regression in a file this task didn't touch — report which file/test, do not fix it silently within this task's scope

---

## Final verification gate

After T11's feature tests pass, run these commands from the repository root, in order:

```text
npm run test
npm run typecheck
npm run lint
npm run build
```

The plan is not complete until all four commands pass. Record any environment-only blocker
separately from a test or type/lint/build failure; do not silently mark the plan complete.
