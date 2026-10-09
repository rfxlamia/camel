# Task T10 — Verify cross-component client acceptance

**Phase:** 3
**Depends:** T8
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 10: Verify cross-component client acceptance [depends: T8] [test-risk]

## OBJECTIVE

Verify the route, URL state, global detail, guarded source navigation, responsive bottom sheet, error/empty states, and Mark done action as a collaborating client surface.

Files:

- Create: `client/src/pages/MyWorkPage.integration.test.tsx`

Steps:

> RED expectation: T6/T7/T8 are already implemented when this task runs, so these acceptance cycles may PASS on first run. Treat an immediate PASS as acceptance confirmed — RED is only expected when a regression or cross-component gap exists. Do not weaken assertions to force a red phase.

1. Write failing test for: route/detail/back state.
   Test file: `client/src/pages/MyWorkPage.integration.test.tsx`
   Level: component integration
   Test intent: Given MemoryRouter/API/BoardContext, when user opens /my-work, filters, opens detail, closes/back, then URL state survives and activeWorkspaceId stays.
   Exercise through: route tree/page/detail collaboration.
   Test doubles: fake network/context boundaries; do not mock My Work units.
   Expected RED: integration route behavior is absent.

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/pages/MyWorkPage.integration.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

3. Implement minimal behavior:
   Build client integration harness for route/detail/back.

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/pages/MyWorkPage.integration.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

5. Write failing test for: guarded source navigation.
   Test file: `client/src/pages/MyWorkPage.integration.test.tsx`
   Level: component integration
   Test intent: Given a non-active source item, when Open in Board/Tracker is allowed, blocked, or canceled, then only allowed transition navigates and blocked state remains.
   Exercise through: source action/BoardContext guard collaboration.
   Test doubles: fake API/session inputs only; mount the real BoardContext focus/unsaved guard and router transition boundary.
   Expected RED: guard collaboration is absent.

6. Run test — verify FAIL:
   `npm run test --workspace=client -- src/pages/MyWorkPage.integration.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

7. Implement minimal behavior:
   Add independent source-guard assertion.

8. Run test — verify PASS:
   `npm run test --workspace=client -- src/pages/MyWorkPage.integration.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

9. Write failing test for: mobile detail bottom sheet.
   Test file: `client/src/pages/MyWorkPage.integration.test.tsx`
   Level: component integration
   Test intent: Given 390px viewport, when item opens, then responsive row/detail bottom sheet and close control work.
   Exercise through: full page/detail surface.
   Test doubles: fake network/viewport only; do not mock components.
   Expected RED: mobile collaboration is absent.

10. Run test — verify FAIL:
   `npm run test --workspace=client -- src/pages/MyWorkPage.integration.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

11. Implement minimal behavior:
   Add mobile integration assertion.

12. Run test — verify PASS:
   `npm run test --workspace=client -- src/pages/MyWorkPage.integration.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

13. Write failing test for: transient whole-page error/retry.
   Test file: `client/src/pages/MyWorkPage.integration.test.tsx`
   Level: component integration
   Test intent: Given list timeout/5xx, when page loads/retries, then whole-page error appears and complete request retries.
   Exercise through: page/API collaboration.
   Test doubles: fake network sequence; do not mock error UI.
   Expected RED: error collaboration is absent.

14. Run test — verify FAIL:
   `npm run test --workspace=client -- src/pages/MyWorkPage.integration.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

15. Implement minimal behavior:
   Add error/retry assertion.

16. Run test — verify PASS:
   `npm run test --workspace=client -- src/pages/MyWorkPage.integration.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

17. Write failing test for: Active empty state.
   Test file: `client/src/pages/MyWorkPage.integration.test.tsx`
   Level: component integration
   Test intent: Given no Active items but All history, when Active renders, then actionable empty state and All navigation work.
   Exercise through: page/scope collaboration.
   Test doubles: fake response fixture; do not mock empty decision.
   Expected RED: empty collaboration is absent.

18. Run test — verify FAIL:
   `npm run test --workspace=client -- src/pages/MyWorkPage.integration.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

19. Implement minimal behavior:
   Add empty-state assertion.

20. Run test — verify PASS:
   `npm run test --workspace=client -- src/pages/MyWorkPage.integration.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

21. Write failing test for: All query/cursor is server-backed.
   Test file: `client/src/pages/MyWorkPage.integration.test.tsx`
   Level: component integration
   Test intent: Given All scope/history candidates, when query or cursor changes, then API receives a new server-backed request and client does not load unbounded history.
   Exercise through: page/API/query-state collaboration.
   Test doubles: fake fetch spy/paginated responses; do not mock page request decision.
   Expected RED: All query/cursor collaboration is absent.

22. Run test — verify FAIL:
   `npm run test --workspace=client -- src/pages/MyWorkPage.integration.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

23. Implement minimal behavior:
   Add server-backed All assertion.

24. Run test — verify PASS:
   `npm run test --workspace=client -- src/pages/MyWorkPage.integration.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

25. Write failing test for: Mark done rollback collaboration.
   Test file: `client/src/pages/MyWorkPage.integration.test.tsx`
   Level: component integration
   Test intent: Given Mark done conflict while older refresh exists, when response arrives, then rollback/refresh runs and stale snapshot cannot reinsert item.
   Exercise through: page/action/refresh collaboration.
   Test doubles: fake mutation/refresh sequence; do not mock reconciliation.
   Expected RED: mutation collaboration is absent.

26. Run test — verify FAIL:
   `npm run test --workspace=client -- src/pages/MyWorkPage.integration.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

27. Implement minimal behavior:
   Add rollback/race assertion.

28. Run test — verify PASS:
   `npm run test --workspace=client -- src/pages/MyWorkPage.integration.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

29. Refactor while green (bounded):
   Keep logic within this integration test, reuse existing helpers, and do not implement out-of-scope behavior. Re-run the task test command.

30. Commit:
   git add client/src/pages/MyWorkPage.integration.test.tsx
   git commit -m "test(my-work): verify client surface integration"

## REFERENCES LOADED

- Spec global detail, URL state, mobile, error, empty, and Mark done GWT scenarios.
- T6/T7/T8 client components and helpers.
- Existing `client/src/pages/TrackerPage.test.tsx` and `TrackerDetailPage.test.tsx` for Testing Library/Vitest patterns.
- React Router and React effect cleanup docs.

## WHY THIS APPROACH

Complexity: standard
Justification: Page, detail, navigation guard, URL state, and mutation UI can each pass unit tests while failing together. This independently useful client collaboration test is marked test-risk.

## SANDWICH CONTEXT

[CRITICAL: Global detail and source navigation must preserve URL/list state and must never silently change the active workspace.]
You are verifying My Work client collaboration.
Spec: `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md`
Design decision: global detail first, explicit guarded source navigation, bounded Mark done.
Files in scope: the new client integration test and declared test harness only.
Available after: T8.
Architecture rule: use real page/detail/guard/action collaboration; mock only network/context boundaries.
[RESTATE: Global detail and source navigation must preserve URL/list state and must never silently change the active workspace.]

## DELIVERABLE

Given real page/detail/navigation/mutation components, when the client acceptance flows run, then URL, guard, mobile, error, empty, and rollback behavior pass.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- URL/back, active workspace, guard, mobile, error, empty, and Mark done conflict behavior are covered in one collaborating surface.
- No production behavior is bypassed by mocking My Work units.

Must-not-have:

- No browser-only framework or new test library.
- No changes to unrelated page tests.

Open question risks:

- Exact route nesting can change while preserving observed URL/back behavior.

Rollback note:

- Delete the integration test; unit tests remain in place.

## STOP CONDITIONS

Done when: client integration tests pass with no production-only test switches.
Uncertain when: existing BoardContext cannot be mounted without active workspace data; report NEEDS_CONTEXT rather than bypassing it.
Escalate when: test setup requires changing activeWorkspaceId on row selection.
