# Task T4 — Build My Work normalization, ordering, pagination, and Fuse search helpers

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 4: Build My Work normalization, ordering, pagination, and Fuse search helpers [depends: T1]

## OBJECTIVE

Create pure client helpers for status-group normalization, workspace-timezone overdue ordering, Active/All filtering, stable pagination, URL view-state parsing, and bounded Fuse.js search.

Files:

- Create: `client/src/lib/myWorkUtils.ts`
- Create: `client/src/lib/myWorkSearch.ts`
- Test: `client/src/lib/myWorkUtils.test.ts`
- Test: `client/src/lib/myWorkSearch.test.ts`

Steps:

1. Write failing test for: status normalization and Active/All filtering.
   Test file: `client/src/lib/myWorkUtils.test.ts`
   Level: unit
   Test intent: Given backlog/started/completed/canceled/unknown categories, when helpers derive groups, then terminal categories are excluded from Active and unknown is Other.
   Exercise through: pure normalization/filter functions.
   Test doubles: plain fixtures; do not mock helper logic.
   Expected RED: helper module does not exist.

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/lib/myWorkUtils.test.ts src/lib/myWorkSearch.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

3. Implement minimal behavior:
   Implement status normalization/filtering.

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/lib/myWorkUtils.test.ts src/lib/myWorkSearch.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

5. Write failing test for: workspace-timezone overdue ordering and ties.
   Test file: `client/src/lib/myWorkUtils.test.ts`
   Level: unit
   Test intent: Given workspace-local day boundaries and equal tie values, when ordering runs, then overdue/tie behavior is deterministic.
   Exercise through: pure ordering/date functions.
   Test doubles: fake clock/time values; do not mock Intl/date behavior.
   Expected RED: timezone/tie behavior is absent.

6. Run test — verify FAIL:
   `npm run test --workspace=client -- src/lib/myWorkUtils.test.ts src/lib/myWorkSearch.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

7. Implement minimal behavior:
   Implement timezone-aware overdue and stable tie-breaker.

8. Run test — verify PASS:
   `npm run test --workspace=client -- src/lib/myWorkUtils.test.ts src/lib/myWorkSearch.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

9. Write failing test for: 50-item pagination and URL state.
   Test file: `client/src/lib/myWorkUtils.test.ts`
   Level: unit
   Test intent: Given 73 active items and scope/filter/page query values, when helpers run, then pages contain 50/23 and invalid query values use safe defaults.
   Exercise through: pure pagination/URL helpers.
   Test doubles: plain fixtures and URLSearchParams; do not mock helpers.
   Expected RED: pagination/view-state helpers are absent.

10. Run test — verify FAIL:
   `npm run test --workspace=client -- src/lib/myWorkUtils.test.ts src/lib/myWorkSearch.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

11. Implement minimal behavior:
   Implement pagination and URL-state helpers.

12. Run test — verify PASS:
   `npm run test --workspace=client -- src/lib/myWorkUtils.test.ts src/lib/myWorkSearch.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

13. Write failing test for: Fuse keys, typo ranking, and no authorization discovery.
   Test file: `client/src/lib/myWorkSearch.test.ts`
   Level: unit
   Test intent: Given key/title/description values and only server-provided items, when “imgae uplod” is searched, then Image upload retry ranks and no fetch/membership/authorization discovery occurs.
   Exercise through: Fuse search helper with real Fuse.js and its pure input boundary.
   Test doubles: plain fixtures and a fetch spy; do not mock Fuse.js, search logic, or authorization.
   Expected RED: search helper/configuration does not exist.

14. Run test — verify FAIL:
   `npm run test --workspace=client -- src/lib/myWorkUtils.test.ts src/lib/myWorkSearch.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

15. Implement minimal behavior:
   Implement explicit Fuse keys/threshold and keep the helper pure and response-bounded.

16. Run test — verify PASS:
   `npm run test --workspace=client -- src/lib/myWorkUtils.test.ts src/lib/myWorkSearch.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

17. Write failing test for: Fuse result limit and All candidate window.
   Test file: `client/src/lib/myWorkSearch.test.ts`
   Level: unit
   Test intent: Given candidate items and a limit, when search runs, then result limit/order are deterministic and All ranks only the provided candidate window.
   Exercise through: Fuse candidate helper.
   Test doubles: plain fixtures; do not mock Fuse.js.
   Expected RED: limit/candidate behavior is absent.

18. Run test — verify FAIL:
   `npm run test --workspace=client -- src/lib/myWorkUtils.test.ts src/lib/myWorkSearch.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

19. Implement minimal behavior:
   Implement bounded result limit and candidate-window path.

20. Run test — verify PASS:
   `npm run test --workspace=client -- src/lib/myWorkUtils.test.ts src/lib/myWorkSearch.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

21. Refactor while green (bounded):
   Keep logic within the task's declared files, reuse existing helpers, and do not implement out-of-scope behavior. Re-run the task test command.

22. Commit:
   git add client/src/lib/myWorkUtils.ts client/src/lib/myWorkSearch.ts client/src/lib/myWorkUtils.test.ts client/src/lib/myWorkSearch.test.ts
    git commit -m "feat(my-work): add list derivation and fuzzy search"

## REFERENCES LOADED

- Spec rules for Active/All, ordering, timezone, pagination, URL state, and Fuse search.
- `client/src/types/myWork.ts` from T1.
- `client/src/lib/boardViewUtils.ts` and tracker utility tests for existing date/status conventions.
- Fuse.js docs for object keys, threshold, score sorting, and result limits.
- React 18 docs for stale-effect cleanup; page consumers must use the helpers without letting stale responses update state.

## WHY THIS APPROACH

Complexity: standard
Justification: Pure helpers isolate the highest-branching client behavior and make status/timezone/search rules testable without rendering the page.

## SANDWICH CONTEXT

[CRITICAL: Status/category normalization and overdue ordering must remain pure, deterministic, and must not perform authorization or network access.]
You are implementing the client derivation layer for My Work.
Spec: `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md`
Design decision: Active uses bounded Fuse.js ranking; All remains server-paginated.
Files in scope: the two helper modules and their tests.
Available after: T1.
Architecture rule: no client helper may decide whether an item is authorized; it may only derive presentation from the server response.
[RESTATE: Status/category normalization and overdue ordering must remain pure, deterministic, and must not perform authorization or network access.]

## DELIVERABLE

Given mixed source/status/timezone items, when helpers run, then Active/All groups, order, overdue labels, and 50-item pages match the spec.
Given a typo query, when Fuse search runs, then the expected item is ranked and the result limit is respected.
[must-not] Given an unauthorized item is absent from the response, when search/filter runs, then the helper must not attempt to discover or fetch it.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Pure helpers have unit tests for terminal/unknown statuses, same-day timezone boundaries, ties, pagination, and typo search.
- Fuse.js is used as a bounded presentation search, never as access control.
- No date/search logic is copied into page components.

Must-not-have:

- No server calls, mutation, or workspace switching in helper modules.
- No unbounded All-history fetch initiated by a helper.

Open question risks:

- All candidate-window fuzzy completeness remains a documented assumption.

Rollback note:

- Remove the new helper modules; page task has not yet consumed them.

## STOP CONDITIONS

Done when: both helper test files pass and the helpers have no network or authorization responsibilities.
Uncertain when: workspace timezone cannot be derived using existing response metadata and platform APIs.
Escalate when: a new date/time dependency is proposed solely to implement helper logic.
