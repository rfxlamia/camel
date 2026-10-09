# Task T6 — Build the My Work page, list, filters, errors, and responsive rows

**Phase:** 2
**Depends:** T2, T4, T5
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 6: Build the My Work page, list, filters, errors, and responsive rows [depends: T2, T4, T5]

## OBJECTIVE

Create the route-driven My Work page that loads the personal rollup, preserves URL view state, renders grouped 50-item pages, handles empty/error/loading states, and provides responsive rows/toolbars without implementing detail or Mark done yet.

Files:

- Create: `client/src/pages/MyWorkPage.tsx`
- Create: `client/src/components/my-work/MyWorkToolbar.tsx`
- Create: `client/src/components/my-work/MyWorkList.tsx`
- Create: `client/src/components/my-work/MyWorkRow.tsx`
- Modify: `client/src/App.tsx`
- Create: `client/src/pages/MyWorkPage.test.tsx`
- Create: `client/src/components/my-work/MyWorkRow.test.tsx`

Steps:

1. Write failing test for: normal rendering, filters, groups, and URL state.
   Test file: `client/src/pages/MyWorkPage.test.tsx`
   Level: component
   Test intent: Given authorized response, when /my-work renders and controls change, then grouped rows/badges and URL state update without activeWorkspaceId rollup scope.
   Exercise through: Router/page/API boundary.
   Test doubles: fake API/BoardContext; do not mock page helpers.
   Expected RED: route/page/components do not exist.

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/pages/MyWorkPage.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

3. Implement minimal behavior:
   Implement route/page/toolbar/list loading.

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/pages/MyWorkPage.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

5. Write failing test for: transient whole-page error and retry.
   Test file: `client/src/pages/MyWorkPage.test.tsx`
   Level: component
   Test intent: Given transient list failure, when page renders/retry is clicked, then no partial list appears and complete request retries.
   Exercise through: page error/retry boundary.
   Test doubles: fake API reject then success; do not mock error UI.
   Expected RED: error/retry behavior is absent.

6. Run test — verify FAIL:
   `npm run test --workspace=client -- src/pages/MyWorkPage.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

7. Implement minimal behavior:
   Implement fail-whole-page error and retry.

8. Run test — verify PASS:
   `npm run test --workspace=client -- src/pages/MyWorkPage.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

9. Write failing test for: actionable Active empty state.
   Test file: `client/src/pages/MyWorkPage.test.tsx`
   Level: component
   Test intent: Given Active empty and All historical items, when Active renders, then actionable empty state and All control appear.
   Exercise through: page scope rendering.
   Test doubles: deterministic fixtures; do not mock empty decision.
   Expected RED: empty state is absent.

10. Run test — verify FAIL:
   `npm run test --workspace=client -- src/pages/MyWorkPage.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

11. Implement minimal behavior:
   Implement Active empty state.

12. Run test — verify PASS:
   `npm run test --workspace=client -- src/pages/MyWorkPage.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

13. Write failing test for: visibility refresh newest-request behavior.
   Test file: `client/src/pages/MyWorkPage.test.tsx`
   Level: component
   Test intent: Given page becomes visible after hidden, when refresh effects run, then newest request wins and stale response is discarded.
   Exercise through: page effect/visibility boundary.
   Test doubles: fake API sequence, visibility events, timers; do not mock reconciliation.
   Expected RED: visibility refresh is absent.

14. Run test — verify FAIL:
   `npm run test --workspace=client -- src/pages/MyWorkPage.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

15. Implement minimal behavior:
   Implement visibility refresh and sequence guard.

16. Run test — verify PASS:
   `npm run test --workspace=client -- src/pages/MyWorkPage.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

17. Write failing test for: expired session is not empty state.
   Test file: `client/src/pages/MyWorkPage.test.tsx`
   Level: component
   Test intent: Given API returns auth/session error, when page renders, then existing session error appears rather than empty state.
   Exercise through: page error mapping.
   Test doubles: fake auth error; do not mock error classification.
   Expected RED: auth distinction is absent.

18. Run test — verify FAIL:
   `npm run test --workspace=client -- src/pages/MyWorkPage.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

19. Implement minimal behavior:
   Map auth/session errors explicitly.

20. Run test — verify PASS:
   `npm run test --workspace=client -- src/pages/MyWorkPage.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

21. Write failing test for: manual Refresh keeps view state.
   Test file: `client/src/pages/MyWorkPage.test.tsx`
   Level: component
   Test intent: Given rendered list, when toolbar Refresh is activated, then a new personal request runs and existing view state remains.
   Exercise through: toolbar Refresh control.
   Test doubles: fake API response sequence; do not mock refresh transition.
   Expected RED: manual Refresh is absent.

22. Run test — verify FAIL:
   `npm run test --workspace=client -- src/pages/MyWorkPage.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

23. Implement minimal behavior:
   Implement explicit Refresh action.

24. Run test — verify PASS:
   `npm run test --workspace=client -- src/pages/MyWorkPage.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

25. Write failing test for: page-level ordering integration.
   Test file: `client/src/pages/MyWorkPage.test.tsx`
   Level: component
   Test intent: Given 73 active items with due ordering, when page renders, then helper-defined status/order appears in the rendered list.
   Exercise through: full page/list with real helpers.
   Test doubles: deterministic API fixture; do not mock derivation.
   Expected RED: page does not integrate ordering.

26. Run test — verify FAIL:
   `npm run test --workspace=client -- src/pages/MyWorkPage.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

27. Implement minimal behavior:
   Wire real ordering/group helpers.

28. Run test — verify PASS:
   `npm run test --workspace=client -- src/pages/MyWorkPage.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

29. Write failing test for: page-level 50/23 pagination.
   Test file: `client/src/pages/MyWorkPage.test.tsx`
   Level: component
   Test intent: Given 73 active items, when page changes from page 1 to page 2, then 50/23 rows appear with no duplicates/gaps.
   Exercise through: full page/list pagination.
   Test doubles: deterministic fixture; do not mock pagination.
   Expected RED: page pagination is absent.

30. Run test — verify FAIL:
   `npm run test --workspace=client -- src/pages/MyWorkPage.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

31. Implement minimal behavior:
   Wire rendered pagination and URL page state.

32. Run test — verify PASS:
   `npm run test --workspace=client -- src/pages/MyWorkPage.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

33. Write failing test for: responsive row content.
   Test file: `client/src/components/my-work/MyWorkRow.test.tsx`
   Level: component
   Test intent: Given long Board/Tracker metadata at compact/mobile props, when row renders, then key/title/status/workspace/source/due/action remain usable.
   Exercise through: MyWorkRow public props.
   Test doubles: plain fixtures/viewport class assertions; do not mock row.
   Expected RED: row component does not exist.

34. Run test — verify FAIL:
   `npm run test --workspace=client -- src/components/my-work/MyWorkRow.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

35. Implement minimal behavior:
   Implement responsive row/list/toolbar components.

36. Run test — verify PASS:
   `npm run test --workspace=client -- src/components/my-work/MyWorkRow.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

37. Refactor while green (bounded):
   Keep logic within the task's declared files, reuse existing helpers, and do not implement out-of-scope behavior. Re-run the task test command.

38. Commit:
   git add client/src/pages/MyWorkPage.tsx client/src/components/my-work/MyWorkToolbar.tsx client/src/components/my-work/MyWorkList.tsx client/src/components/my-work/MyWorkRow.tsx client/src/App.tsx client/src/pages/MyWorkPage.test.tsx client/src/components/my-work/MyWorkRow.test.tsx
    git commit -m "feat(my-work): build personal work list"

## REFERENCES LOADED

- Spec stories for triage, search, pagination, failure, URL state, and mobile.
- `client/src/App.tsx` — authenticated route/lazy page pattern.
- `client/src/pages/TrackerPage.tsx` and `TrackerRow.tsx` — list loading, grouping, inline metadata, and refresh conventions.
- `client/src/types/myWork.ts`, `client/src/api/myWork.ts`, and helpers from T1/T4 — including `listActiveMyWorkCandidates` (bounded ≤20-page Active candidate drain added as a T2 correction); Active-scope search must consume it instead of a single-page `listMyWork`.
- React Router docs for lazy routes/search params and React docs for stale-effect cleanup.

## WHY THIS APPROACH

Complexity: deep
Justification: This is the main user-facing surface and coordinates route state, async loading, grouping, search, pagination, error semantics, and responsive layout. Detail and mutation are intentionally separate tasks to keep boundaries reviewable.

## SANDWICH CONTEXT

[CRITICAL: The page may read only the server-authorized personal response and must never use activeWorkspaceId as the rollup security scope.]
You are implementing the My Work list surface.
Spec: `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md`
Design decision: global personal read, Active-first status grouping, 50-item render pages, whole-page transient errors.
Files in scope: listed page/components, App route, and their tests.
Available after: T2, T4, T5.
Architecture rule: keep URL state route-driven, source/workspace metadata visible, and all mutation/detail action slots explicit.
[RESTATE: The page may read only the server-authorized personal response and must never use activeWorkspaceId as the rollup security scope.]

## DELIVERABLE

Given an authorized API response, when `/my-work` renders, then Active/All, filters, groups, order, 50-item pages, badges, and URL state match the spec.
Given a transient API failure, when the page renders, then it shows a retryable whole-page error rather than a partial list.
Given no Active items but historical items exist, when Active is selected, then the empty state is actionable and All remains available.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Page tests cover Active/All, filters, loading, empty, transient error, retry, stale response, and URL state.
- Active-scope search drains the bounded candidate window via `listActiveMyWorkCandidates`; All-scope search stays server-paginated.
- Row tests cover Board/Tracker metadata and mobile layout.
- No detail or mutation logic is hidden in the list implementation.

Must-not-have:

- No client-side authorization or workspace fan-out.
- No partial list presented as complete after transient failure.
- No full inline editing or bulk action controls.

Open question risks:

- All candidate-window fuzzy behavior must remain visible in UI copy/tests if the result is not exhaustive.

Rollback note:

- Hide/remove `/my-work` route and nav entry; existing pages remain unchanged.

## STOP CONDITIONS

Done when: page and row tests pass and the page has no direct source mutation calls.
Uncertain when: current context providers cannot supply explicit source navigation/guard callbacks without changing active workspace semantics.
Escalate when: implementing the page requires bypassing BoardContext focus/unsaved-edit guards.
