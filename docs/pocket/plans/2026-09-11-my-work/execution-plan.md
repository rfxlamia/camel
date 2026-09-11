# EXECUTION PLAN — My Work

**Date:** 2026-09-11
**Spec:** `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md`
**Status:** draft
**Total tasks:** 11

---

## Execution Overview

### Recommended Order

```text
T1 → T2, T4, T5 (parallel) → T3, T6 (as dependencies complete) → T7 → T8 → T9, T10, T11 (as dependencies complete)
```

> Dependency order above is recommended — pocket skill enforces actual parallelism and sequencing based on its routing logic.

### Phases

- **Phase A — Foundation:** T1
- **Phase B — Server and client foundations:** T2, T3, T4, T5
- **Phase C — Product surfaces:** T6, T7, T8
- **Phase D — Cross-unit verification and quality:** T9, T10, T11

### Parallelizable Groups

| Group | Tasks | Unblocked After |
| ------- | ------- | ----------------- |
| Group A | T2, T4, T5 | T1 completes |
| Group B | T9 | T2 and T3 complete |
| Group C | T10 | T8 completes |
| Group D | T11 | T3 and T6 complete |

### Constraints Reminder

**Architecture:** Personal reads must be authorized server-side by workspace membership and assignee relationship; queries must be set-based with batched hydration; the intentional `cards` + `tracker_items` dual-table shim remains; tracker-wins dedup is per workspace; client writes use `workItemMutations.ts`; Board/Tracker status mappings and activity/version semantics are preserved; no client-side authorization boundary; no silent workspace switching; server imports use NodeNext `.js` extensions; root verification uses `npm run test`.

**Out-of-scope:** Physical `work_items` migration; full inline editing; bulk actions; reassignment; arbitrary cross-workspace writes; user-level SSE; reporting/calendar/roadmap/analytics; created-by-only items; silent workspace switching.

**Assumptions at risk:** All-scope fuzzy ranking is candidate-window based; global detail route shape is additive; Tracker done target uses deterministic `slot="done"` position/id selection; membership/assignment reauthorization follows existing routes; visibility/manual refresh is the V1 freshness contract.

**Sequencing:** Dependency order shown is recommended — pocket-development enforces actual blocking rules. T9, T10, and T11 start as soon as their declared dependencies complete; T11 waits for the T6 client page because it owns the client readiness test.

### File Structure Map

```text
Rule: Shared client contract and fuzzy-search dependency
  Create: client/src/types/myWork.ts                         (created by: T1)
  Create: client/src/api/myWork.ts                            (created by: T1)
  Modify: client/src/types.ts
  Modify: client/src/api.ts
  Modify: client/package.json
  Modify: package-lock.json
  Test:   client/src/api.my-work.test.ts

Rule: Authorized personal rollup and global detail read
  Create: server/src/routes/my-work-response.ts                (created by: T2)
  Create: server/src/routes/my-work.ts                         (created by: T2)
  Modify: server/src/routes.ts
  Test:   server/src/routes/my-work.test.ts

Rule: Source-aware Mark done command
  Create: server/src/core/tracker-item-status-change.ts         (created by: T3)
  Create: server/src/core/my-work-mark-done.ts                  (created by: T3)
  Modify: server/src/routes/tracker-items.ts
  Modify: server/src/routes/my-work.ts
  Test:   server/src/core/tracker-item-status-change.test.ts
  Test:   server/src/core/my-work-mark-done.test.ts
  Test:   server/src/core/board-card-status-change.test.ts (existing regression)
  Test:   server/src/routes/tracker-items.write.test.ts (existing regression)

Rule: Active/All normalization, ordering, timezone, pagination, and Fuse search
  Create: client/src/lib/myWorkUtils.ts                        (created by: T4)
  Create: client/src/lib/myWorkSearch.ts                       (created by: T4)
  Test:   client/src/lib/myWorkUtils.test.ts
  Test:   client/src/lib/myWorkSearch.test.ts

Rule: Global navigation
  Modify: client/src/layout/sidebar/navItems.ts
  Modify: client/src/layout/sidebar/Sidebar.tsx
  Modify: client/src/layout/sidebar/MobileNav.tsx
  Test:   client/src/layout/sidebar/myWorkNavigation.test.tsx

Rule: My Work page, list, filters, errors, empty state, and responsive rows
  Create: client/src/pages/MyWorkPage.tsx                       (created by: T6)
  Create: client/src/components/my-work/MyWorkToolbar.tsx       (created by: T6)
  Create: client/src/components/my-work/MyWorkList.tsx          (created by: T6)
  Create: client/src/components/my-work/MyWorkRow.tsx           (created by: T6)
  Modify: client/src/App.tsx
  Test:   client/src/pages/MyWorkPage.test.tsx
  Test:   client/src/components/my-work/MyWorkRow.test.tsx

Rule: Global detail and explicit source navigation
  Create: client/src/components/my-work/MyWorkDetailSheet.tsx   (created by: T7)
  Create: client/src/lib/myWorkNavigation.ts                   (created by: T7)
  Modify: client/src/pages/MyWorkPage.tsx
  Test:   client/src/components/my-work/MyWorkDetailSheet.test.tsx

Rule: Mark done client mutation and optimistic behavior
  Create: client/src/components/my-work/MyWorkDoneAction.tsx   (created by: T8)
  Modify: client/src/lib/workItemMutations.ts
  Modify: client/src/components/my-work/MyWorkRow.tsx
  Modify: client/src/components/my-work/MyWorkDetailSheet.tsx
  Test:   client/src/lib/workItemMutations.test.ts
  Test:   client/src/components/my-work/MyWorkDoneAction.test.tsx

Rule: Cross-unit server acceptance
  Create: server/src/routes/my-work.integration.test.ts            (created by: T9)

Rule: Cross-component client acceptance
  Create: client/src/pages/MyWorkPage.integration.test.tsx         (created by: T10)

Rule: Performance and observability
  Create: server/src/core/my-work-observability.ts                  (created by: T11)
  Create: server/src/core/my-work-observability.test.ts             (created by: T11)
  Create: server/src/routes/my-work.performance.integration.test.ts  (created by: T11)
  Create: client/src/pages/MyWorkPage.performance.test.tsx           (created by: T11)
  Modify: server/src/routes/my-work.ts

Rule: Existing read-only references used by packets
  Reference: server/src/routes/work-item-response.ts
  Reference: server/src/routes/workspaces.ts
  Reference: server/src/routes/helpers.ts
  Reference: server/src/routes/tracker-assignees.ts
  Reference: server/src/routes/card-assignees.ts
  Reference: server/src/core/board-card-status-change.ts
  Reference: server/src/core/column-status-map.ts
  Reference: server/src/core/column-status-reverse.ts
  Reference: server/src/routes/tracker-activity.ts
  Reference: client/src/lib/boardViewUtils.ts
  Reference: client/src/pages/TrackerPage.tsx
  Reference: client/src/pages/TrackerDetailPage.tsx
  Reference: client/src/pages/TrackerDetailPage.test.tsx
  Reference: client/src/components/tracker/TrackerRow.tsx
  Reference: client/src/context/BoardContext.tsx
  Reference: server/src/routes/work-item-unified.integration.test.ts
  Reference: server/src/routes/workspaceAccess.test.ts
  Reference: client/src/pages/TrackerPage.test.tsx
  Reference: server/src/core/work-item-latency.ts
```

---

## Pocket Packets

---

### Task 1: Add the My Work wire contract and Fuse.js dependency [prereq]

## OBJECTIVE

Define the client-facing My Work response/request contract and add the approved fuzzy-search dependency without implementing the page or server endpoint.

Files:

- Create: `client/src/types/myWork.ts`
- Create: `client/src/api/myWork.ts`
- Create: `client/src/api.my-work.test.ts`
- Modify: `client/src/types.ts`
- Modify: `client/src/api.ts`
- Modify: `client/package.json`
- Modify: `package-lock.json`

Steps:

1. Write failing test for: list request serializes supplied filters.
   Test file: `client/src/api.my-work.test.ts`
   Level: unit
   Test intent: Given fake fetch, when listMyWork receives scope/query/workspace/source/cursor/page size, then exact URL/query and typed response are observed.
   Exercise through: public api.listMyWork.
   Test doubles: fake fetch via configureRequestBoundaryForTests; do not mock API methods.
   Expected RED: listMyWork and its contract do not exist.

2. Run test — verify FAIL:
   `npm run test -- client/src/api.my-work.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

3. Implement minimal behavior:
   Add the list request type/method and response contract.

4. Run test — verify PASS:
   `npm run test -- client/src/api.my-work.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

5. Write failing test for: omitted optional filters are not serialized as invalid values.
   Test file: `client/src/api.my-work.test.ts`
   Level: unit
   Test intent: Given default Active scope only, when listMyWork runs, then undefined/empty workspace/source/cursor values are absent.
   Exercise through: public API method and captured URL.
   Test doubles: fake fetch; do not mock query construction.
   Expected RED: omission behavior is not implemented.

6. Run test — verify FAIL:
   `npm run test -- client/src/api.my-work.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

7. Implement minimal behavior:
   Implement optional query serialization and safe defaults.

8. Run test — verify PASS:
   `npm run test -- client/src/api.my-work.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

9. Write failing test for: detail and Mark done use composite identity/version.
   Test file: `client/src/api.my-work.test.ts`
   Level: unit
   Test intent: Given workspace/source/key/version, when detail and Mark done methods run, then composite identity and version/body use the correct paths.
   Exercise through: public API methods.
   Test doubles: fake fetch; do not mock response parsing.
   Expected RED: detail/Mark done methods do not exist.

10. Run test — verify FAIL:
   `npm run test -- client/src/api.my-work.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

11. Implement minimal behavior:
   Implement detail and Mark done contract methods.

12. Run test — verify PASS:
   `npm run test -- client/src/api.my-work.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

13. Write failing test for: API pass-through performs no authorization.
   Test file: `client/src/api.my-work.test.ts`
   Level: unit
   Test intent: Given an authorized server envelope, when the API resolves, then it forwards the response and makes no membership/assignment request.
   Exercise through: public API method and fetch call count.
   Test doubles: fake fetch only; do not mock API boundary.
   Expected RED: pass-through/no-discovery behavior is not explicit.

14. Run test — verify FAIL:
   `npm run test -- client/src/api.my-work.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

15. Implement minimal behavior:
   Preserve the server envelope and keep authorization out of the client contract layer.

16. Run test — verify PASS:
   `npm run test -- client/src/api.my-work.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

17. Refactor while green (bounded):
   Keep logic within the task's declared files, reuse existing helpers, and do not implement out-of-scope behavior. Re-run the task test command.

18. Commit:
   git add client/src/types/myWork.ts client/src/api/myWork.ts client/src/api.my-work.test.ts client/src/types.ts client/src/api.ts client/package.json package-lock.json
    git commit -m "feat(my-work): define client contract and search dependency"

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md` — Dependencies, Scope, and Acceptance Criteria for API contract and fuzzy search.
- `client/src/api.ts` — existing request boundary and façade composition.
- `client/src/types.ts` — existing central type registry.
- Fuse.js official docs — object keys, threshold, result limit, and bounded client dataset behavior.

## WHY THIS APPROACH

Complexity: standard
Justification: This is a prerequisite shared contract across the client API, page, and server response. It also isolates the new dependency and avoids parallel tasks inventing incompatible response shapes.

## SANDWICH CONTEXT

[CRITICAL: My Work must not make the client an authorization boundary; the server remains authoritative for membership and assignment.]
You are defining the contract for My Work in `camel-kanban`.
Spec: `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md`
Design decision: server-side personal rollup with global detail and source-aware writes.
Files in scope: the contract/API/dependency files listed above; no server query or page implementation.
Available after: none (prerequisite).
Architecture rule: preserve the existing API request boundary and use Fuse.js only for client ranking after authorized data is returned.
[RESTATE: My Work must not make the client an authorization boundary; the server remains authoritative for membership and assignment.]

## DELIVERABLE

Given a configured fake fetch boundary, when each My Work API method is called, then its URL, query, body, and typed result match the contract.
Given optional filters are omitted, when the list method is called, then it does not emit invalid empty query parameters.
[must-not] Given a client search query, when the API contract is used, then it must not imply client-side authorization or direct database access.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Domain API methods are composed into the existing façade without a duplicate request implementation.
- My Work response types carry workspace/source/composite identity and action availability/reason metadata.
- Fuse.js is installed only in the client workspace and lockfile is updated.
- API unit tests are written before implementation and pass.

Must-not-have:

- No server implementation in this prerequisite task.
- No page components, mutation behavior, or database schema changes.
- No direct API calls from future UI code outside the API/mutation boundaries.

Open question risks:

- All-scope fuzzy candidate behavior remains an explicit later assumption; do not hide it in this contract task.

Rollback note:

- Remove the additive client dependency/contract files; no data migration exists.

## STOP CONDITIONS

Done when: the API contract tests pass, the dependency lock is valid, and the commit exists.
Uncertain when: the response shape cannot represent source/workspace identity or action permissions without changing the approved spec.
Escalate when: a second request boundary or a server schema migration appears necessary.

---

### Task 2: Implement the server-side personal rollup and global detail read [depends: T1]

## OBJECTIVE

Add authenticated, set-based My Work list/detail reads across authorized workspaces, with assignee filtering, source/workspace metadata, per-workspace deduplication, status normalization inputs, and fail-closed detail reauthorization.

Files:

- Create: `server/src/routes/my-work-response.ts`
- Create: `server/src/routes/my-work.ts`
- Modify: `server/src/routes.ts`
- Test: `server/src/routes/my-work.test.ts`

Steps:

1. Write failing test for: authorized cross-workspace rollup.
   Test file: `server/src/routes/my-work.test.ts`
   Level: unit
   Test intent: Given Atlas/Orbit membership and assigned Board/Tracker rows, when Active rollup runs, then authorized rows carry workspace/source identity and appear once.
   Exercise through: personal list handler/service with fake DB executor.
   Test doubles: fake DB/membership/assignee loaders; do not mock merge logic.
   Expected RED: personal route/response module does not exist.

2. Run test — verify FAIL:
   `npm run test -- server/src/routes/my-work.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

3. Implement minimal behavior:
   Implement membership-scoped source query skeleton, workspace metadata, and response serialization.

4. Run test — verify PASS:
   `npm run test -- server/src/routes/my-work.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

5. Write failing test for: per-workspace dedup/composite identity.
   Test file: `server/src/routes/my-work.test.ts`
   Level: unit
   Test intent: Given duplicate joins, same-key card/tracker rows in Atlas, and same key in Orbit, when merge runs, then tracker-wins is Atlas-local and identities are unique.
   Exercise through: merge/serialization boundary.
   Test doubles: fake source rows/loaders; do not mock dedup.
   Expected RED: dedup/composite behavior is absent.

6. Run test — verify FAIL:
   `npm run test -- server/src/routes/my-work.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

7. Implement minimal behavior:
   Implement per-workspace dedup and batched hydration.

8. Run test — verify PASS:
   `npm run test -- server/src/routes/my-work.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

9. Write failing test for: unauthorized workspace exclusion.
   Test file: `server/src/routes/my-work.test.ts`
   Level: unit
   Test intent: Given Alice is not a Nebula member but an assigned Nebula row exists, when list runs, then no Nebula row or metadata is returned.
   Exercise through: personal authorization boundary.
   Test doubles: fake membership/source rows; do not mock authorization decision.
   Expected RED: unauthorized leakage is possible.

10. Run test — verify FAIL:
   `npm run test -- server/src/routes/my-work.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

11. Implement minimal behavior:
   Implement membership predicate and fail-closed exclusion.

12. Run test — verify PASS:
   `npm run test -- server/src/routes/my-work.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

13. Write failing test for: Active/All status normalization and Other fallback.
   Test file: `server/src/routes/my-work.test.ts`
   Level: unit
   Test intent: Given completed/canceled/backlog/started/unknown statuses, when Active/All runs, then terminal rows are excluded from Active and unknown remains Other in All.
   Exercise through: list response boundary.
   Test doubles: fake rows/status values; do not mock normalization.
   Expected RED: scope/category behavior is absent.

14. Run test — verify FAIL:
   `npm run test -- server/src/routes/my-work.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

15. Implement minimal behavior:
   Implement status category/slot normalization inputs and Active/All filtering.

16. Run test — verify PASS:
   `npm run test -- server/src/routes/my-work.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

17. Write failing test for: detail reauthorization and existing 404 contract.
   Test file: `server/src/routes/my-work.test.ts`
   Level: unit
   Test intent: Given access/assignment is revoked after list load, when detail runs, then HTTP 404 with existing not_found/Not found behavior returns no cached content.
   Exercise through: detail route factory.
   Test doubles: fake current authorization state; do not mock error mapping.
   Expected RED: stale detail returns content or wrong status/code.

18. Run test — verify FAIL:
   `npm run test -- server/src/routes/my-work.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

19. Implement minimal behavior:
   Implement detail reauthorization and exact existing 404/not_found mapping.

20. Run test — verify PASS:
   `npm run test -- server/src/routes/my-work.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

21. Write failing test for: All-scope search across terminal/Other statuses.
   Test file: `server/src/routes/my-work.test.ts`
   Level: unit
   Test intent: Given all status categories, when All q runs, then matching candidates from every category return.
   Exercise through: personal list service.
   Test doubles: fake DB rows/query predicates; do not mock query logic.
   Expected RED: All search is absent.

22. Run test — verify FAIL:
   `npm run test -- server/src/routes/my-work.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

23. Implement minimal behavior:
   Implement All query search predicates and candidate response.

24. Run test — verify PASS:
   `npm run test -- server/src/routes/my-work.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

25. Write failing test for: workspace/source filters.
   Test file: `server/src/routes/my-work.test.ts`
   Level: unit
   Test intent: Given matching Atlas/Orbit Board/Tracker rows, when workspace/source filters run, then only matching authorized rows return.
   Exercise through: personal list service.
   Test doubles: fake DB executor with captured predicates; do not mock filter logic.
   Expected RED: filter predicates are absent.

26. Run test — verify FAIL:
   `npm run test -- server/src/routes/my-work.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

27. Implement minimal behavior:
   Implement server-side workspace/source filters.

28. Run test — verify PASS:
   `npm run test -- server/src/routes/my-work.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

29. Write failing test for: cursor pagination.
   Test file: `server/src/routes/my-work.test.ts`
   Level: unit
   Test intent: Given ordered rows and page size, when cursor requests run, then pages have no duplicate/gap and next cursor is deterministic.
   Exercise through: personal list service.
   Test doubles: fake DB executor with captured order/limit predicates; do not mock pagination.
   Expected RED: cursor behavior is absent.

30. Run test — verify FAIL:
   `npm run test -- server/src/routes/my-work.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

31. Implement minimal behavior:
   Implement cursor encoding/decoding and deterministic ordering.

32. Run test — verify PASS:
   `npm run test -- server/src/routes/my-work.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

33. Write failing test for: transient list failure classification.
   Test file: `server/src/routes/my-work.test.ts`
   Level: unit
   Test intent: Given injected query dependency throws transient error, when list runs, then retryable classification returns no partial payload.
   Exercise through: route factory dependency seam.
   Test doubles: injected failing query dependency; do not mock error mapping.
   Expected RED: failure seam/classification is absent.

34. Run test — verify FAIL:
   `npm run test -- server/src/routes/my-work.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

35. Implement minimal behavior:
   Implement route dependency injection and exact transient error mapping.

36. Run test — verify PASS:
   `npm run test -- server/src/routes/my-work.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

37. Refactor while green (bounded):
   Keep logic within the task's declared files, reuse existing helpers, and do not implement out-of-scope behavior. Re-run the task test command.

38. Commit:
   git add server/src/routes/my-work-response.ts server/src/routes/my-work.ts server/src/routes.ts server/src/routes/my-work.test.ts
    git commit -m "feat(my-work): add authorized personal rollup"

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md` — Authorized rollup, Active/All, detail, identity, and failure criteria.
- `server/src/routes/work-item-response.ts` — existing dual-table serializers and batch hydration.
- `server/src/routes/workspaces.ts` and `server/src/routes/helpers.ts` — membership patterns.
- `server/src/routes/tracker-assignees.ts`, `server/src/routes/card-assignees.ts` — assignee query helpers.
- `server/src/routes.ts` — authenticated route mount boundary.
- Kysely docs — additive WHERE clauses, reusable type-safe query expressions, and transaction constraints.

## WHY THIS APPROACH

Complexity: deep
Justification: This is the primary security and performance boundary. It crosses both physical work-item tables, membership authorization, hydration, deduplication, cursor/search semantics, and global detail reauthorization.

## SANDWICH CONTEXT

[CRITICAL: The server must authorize membership and assignment before returning any My Work data; client filtering is never a security boundary.]
You are implementing the personal read boundary for My Work.
Spec: `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md`
Design decision: server-side personal rollup, not client fan-out or a persistent projection.
Files in scope: `server/src/routes/my-work-response.ts`, `server/src/routes/my-work.ts`, `server/src/routes.ts`, and their unit test.
Available after: T1.
Architecture rule: use set-based per-source queries and batch hydration; preserve per-workspace tracker-wins dedup and soft-delete filters.
[RESTATE: The server must authorize membership and assignment before returning any My Work data; client filtering is never a security boundary.]

## DELIVERABLE

Given authorized Atlas/Orbit membership and assigned Board/Tracker rows, when the personal list is requested, then authorized rows appear exactly once with workspace/source identity.
Given a same-key card/tracker collision, when the list is built, then tracker wins only inside that workspace.
Given detail access is revoked after list load, when detail is requested, then an unavailable response contains no cached task content.
[must-not] Given a workspace is unauthorized, when the list runs, then no workspace/task metadata leaks.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- No N+1 call to the existing per-workspace list endpoint.
- Membership, assignee, soft-delete, identity, and dedup behavior are tested.
- List/detail error semantics distinguish unauthorized access from transient server failure.
- All queries use Kysely parameterized expressions and existing DB types.

Must-not-have:

- No client-side authorization reliance.
- No `work_items` migration or changes to existing Board/Tracker route semantics.
- No modifications to active-workspace SSE.

Open question risks:

- All-scope fuzzy candidate strategy remains server-paginated and may require later server search indexing.

Rollback note:

- Remove the additive route mount and new response/route files; existing workspace-scoped endpoints remain intact.

## STOP CONDITIONS

Done when: route/unit tests pass, personal reads are mounted behind auth, and no per-workspace fan-out exists.
Uncertain when: the existing serializers cannot represent workspace metadata without changing legacy response contracts.
Escalate when: membership/assignment authorization requires a schema migration or route behavior changes outside My Work.

---

### Task 3: Extract and implement the source-aware Mark done command [depends: T2] [test-risk]

## OBJECTIVE

Provide the only V1 My Work mutation: membership/assignment-rechecked, source-aware, version-safe, canonical-target Mark done with idempotent retries and exactly-once activity behavior.

Files:

- Create: `server/src/core/tracker-item-status-change.ts`
- Create: `server/src/core/my-work-mark-done.ts`
- Create: `server/src/core/tracker-item-status-change.test.ts`
- Create: `server/src/core/my-work-mark-done.test.ts`
- Modify: `server/src/routes/tracker-items.ts`
- Modify: `server/src/routes/my-work.ts`

Steps:

1. Write failing test for: Tracker status-change extraction and canonical done target.
   Test file: `server/src/core/tracker-item-status-change.test.ts`
   Level: unit
   Test intent: Given a Tracker item and multiple status rows, when extracted service marks done, then position/id target selection, one update, and one activity occur.
   Exercise through: exported status-change service.
   Test doubles: chainable Kysely executor/activity recorder; do not mock resolver.
   Expected RED: extracted service does not exist.

2. Run test — verify FAIL:
   `npm run test -- server/src/core/tracker-item-status-change.test.ts server/src/core/my-work-mark-done.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

3. Implement minimal behavior:
   Extract the Tracker status mutation primitive and deterministic target selection.

4. Run test — verify PASS:
   `npm run test -- server/src/core/tracker-item-status-change.test.ts server/src/core/my-work-mark-done.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

5. Write failing test for: Board Mark done success and HTTP success mapping.
   Test file: `server/src/core/my-work-mark-done.test.ts`
   Level: unit
   Test intent: Given authorized Board item and valid is_done mapping, when Mark done runs, then success result, Board change, and one card activity occur.
   Exercise through: command service with Board primitive.
   Test doubles: fake transaction/Board service/activity recorder; do not mock command.
   Expected RED: command service does not exist.

6. Run test — verify FAIL:
   `npm run test -- server/src/core/tracker-item-status-change.test.ts server/src/core/my-work-mark-done.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

7. Implement minimal behavior:
   Implement Board command delegation and success result mapping.

8. Run test — verify PASS:
   `npm run test -- server/src/core/tracker-item-status-change.test.ts server/src/core/my-work-mark-done.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

9. Write failing test for: Tracker Mark done success and HTTP success mapping.
   Test file: `server/src/core/my-work-mark-done.test.ts`
   Level: unit
   Test intent: Given authorized Tracker item and slot=done, when Mark done runs, then success result, Tracker-only change, and one tracker activity occur.
   Exercise through: command service with Tracker primitive.
   Test doubles: fake transaction/Tracker service/activity recorder; do not mock source selection.
   Expected RED: Tracker command behavior is absent.

10. Run test — verify FAIL:
   `npm run test -- server/src/core/tracker-item-status-change.test.ts server/src/core/my-work-mark-done.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

11. Implement minimal behavior:
   Implement Tracker command delegation and success result mapping.

12. Run test — verify PASS:
   `npm run test -- server/src/core/tracker-item-status-change.test.ts server/src/core/my-work-mark-done.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

13. Write failing test for: membership or assignment revocation returns 404/not_found.
   Test file: `server/src/core/my-work-mark-done.test.ts`
   Level: unit
   Test intent: Given membership or assignment is revoked before Mark done, when the command runs, then HTTP 404 with existing `not_found`/`Not found` behavior returns and no source/activity write occurs.
   Exercise through: command authorization boundary.
   Test doubles: membership/assignment dependency returning revoked and fake transaction; do not mock mapping.
   Expected RED: revoked mutation behavior is not covered.

14. Run test — verify FAIL:
   `npm run test -- server/src/core/tracker-item-status-change.test.ts server/src/core/my-work-mark-done.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

15. Implement minimal behavior:
   Recheck membership and assignment using the existing route authorization contract; revoked state returns 404/not_found without introducing a role policy.

16. Run test — verify PASS:
   `npm run test -- server/src/core/tracker-item-status-change.test.ts server/src/core/my-work-mark-done.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

17. Write failing test for: missing mapping returns 409 status_column_unmappable.
   Test file: `server/src/core/my-work-mark-done.test.ts`
   Level: unit
   Test intent: Given no valid Board/Tracker done mapping, when Mark done runs, then HTTP 409/status_column_unmappable semantics return with no source/activity write.
   Exercise through: command mapping boundary.
   Test doubles: fake transaction with missing mapping; do not mock mapping decision.
   Expected RED: mapping contract is not covered.

18. Run test — verify FAIL:
   `npm run test -- server/src/core/tracker-item-status-change.test.ts server/src/core/my-work-mark-done.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

19. Implement minimal behavior:
   Map missing done targets to existing status_column_unmappable behavior.

20. Run test — verify PASS:
   `npm run test -- server/src/core/tracker-item-status-change.test.ts server/src/core/my-work-mark-done.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

21. Write failing test for: Board stale version returns 409 version_conflict.
   Test file: `server/src/core/my-work-mark-done.test.ts`
   Level: unit
   Test intent: Given stale Board version, when Mark done runs, then HTTP 409/version_conflict returns with no activity.
   Exercise through: Board command primitive.
   Test doubles: fake Board service returning conflict; do not mock command handling.
   Expected RED: Board conflict handling is not covered.

22. Run test — verify FAIL:
   `npm run test -- server/src/core/tracker-item-status-change.test.ts server/src/core/my-work-mark-done.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

23. Implement minimal behavior:
   Preserve Board conflict response mapping.

24. Run test — verify PASS:
   `npm run test -- server/src/core/tracker-item-status-change.test.ts server/src/core/my-work-mark-done.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

25. Write failing test for: Tracker stale version returns 409 version_conflict and no card write.
   Test file: `server/src/core/my-work-mark-done.test.ts`
   Level: unit
   Test intent: Given stale Tracker version, when Mark done runs, then HTTP 409/version_conflict returns with no activity and no cards access.
   Exercise through: Tracker command primitive.
   Test doubles: fake Tracker service returning conflict; do not mock source handling.
   Expected RED: Tracker conflict handling is not covered.

26. Run test — verify FAIL:
   `npm run test -- server/src/core/tracker-item-status-change.test.ts server/src/core/my-work-mark-done.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

27. Implement minimal behavior:
   Preserve Tracker conflict response and source boundary.

28. Run test — verify PASS:
   `npm run test -- server/src/core/tracker-item-status-change.test.ts server/src/core/my-work-mark-done.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

29. Write failing test for: idempotent retry has one activity.
   Test file: `server/src/core/my-work-mark-done.test.ts`
   Level: unit
   Test intent: Given source already at canonical done target, when Mark done retries, then existing success returns without duplicate activity.
   Exercise through: command service.
   Test doubles: fake transaction showing canonical target; do not mock idempotency decision.
   Expected RED: idempotency behavior is not covered.

30. Run test — verify FAIL:
   `npm run test -- server/src/core/tracker-item-status-change.test.ts server/src/core/my-work-mark-done.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

31. Implement minimal behavior:
   Implement already-done short-circuit.

32. Run test — verify PASS:
   `npm run test -- server/src/core/tracker-item-status-change.test.ts server/src/core/my-work-mark-done.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

33. Write failing test for: Tracker command never writes cards.
   Test file: `server/src/core/my-work-mark-done.test.ts`
   Level: unit
   Test intent: Given Tracker item, when Mark done runs, then no cards query/update is made.
   Exercise through: command service with query-table spy.
   Test doubles: fake transaction recording table access; do not mock source selection.
   Expected RED: source-table invariant is not explicit.

34. Run test — verify FAIL:
   `npm run test -- server/src/core/tracker-item-status-change.test.ts server/src/core/my-work-mark-done.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

35. Implement minimal behavior:
   Keep Tracker command source-specific.

36. Run test — verify PASS:
   `npm run test -- server/src/core/tracker-item-status-change.test.ts server/src/core/my-work-mark-done.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

37. Write failing test for: mapping removal race returns 409 status_column_unmappable without partial write.
   Test file: `server/src/core/my-work-mark-done.test.ts`
   Level: unit
   Test intent: Given mapping existed at page load but is removed before transaction resolves, when Mark done runs, then HTTP 409/status_column_unmappable returns with no source/activity write.
   Exercise through: command transaction boundary.
   Test doubles: fake transaction whose mapping changes; do not mock rollback logic.
   Expected RED: mapping-race behavior is absent.

38. Run test — verify FAIL:
   `npm run test -- server/src/core/tracker-item-status-change.test.ts server/src/core/my-work-mark-done.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

39. Implement minimal behavior:
   Recheck mappings atomically before any source write.

40. Run test — verify PASS:
   `npm run test -- server/src/core/tracker-item-status-change.test.ts server/src/core/my-work-mark-done.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

41. Refactor while green (bounded):
   Keep logic within the task's declared files, reuse existing helpers, and do not implement out-of-scope behavior. Re-run the task test command.

42. Commit:
   git add server/src/core/tracker-item-status-change.ts server/src/core/my-work-mark-done.ts server/src/core/tracker-item-status-change.test.ts server/src/core/my-work-mark-done.test.ts server/src/routes/tracker-items.ts server/src/routes/my-work.ts
    git commit -m "feat(my-work): add source-aware mark done"

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md` — Mark done rules, membership/assignment reauthorization, mapping, conflict, retry, and activity criteria.
- `server/src/core/board-card-status-change.ts` — existing Board status/column/WIP/activity transaction.
- `server/src/core/column-status-map.ts` and `column-status-reverse.ts` — existing Board mapping.
- `server/src/routes/tracker-items.ts` — inline Tracker status mutation to extract without behavior drift.
- `server/src/routes/tracker-activity.ts` — Tracker activity contract.
- Existing Board status-change tests — chainable Kysely test-double pattern.

## WHY THIS APPROACH

Complexity: deep
Justification: Mark done crosses authorization, two physical sources, version conflicts, status mappings, activity logging, and uncertain-response idempotency. The extraction prevents a second Tracker mutation implementation.

## SANDWICH CONTEXT

[CRITICAL: Mark done must route through source-specific transactional mutation primitives and must not bypass version/activity or membership/assignment reauthorization rules.]
You are implementing the bounded My Work mutation for `camel-kanban`.
Spec: `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md`
Design decision: Mark done is the only V1 write; full editing and bulk actions remain out of scope.
Files in scope: the listed core services, My Work route, Tracker extraction, and their tests.
Available after: T2.
Architecture rule: preserve `recordActivity`/`recordTrackerActivity`, optimistic version conflicts, and existing Board/Tracker mappings.
[RESTATE: Mark done must route through source-specific transactional mutation primitives and must not bypass version/activity or membership/assignment reauthorization rules.]

## DELIVERABLE

Given an authorized assignee with a valid Board or Tracker done target, when Mark done is requested, then the correct source changes and exactly one activity is recorded.
Given stale version, missing mapping, revoked membership, or removed assignment, when Mark done is requested, then no partial write occurs and the existing specific failure is returned.
Given the source is already at the canonical done target, when the command is retried, then it succeeds idempotently without duplicate activity.
[must-not] Given a tracker item, when Mark done runs, then it must not write the `cards` table.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Existing Tracker write behavior remains green after extraction.
- Board and Tracker use their correct source tables and activity streams.
- Permission, mapping, version, idempotency, and no-partial-write behavior are tested.
- Route tests use the existing membership/assignment reauthorization boundary rather than trusting UI flags.

Must-not-have:

- No generic cross-source table write.
- No duplicate Tracker status mutation implementation.
- No bulk edit or reassignment behavior.

Open question risks:

- Membership/assignment state may change between list and mutation → enforce the existing 404/not_found route contract at mutation time.

Rollback note:

- Disable the My Work Mark done action/route; existing Board/Tracker mutation paths remain available.

## STOP CONDITIONS

Done when: source unit tests and existing mutation regressions pass, and the command is mounted behind authenticated My Work routes.
Uncertain when: idempotent retry cannot distinguish already-completed state from a stale conflicting update.
Escalate when: implementing the command requires changing physical schema or weakening existing mutation authorization.

---

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
   `npm run test -- client/src/lib/myWorkUtils.test.ts client/src/lib/myWorkSearch.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

3. Implement minimal behavior:
   Implement status normalization/filtering.

4. Run test — verify PASS:
   `npm run test -- client/src/lib/myWorkUtils.test.ts client/src/lib/myWorkSearch.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

5. Write failing test for: workspace-timezone overdue ordering and ties.
   Test file: `client/src/lib/myWorkUtils.test.ts`
   Level: unit
   Test intent: Given workspace-local day boundaries and equal tie values, when ordering runs, then overdue/tie behavior is deterministic.
   Exercise through: pure ordering/date functions.
   Test doubles: fake clock/time values; do not mock Intl/date behavior.
   Expected RED: timezone/tie behavior is absent.

6. Run test — verify FAIL:
   `npm run test -- client/src/lib/myWorkUtils.test.ts client/src/lib/myWorkSearch.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

7. Implement minimal behavior:
   Implement timezone-aware overdue and stable tie-breaker.

8. Run test — verify PASS:
   `npm run test -- client/src/lib/myWorkUtils.test.ts client/src/lib/myWorkSearch.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

9. Write failing test for: 50-item pagination and URL state.
   Test file: `client/src/lib/myWorkUtils.test.ts`
   Level: unit
   Test intent: Given 73 active items and scope/filter/page query values, when helpers run, then pages contain 50/23 and invalid query values use safe defaults.
   Exercise through: pure pagination/URL helpers.
   Test doubles: plain fixtures and URLSearchParams; do not mock helpers.
   Expected RED: pagination/view-state helpers are absent.

10. Run test — verify FAIL:
   `npm run test -- client/src/lib/myWorkUtils.test.ts client/src/lib/myWorkSearch.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

11. Implement minimal behavior:
   Implement pagination and URL-state helpers.

12. Run test — verify PASS:
   `npm run test -- client/src/lib/myWorkUtils.test.ts client/src/lib/myWorkSearch.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

13. Write failing test for: Fuse keys and typo ranking.
   Test file: `client/src/lib/myWorkSearch.test.ts`
   Level: unit
   Test intent: Given key/title/description values, when “imgae uplod” is searched, then Image upload retry ranks.
   Exercise through: Fuse search helper with real Fuse.js.
   Test doubles: plain fixtures; do not mock Fuse.js.
   Expected RED: search helper/configuration does not exist.

14. Run test — verify FAIL:
   `npm run test -- client/src/lib/myWorkUtils.test.ts client/src/lib/myWorkSearch.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

15. Implement minimal behavior:
   Implement explicit Fuse keys/threshold.

16. Run test — verify PASS:
   `npm run test -- client/src/lib/myWorkUtils.test.ts client/src/lib/myWorkSearch.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

17. Write failing test for: Fuse result limit and All candidate window.
   Test file: `client/src/lib/myWorkSearch.test.ts`
   Level: unit
   Test intent: Given candidate items and a limit, when search runs, then result limit/order are deterministic and All ranks only the provided candidate window.
   Exercise through: Fuse candidate helper.
   Test doubles: plain fixtures; do not mock Fuse.js.
   Expected RED: limit/candidate behavior is absent.

18. Run test — verify FAIL:
   `npm run test -- client/src/lib/myWorkUtils.test.ts client/src/lib/myWorkSearch.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

19. Implement minimal behavior:
   Implement bounded result limit and candidate-window path.

20. Run test — verify PASS:
   `npm run test -- client/src/lib/myWorkUtils.test.ts client/src/lib/myWorkSearch.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

21. Write failing test for: search/filter must not discover unauthorized data.
   Test file: `client/src/lib/myWorkSearch.test.ts`
   Level: unit
   Test intent: Given only server-provided items, when search/filter runs, then no fetch/membership discovery/authorization decision occurs.
   Exercise through: pure search helper.
   Test doubles: plain input list and fetch spy; do not mock search logic.
   Expected RED: no-discovery invariant is absent.

22. Run test — verify FAIL:
   `npm run test -- client/src/lib/myWorkUtils.test.ts client/src/lib/myWorkSearch.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

23. Implement minimal behavior:
   Keep helpers pure and response-bounded.

24. Run test — verify PASS:
   `npm run test -- client/src/lib/myWorkUtils.test.ts client/src/lib/myWorkSearch.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

25. Refactor while green (bounded):
   Keep logic within the task's declared files, reuse existing helpers, and do not implement out-of-scope behavior. Re-run the task test command.

26. Commit:
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

---

### Task 5: Add global My Work navigation [depends: T1]

## OBJECTIVE

Expose My Work as a global authenticated navigation item above workspace/mode-specific navigation on desktop and mobile, with correct active state and existing sidebar collapse behavior.

Files:

- Modify: `client/src/layout/sidebar/navItems.ts`
- Modify: `client/src/layout/sidebar/Sidebar.tsx`
- Modify: `client/src/layout/sidebar/MobileNav.tsx`
- Create: `client/src/layout/sidebar/myWorkNavigation.test.tsx`

Steps:

1. Write failing test for: expanded desktop global navigation.
   Test file: `client/src/layout/sidebar/myWorkNavigation.test.tsx`
   Level: component
   Test intent: Given expanded desktop routes /my-work, /board, /tracker, when navigation renders, then global My Work link and active state are correct.
   Exercise through: Sidebar with MemoryRouter.
   Test doubles: fake contexts/history; do not mock Sidebar.
   Expected RED: global link does not exist.

2. Run test — verify FAIL:
   `npm run test -- client/src/layout/sidebar/myWorkNavigation.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

3. Implement minimal behavior:
   Add global nav definition/rendering.

4. Run test — verify PASS:
   `npm run test -- client/src/layout/sidebar/myWorkNavigation.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

5. Write failing test for: collapsed desktop accessible navigation.
   Test file: `client/src/layout/sidebar/myWorkNavigation.test.tsx`
   Level: component
   Test intent: Given collapsed sidebar, when My Work renders/clicks, then accessible title/label and route navigation remain correct.
   Exercise through: collapsed Sidebar.
   Test doubles: fake contexts/history; do not mock link behavior.
   Expected RED: collapsed behavior is absent.

6. Run test — verify FAIL:
   `npm run test -- client/src/layout/sidebar/myWorkNavigation.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

7. Implement minimal behavior:
   Preserve collapsed global item accessibility.

8. Run test — verify PASS:
   `npm run test -- client/src/layout/sidebar/myWorkNavigation.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

9. Write failing test for: mobile navigation placement/close.
   Test file: `client/src/layout/sidebar/myWorkNavigation.test.tsx`
   Level: component
   Test intent: Given mobile nav open, when My Work is clicked, then it is outside mode lists, navigates, and closes menu.
   Exercise through: MobileNav.
   Test doubles: fake context/history; do not mock MobileNav.
   Expected RED: mobile behavior is absent.

10. Run test — verify FAIL:
   `npm run test -- client/src/layout/sidebar/myWorkNavigation.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

11. Implement minimal behavior:
   Add mobile global item and close behavior.

12. Run test — verify PASS:
   `npm run test -- client/src/layout/sidebar/myWorkNavigation.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

13. Refactor while green (bounded):
   Keep logic within the task's declared files, reuse existing helpers, and do not implement out-of-scope behavior. Re-run the task test command.

14. Commit:
   git add client/src/layout/sidebar/navItems.ts client/src/layout/sidebar/Sidebar.tsx client/src/layout/sidebar/MobileNav.tsx client/src/layout/sidebar/myWorkNavigation.test.tsx
    git commit -m "feat(my-work): add global navigation entry"

## REFERENCES LOADED

- Spec navigation and mobile criteria.
- `client/src/layout/sidebar/navItems.ts` — current mode grouping.
- `client/src/layout/sidebar/Sidebar.tsx` and `MobileNav.tsx` — desktop/mobile placement and accessibility classes.
- React Router docs for route link behavior.
- Lucide React docs for tree-shakable icon usage and accessible button/link props.

## WHY THIS APPROACH

Complexity: lightweight
Justification: Navigation is isolated from page data and can be verified independently before the route component exists.

## SANDWICH CONTEXT

[CRITICAL: My Work must remain a global navigation item and must not be placed inside the active-workspace switcher or mode-specific lists.]
You are implementing authenticated navigation for My Work.
Spec: `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md`
Design decision: global item above Kanban/Agent mode navigation.
Files in scope: `navItems.ts`, `Sidebar.tsx`, `MobileNav.tsx`, and the navigation test.
Available after: T1.
Architecture rule: preserve existing responsive/collapsed/focus behavior and route-driven active states.
[RESTATE: My Work must remain a global navigation item and must not be placed inside the active-workspace switcher or mode-specific lists.]

## DELIVERABLE

Given the authenticated sidebar/mobile navigation, when the user is on `/my-work`, then My Work is visible and active without changing mode state.
Given collapsed desktop or mobile navigation, when My Work is rendered/clicked, then accessible labels and close behavior remain correct.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Desktop expanded/collapsed and mobile tests pass.
- Global nav does not alter existing Board/Tracker/Agent grouping.
- Focus-visible labels and route active state remain accessible.

Must-not-have:

- No workspace switcher behavior changes.
- No page/API/data loading in navigation components.

Open question risks:

- Exact icon choice may be finalized during implementation using existing Lucide conventions; it must not change route behavior.

Rollback note:

- Remove the global item; existing navigation remains.

## STOP CONDITIONS

Done when: navigation tests pass for desktop, collapsed, mobile, and active route states.
Uncertain when: existing mode grouping cannot accommodate a global section without changing AppLayout contracts.
Escalate when: adding the item requires changing workspace selection state.

---

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
   `npm run test -- client/src/pages/MyWorkPage.test.tsx client/src/components/my-work/MyWorkRow.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

3. Implement minimal behavior:
   Implement route/page/toolbar/list loading.

4. Run test — verify PASS:
   `npm run test -- client/src/pages/MyWorkPage.test.tsx client/src/components/my-work/MyWorkRow.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

5. Write failing test for: transient whole-page error and retry.
   Test file: `client/src/pages/MyWorkPage.test.tsx`
   Level: component
   Test intent: Given transient list failure, when page renders/retry is clicked, then no partial list appears and complete request retries.
   Exercise through: page error/retry boundary.
   Test doubles: fake API reject then success; do not mock error UI.
   Expected RED: error/retry behavior is absent.

6. Run test — verify FAIL:
   `npm run test -- client/src/pages/MyWorkPage.test.tsx client/src/components/my-work/MyWorkRow.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

7. Implement minimal behavior:
   Implement fail-whole-page error and retry.

8. Run test — verify PASS:
   `npm run test -- client/src/pages/MyWorkPage.test.tsx client/src/components/my-work/MyWorkRow.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

9. Write failing test for: actionable Active empty state.
   Test file: `client/src/pages/MyWorkPage.test.tsx`
   Level: component
   Test intent: Given Active empty and All historical items, when Active renders, then actionable empty state and All control appear.
   Exercise through: page scope rendering.
   Test doubles: deterministic fixtures; do not mock empty decision.
   Expected RED: empty state is absent.

10. Run test — verify FAIL:
   `npm run test -- client/src/pages/MyWorkPage.test.tsx client/src/components/my-work/MyWorkRow.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

11. Implement minimal behavior:
   Implement Active empty state.

12. Run test — verify PASS:
   `npm run test -- client/src/pages/MyWorkPage.test.tsx client/src/components/my-work/MyWorkRow.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

13. Write failing test for: visibility refresh newest-request behavior.
   Test file: `client/src/pages/MyWorkPage.test.tsx`
   Level: component
   Test intent: Given page becomes visible after hidden, when refresh effects run, then newest request wins and stale response is discarded.
   Exercise through: page effect/visibility boundary.
   Test doubles: fake API sequence, visibility events, timers; do not mock reconciliation.
   Expected RED: visibility refresh is absent.

14. Run test — verify FAIL:
   `npm run test -- client/src/pages/MyWorkPage.test.tsx client/src/components/my-work/MyWorkRow.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

15. Implement minimal behavior:
   Implement visibility refresh and sequence guard.

16. Run test — verify PASS:
   `npm run test -- client/src/pages/MyWorkPage.test.tsx client/src/components/my-work/MyWorkRow.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

17. Write failing test for: expired session is not empty state.
   Test file: `client/src/pages/MyWorkPage.test.tsx`
   Level: component
   Test intent: Given API returns auth/session error, when page renders, then existing session error appears rather than empty state.
   Exercise through: page error mapping.
   Test doubles: fake auth error; do not mock error classification.
   Expected RED: auth distinction is absent.

18. Run test — verify FAIL:
   `npm run test -- client/src/pages/MyWorkPage.test.tsx client/src/components/my-work/MyWorkRow.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

19. Implement minimal behavior:
   Map auth/session errors explicitly.

20. Run test — verify PASS:
   `npm run test -- client/src/pages/MyWorkPage.test.tsx client/src/components/my-work/MyWorkRow.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

21. Write failing test for: manual Refresh keeps view state.
   Test file: `client/src/pages/MyWorkPage.test.tsx`
   Level: component
   Test intent: Given rendered list, when toolbar Refresh is activated, then a new personal request runs and existing view state remains.
   Exercise through: toolbar Refresh control.
   Test doubles: fake API response sequence; do not mock refresh transition.
   Expected RED: manual Refresh is absent.

22. Run test — verify FAIL:
   `npm run test -- client/src/pages/MyWorkPage.test.tsx client/src/components/my-work/MyWorkRow.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

23. Implement minimal behavior:
   Implement explicit Refresh action.

24. Run test — verify PASS:
   `npm run test -- client/src/pages/MyWorkPage.test.tsx client/src/components/my-work/MyWorkRow.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

25. Write failing test for: page-level ordering integration.
   Test file: `client/src/pages/MyWorkPage.test.tsx`
   Level: component
   Test intent: Given 73 active items with due ordering, when page renders, then helper-defined status/order appears in the rendered list.
   Exercise through: full page/list with real helpers.
   Test doubles: deterministic API fixture; do not mock derivation.
   Expected RED: page does not integrate ordering.

26. Run test — verify FAIL:
   `npm run test -- client/src/pages/MyWorkPage.test.tsx client/src/components/my-work/MyWorkRow.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

27. Implement minimal behavior:
   Wire real ordering/group helpers.

28. Run test — verify PASS:
   `npm run test -- client/src/pages/MyWorkPage.test.tsx client/src/components/my-work/MyWorkRow.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

29. Write failing test for: page-level 50/23 pagination.
   Test file: `client/src/pages/MyWorkPage.test.tsx`
   Level: component
   Test intent: Given 73 active items, when page changes from page 1 to page 2, then 50/23 rows appear with no duplicates/gaps.
   Exercise through: full page/list pagination.
   Test doubles: deterministic fixture; do not mock pagination.
   Expected RED: page pagination is absent.

30. Run test — verify FAIL:
   `npm run test -- client/src/pages/MyWorkPage.test.tsx client/src/components/my-work/MyWorkRow.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

31. Implement minimal behavior:
   Wire rendered pagination and URL page state.

32. Run test — verify PASS:
   `npm run test -- client/src/pages/MyWorkPage.test.tsx client/src/components/my-work/MyWorkRow.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

33. Write failing test for: responsive row content.
   Test file: `client/src/components/my-work/MyWorkRow.test.tsx`
   Level: component
   Test intent: Given long Board/Tracker metadata at compact/mobile props, when row renders, then key/title/status/workspace/source/due/action remain usable.
   Exercise through: MyWorkRow public props.
   Test doubles: plain fixtures/viewport class assertions; do not mock row.
   Expected RED: row component does not exist.

34. Run test — verify FAIL:
   `npm run test -- client/src/pages/MyWorkPage.test.tsx client/src/components/my-work/MyWorkRow.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

35. Implement minimal behavior:
   Implement responsive row/list/toolbar components.

36. Run test — verify PASS:
   `npm run test -- client/src/pages/MyWorkPage.test.tsx client/src/components/my-work/MyWorkRow.test.tsx`
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
- `client/src/types/myWork.ts`, `client/src/api/myWork.ts`, and helpers from T1/T4.
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

---

### Task 7: Add global detail sheet and explicit source navigation [depends: T6]

## OBJECTIVE

Provide URL-addressable global read/detail behavior that reauthorizes access, never changes the active workspace on row selection, and uses existing workspace/focus/unsaved-edit guards for explicit Board/Tracker navigation.

Files:

- Create: `client/src/components/my-work/MyWorkDetailSheet.tsx`
- Create: `client/src/lib/myWorkNavigation.ts`
- Modify: `client/src/pages/MyWorkPage.tsx`
- Create: `client/src/components/my-work/MyWorkDetailSheet.test.tsx`

Steps:

1. Write failing test for: global detail preserves active workspace and URL state.
   Test file: `client/src/components/my-work/MyWorkDetailSheet.test.tsx`
   Level: component
   Test intent: Given Orbit active and AT-17 in Atlas, when detail opens/closes, then Atlas context is shown, Orbit remains active, and filters/page restore.
   Exercise through: MemoryRouter/detail/BoardContext seam.
   Test doubles: fake detail response/context; do not mock detail/URL helper.
   Expected RED: detail sheet does not exist.

2. Run test — verify FAIL:
   `npm run test -- client/src/components/my-work/MyWorkDetailSheet.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

3. Implement minimal behavior:
   Implement detail sheet and route-state helper.

4. Run test — verify PASS:
   `npm run test -- client/src/components/my-work/MyWorkDetailSheet.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

5. Write failing test for: stale detail reauthorization hides cached content.
   Test file: `client/src/components/my-work/MyWorkDetailSheet.test.tsx`
   Level: component/integration
   Test intent: Given access revoked after list load, when detail is requested, then unavailable appears without cached content/source action.
   Exercise through: detail API error boundary.
   Test doubles: fake unauthorized detail response; do not mock unavailable UI.
   Expected RED: reauthorization behavior is absent.

6. Run test — verify FAIL:
   `npm run test -- client/src/components/my-work/MyWorkDetailSheet.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

7. Implement minimal behavior:
   Implement unavailable/error mapping.

8. Run test — verify PASS:
   `npm run test -- client/src/components/my-work/MyWorkDetailSheet.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

9. Write failing test for: explicit source navigation uses existing guard.
   Test file: `client/src/components/my-work/MyWorkDetailSheet.test.tsx`
   Level: component/integration
   Test intent: Given non-active source item, when Open in Board/Tracker is selected with allowed/blocked/canceled guard, then only allowed transition navigates and blocked state is preserved.
   Exercise through: detail action/BoardContext guard.
   Test doubles: fake guard/history; do not mock navigation decision.
   Expected RED: source guard behavior is absent.

10. Run test — verify FAIL:
   `npm run test -- client/src/components/my-work/MyWorkDetailSheet.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

11. Implement minimal behavior:
   Implement explicit source transition and page wiring.

12. Run test — verify PASS:
   `npm run test -- client/src/components/my-work/MyWorkDetailSheet.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

13. Refactor while green (bounded):
   Keep logic within the task's declared files, reuse existing helpers, and do not implement out-of-scope behavior. Re-run the task test command.

14. Commit:
   git add client/src/components/my-work/MyWorkDetailSheet.tsx client/src/lib/myWorkNavigation.ts client/src/pages/MyWorkPage.tsx client/src/components/my-work/MyWorkDetailSheet.test.tsx
    git commit -m "feat(my-work): add global detail navigation"

## REFERENCES LOADED

- Spec global detail, reauthorization, source navigation, and guard scenarios.
- `client/src/pages/TrackerDetailPage.tsx` — existing detail loading and event/error conventions.
- `client/src/context/BoardContext.tsx` — workspace switch/focus/unsaved-edit guard callbacks.
- `client/src/App.tsx` and React Router docs — route/search-state behavior.

## WHY THIS APPROACH

Complexity: standard
Justification: Detail and source navigation have different authorization and transition semantics from list rendering; isolating them prevents silent workspace changes.

## SANDWICH CONTEXT

[CRITICAL: Selecting a row must never silently change activeWorkspaceId; only explicit source navigation may invoke existing workspace guards.]
You are implementing global read detail for My Work.
Spec: `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md`
Design decision: global detail first, explicit guarded source navigation second.
Files in scope: detail sheet, navigation helper, My Work page wiring, and the detail test.
Available after: T6.
Architecture rule: reauthorize detail on the server and reuse existing focus/unsaved-edit guards.
[RESTATE: Selecting a row must never silently change activeWorkspaceId; only explicit source navigation may invoke existing workspace guards.]

## DELIVERABLE

Given a non-active workspace item, when its row is selected, then global detail opens without changing the active workspace.
Given access is revoked before detail, when detail is requested, then unavailable is shown without cached content.
Given source navigation is blocked, when the user cancels, then My Work state remains unchanged.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Detail tests cover global read, reauthorization failure, URL restoration, successful guarded transition, and blocked transition.
- Workspace/source identity is visible before navigation.

Must-not-have:

- No automatic workspace switch on row click.
- No detail cache rendered after server reauthorization failure.
- No direct mutation API calls.

Open question risks:

- Exact nested route versus query detail state may change route wiring without changing behavior.

Rollback note:

- Remove the detail sheet and route state; the list can remain read-only.

## STOP CONDITIONS

Done when: detail/guard tests pass and no row selection mutates activeWorkspaceId.
Uncertain when: existing guard callbacks cannot be safely reused from a global page.
Escalate when: implementing global detail requires weakening workspace authorization.

---

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
   `npm run test -- client/src/lib/workItemMutations.test.ts client/src/components/my-work/MyWorkDoneAction.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

3. Implement minimal behavior:
   Implement mutation router.

4. Run test — verify PASS:
   `npm run test -- client/src/lib/workItemMutations.test.ts client/src/components/my-work/MyWorkDoneAction.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

5. Write failing test for: mapping/terminal/pending disabled action.
   Test file: `client/src/components/my-work/MyWorkDoneAction.test.tsx`
   Level: component
   Test intent: Given canMarkDone=false because mapping is missing, item is terminal, or a mutation is pending, when action renders, then it is disabled with the specific reason and makes no mutation call.
   Exercise through: MyWorkDoneAction.
   Test doubles: fake mutation callback; do not mock disabled rendering.
   Expected RED: action component does not exist.

6. Run test — verify FAIL:
   `npm run test -- client/src/lib/workItemMutations.test.ts client/src/components/my-work/MyWorkDoneAction.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

7. Implement minimal behavior:
   Implement disabled action state.

8. Run test — verify PASS:
   `npm run test -- client/src/lib/workItemMutations.test.ts client/src/components/my-work/MyWorkDoneAction.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

9. Write failing test for: successful Mark done removes Active item.
   Test file: `client/src/components/my-work/MyWorkDoneAction.test.tsx`
   Level: component
   Test intent: Given eligible item and success, when clicked, then Active removes it, All retains Done, and success feedback appears.
   Exercise through: action/page callback.
   Test doubles: fake mutation success/page callback; do not mock state transition.
   Expected RED: success wiring is absent.

10. Run test — verify FAIL:
   `npm run test -- client/src/lib/workItemMutations.test.ts client/src/components/my-work/MyWorkDoneAction.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

11. Implement minimal behavior:
   Implement success reconciliation and row/detail slots.

12. Run test — verify PASS:
   `npm run test -- client/src/lib/workItemMutations.test.ts client/src/components/my-work/MyWorkDoneAction.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

13. Write failing test for: conflict/transient failure rollback.
   Test file: `client/src/components/my-work/MyWorkDoneAction.test.tsx`
   Level: component
   Test intent: Given conflict/transient failure, when action resolves, then optimistic state rolls back, refresh runs, and correct warning/error appears.
   Exercise through: action/page callback.
   Test doubles: fake conflict/error/refresh; do not mock rollback.
   Expected RED: recovery behavior is absent.

14. Run test — verify FAIL:
   `npm run test -- client/src/lib/workItemMutations.test.ts client/src/components/my-work/MyWorkDoneAction.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

15. Implement minimal behavior:
   Implement error mapping and rollback/refresh.

16. Run test — verify PASS:
   `npm run test -- client/src/lib/workItemMutations.test.ts client/src/components/my-work/MyWorkDoneAction.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

17. Write failing test for: Mark done race and direct-API must-not.
   Test file: `client/src/components/my-work/MyWorkDoneAction.test.tsx`
   Level: component/integration
   Test intent: Given Mark done succeeds while an older refresh is in flight, when the old snapshot arrives, then item is not reinserted and components never call updateCard/updateTrackerItem directly.
   Exercise through: row/detail/page collaboration.
   Test doubles: fake mutation/refresh responses and forbidden-call spies; do not mock reconciliation.
   Expected RED: race/must-not behavior is absent.

18. Run test — verify FAIL:
   `npm run test -- client/src/lib/workItemMutations.test.ts client/src/components/my-work/MyWorkDoneAction.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

19. Implement minimal behavior:
   Implement newest mutation precedence and keep all writes in workItemMutations.ts.

20. Run test — verify PASS:
   `npm run test -- client/src/lib/workItemMutations.test.ts client/src/components/my-work/MyWorkDoneAction.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

21. Refactor while green (bounded):
   Keep logic within the task's declared files, reuse existing helpers, and do not implement out-of-scope behavior. Re-run the task test command.

22. Commit:
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

---

### Task 9: Verify cross-unit server acceptance [depends: T2, T3] [test-risk]

## OBJECTIVE

Exercise the authenticated API boundary against the migrated test database so server authorization, cross-workspace read merge, detail reauthorization, source-aware Mark done, activity exactly-once, and failure semantics are verified together.

Files:

- Create: `server/src/routes/my-work.integration.test.ts`

Steps:

1. Write failing test for: authorized cross-workspace rollup and composite identity.
   Test file: `server/src/routes/my-work.integration.test.ts`
   Level: integration
   Test intent: Given real Atlas/Orbit/Nebula fixtures, when authenticated Alice requests My Work, then authorized Board/Tracker rows appear once, unauthorized rows are absent, and tracker-wins/composite identity holds.
   Exercise through: Express/authenticated HTTP API.
   Test doubles: real PostgreSQL/session fixture; do not mock route/Kysely/auth.
   Expected RED: API/collaboration not implemented.

2. Run test — verify FAIL:
   `RUN_INTEGRATION=1 npm run test -- server/src/routes/my-work.integration.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

3. Implement minimal behavior:
   Implement isolated DB fixtures/assertions.

4. Run test — verify PASS:
   `RUN_INTEGRATION=1 npm run test -- server/src/routes/my-work.integration.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

5. Write failing test for: detail reauthorization.
   Test file: `server/src/routes/my-work.integration.test.ts`
   Level: integration
   Test intent: Given membership/assignment revoked after list, when detail runs, then HTTP 404/not_found returns no cached content.
   Exercise through: authenticated detail HTTP request.
   Test doubles: real DB membership transition; do not mock route.
   Expected RED: detail stale-access behavior absent.

6. Run test — verify FAIL:
   `RUN_INTEGRATION=1 npm run test -- server/src/routes/my-work.integration.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

7. Implement minimal behavior:
   Add detail reauth fixture/assertion.

8. Run test — verify PASS:
   `RUN_INTEGRATION=1 npm run test -- server/src/routes/my-work.integration.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

9. Write failing test for: Board Mark done/activity.
   Test file: `server/src/routes/my-work.integration.test.ts`
   Level: integration
   Test intent: Given authorized Board item/mapping, when Mark done runs, then only Board changes and one card activity records.
   Exercise through: authenticated Mark done HTTP request.
   Test doubles: real DB/status/activity; do not mock command.
   Expected RED: Board source integration absent.

10. Run test — verify FAIL:
   `RUN_INTEGRATION=1 npm run test -- server/src/routes/my-work.integration.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

11. Implement minimal behavior:
   Add Board write/activity fixture/assertion.

12. Run test — verify PASS:
   `RUN_INTEGRATION=1 npm run test -- server/src/routes/my-work.integration.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

13. Write failing test for: Tracker Mark done/activity.
   Test file: `server/src/routes/my-work.integration.test.ts`
   Level: integration
   Test intent: Given authorized Tracker item/slot done, when Mark done runs, then only Tracker changes and one tracker activity records.
   Exercise through: authenticated Mark done HTTP request.
   Test doubles: real DB/status/activity; do not mock command.
   Expected RED: Tracker source integration absent.

14. Run test — verify FAIL:
   `RUN_INTEGRATION=1 npm run test -- server/src/routes/my-work.integration.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

15. Implement minimal behavior:
   Add Tracker write/activity fixture/assertion.

16. Run test — verify PASS:
   `RUN_INTEGRATION=1 npm run test -- server/src/routes/my-work.integration.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

17. Write failing test for: stale conflict/no partial write.
   Test file: `server/src/routes/my-work.integration.test.ts`
   Level: integration
   Test intent: Given stale Board/Tracker version, when Mark done runs, then HTTP 409/version_conflict returns and no incorrect source/activity change occurs.
   Exercise through: authenticated HTTP API.
   Test doubles: real DB concurrent/version fixture; do not mock mutation.
   Expected RED: conflict integration absent.

18. Run test — verify FAIL:
   `RUN_INTEGRATION=1 npm run test -- server/src/routes/my-work.integration.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

19. Implement minimal behavior:
   Add conflict/source invariant assertion.

20. Run test — verify PASS:
   `RUN_INTEGRATION=1 npm run test -- server/src/routes/my-work.integration.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

21. Write failing test for: idempotent retry/activity count.
   Test file: `server/src/routes/my-work.integration.test.ts`
   Level: integration
   Test intent: Given item already done after uncertain first response, when same Mark done retries, then success returns and activity count stays one.
   Exercise through: authenticated HTTP API.
   Test doubles: real DB state; do not mock idempotency.
   Expected RED: retry integration absent.

22. Run test — verify FAIL:
   `RUN_INTEGRATION=1 npm run test -- server/src/routes/my-work.integration.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

23. Implement minimal behavior:
   Add idempotency/activity assertion.

24. Run test — verify PASS:
   `RUN_INTEGRATION=1 npm run test -- server/src/routes/my-work.integration.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

25. Write failing test for: revoked membership Mark done status/code/no write.
   Test file: `server/src/routes/my-work.integration.test.ts`
   Level: integration
   Test intent: Given membership is revoked before Mark done, when the HTTP command runs, then HTTP 404/not_found returns and neither source/activity changes.
   Exercise through: authenticated HTTP API.
   Test doubles: real DB membership state; do not invent a role policy or mock route.
   Expected RED: revoked mutation integration is absent.

26. Run test — verify FAIL:
   `RUN_INTEGRATION=1 npm run test -- server/src/routes/my-work.integration.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

27. Implement minimal behavior:
   Add membership revocation status/code/no-write assertions.

28. Run test — verify PASS:
   `RUN_INTEGRATION=1 npm run test -- server/src/routes/my-work.integration.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

29. Write failing test for: removed assignment Mark done status/code/no write.
   Test file: `server/src/routes/my-work.integration.test.ts`
   Level: integration
   Test intent: Given Alice is removed from the item before Mark done, when the HTTP command runs, then HTTP 404/not_found returns and neither source/activity changes.
   Exercise through: authenticated HTTP API.
   Test doubles: real DB assignment state; do not invent a role policy or mock route.
   Expected RED: assignment-removal mutation integration is absent.

30. Run test — verify FAIL:
   `RUN_INTEGRATION=1 npm run test -- server/src/routes/my-work.integration.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

31. Implement minimal behavior:
   Add assignment-removal status/code/no-write assertions.

32. Run test — verify PASS:
   `RUN_INTEGRATION=1 npm run test -- server/src/routes/my-work.integration.test.ts`
   Expected: both reauthorization cycles and all prior server cycles pass.

33. Refactor while green (bounded):
   Keep logic within the task's declared files, reuse existing helpers, and do not implement out-of-scope behavior. Re-run the task test command.

34. Commit:
   git add server/src/routes/my-work.integration.test.ts
   git commit -m "test(my-work): verify server acceptance boundary"

## REFERENCES LOADED

- Spec all server-side GWT scenarios and acceptance criteria.
- `server/src/routes/work-item-unified.integration.test.ts` — Express/DB/auth fixture conventions.
- `server/src/routes/workspaceAccess.test.ts` and existing assignee/concurrency tests.
- T2/T3 server modules and test contracts.

## WHY THIS APPROACH

Complexity: deep
Justification: Unit tests cannot prove membership + source merge + route auth + activity/idempotency across two physical tables. This is an independently useful acceptance boundary and is marked test-risk.

## SANDWICH CONTEXT

[CRITICAL: The HTTP API must never leak unauthorized workspace data and must preserve source-specific transactional writes/activity.]
You are verifying My Work's server collaboration boundary.
Spec: `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md`
Design decision: set-based personal read plus source-aware Mark done.
Files in scope: only the new server integration test and declared test fixtures.
Available after: T2 and T3.
Architecture rule: use real auth/DB/integration seams; do not mock the collaboration being verified.
[RESTATE: The HTTP API must never leak unauthorized workspace data and must preserve source-specific transactional writes/activity.]

## DELIVERABLE

Given real Atlas/Orbit/Nebula fixtures, when authenticated HTTP requests run, then all server acceptance scenarios pass.
Given conflict, retry, revoked access, or unauthorized Mark done, when the API is exercised, then the specified status/error/activity behavior is observed.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Real DB/auth boundary is exercised; no mock-only substitute.
- Both Board and Tracker sources are represented.
- Activity count and source table effects are asserted.
- Test is isolated and runnable with the repository's DB setup.

Must-not-have:

- No client behavior or UI test code in this task.
- No weakening of auth to make fixtures pass.

Open question risks:

- DB availability is required; report BLOCKED rather than replacing the integration with mocks.

Rollback note:

- Delete the test file only; production code remains covered by unit tests.

## STOP CONDITIONS

Done when: the integration test passes with migrated DB and covers all cross-unit server scenarios.
Uncertain when: the real-DB harness cannot assert source/activity effects without weakening auth.
Escalate when: the test requires bypassing auth/membership or directly mutating internal service state.

---

### Task 10: Verify cross-component client acceptance [depends: T8] [test-risk]

## OBJECTIVE

Verify the route, URL state, global detail, guarded source navigation, responsive bottom sheet, error/empty states, and Mark done action as a collaborating client surface.

Files:

- Create: `client/src/pages/MyWorkPage.integration.test.tsx`

Steps:

1. Write failing test for: route/detail/back state.
   Test file: `client/src/pages/MyWorkPage.integration.test.tsx`
   Level: component integration
   Test intent: Given MemoryRouter/API/BoardContext, when user opens /my-work, filters, opens detail, closes/back, then URL state survives and activeWorkspaceId stays.
   Exercise through: route tree/page/detail collaboration.
   Test doubles: fake network/context boundaries; do not mock My Work units.
   Expected RED: integration route behavior is absent.

2. Run test — verify FAIL:
   `npm run test -- client/src/pages/MyWorkPage.integration.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

3. Implement minimal behavior:
   Build client integration harness for route/detail/back.

4. Run test — verify PASS:
   `npm run test -- client/src/pages/MyWorkPage.integration.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

5. Write failing test for: guarded source navigation.
   Test file: `client/src/pages/MyWorkPage.integration.test.tsx`
   Level: component integration
   Test intent: Given a non-active source item, when Open in Board/Tracker is allowed, blocked, or canceled, then only allowed transition navigates and blocked state remains.
   Exercise through: source action/BoardContext guard collaboration.
   Test doubles: fake guard/history; do not mock navigation decision.
   Expected RED: guard collaboration is absent.

6. Run test — verify FAIL:
   `npm run test -- client/src/pages/MyWorkPage.integration.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

7. Implement minimal behavior:
   Add independent source-guard assertion.

8. Run test — verify PASS:
   `npm run test -- client/src/pages/MyWorkPage.integration.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

9. Write failing test for: mobile detail bottom sheet.
   Test file: `client/src/pages/MyWorkPage.integration.test.tsx`
   Level: component integration
   Test intent: Given 390px viewport, when item opens, then responsive row/detail bottom sheet and close control work.
   Exercise through: full page/detail surface.
   Test doubles: fake network/viewport only; do not mock components.
   Expected RED: mobile collaboration is absent.

10. Run test — verify FAIL:
   `npm run test -- client/src/pages/MyWorkPage.integration.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

11. Implement minimal behavior:
   Add mobile integration assertion.

12. Run test — verify PASS:
   `npm run test -- client/src/pages/MyWorkPage.integration.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

13. Write failing test for: transient whole-page error/retry.
   Test file: `client/src/pages/MyWorkPage.integration.test.tsx`
   Level: component integration
   Test intent: Given list timeout/5xx, when page loads/retries, then whole-page error appears and complete request retries.
   Exercise through: page/API collaboration.
   Test doubles: fake network sequence; do not mock error UI.
   Expected RED: error collaboration is absent.

14. Run test — verify FAIL:
   `npm run test -- client/src/pages/MyWorkPage.integration.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

15. Implement minimal behavior:
   Add error/retry assertion.

16. Run test — verify PASS:
   `npm run test -- client/src/pages/MyWorkPage.integration.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

17. Write failing test for: Active empty state.
   Test file: `client/src/pages/MyWorkPage.integration.test.tsx`
   Level: component integration
   Test intent: Given no Active items but All history, when Active renders, then actionable empty state and All navigation work.
   Exercise through: page/scope collaboration.
   Test doubles: fake response fixture; do not mock empty decision.
   Expected RED: empty collaboration is absent.

18. Run test — verify FAIL:
   `npm run test -- client/src/pages/MyWorkPage.integration.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

19. Implement minimal behavior:
   Add empty-state assertion.

20. Run test — verify PASS:
   `npm run test -- client/src/pages/MyWorkPage.integration.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

21. Write failing test for: All query/cursor is server-backed.
   Test file: `client/src/pages/MyWorkPage.integration.test.tsx`
   Level: component integration
   Test intent: Given All scope/history candidates, when query or cursor changes, then API receives a new server-backed request and client does not load unbounded history.
   Exercise through: page/API/query-state collaboration.
   Test doubles: fake fetch spy/paginated responses; do not mock page request decision.
   Expected RED: All query/cursor collaboration is absent.

22. Run test — verify FAIL:
   `npm run test -- client/src/pages/MyWorkPage.integration.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

23. Implement minimal behavior:
   Add server-backed All assertion.

24. Run test — verify PASS:
   `npm run test -- client/src/pages/MyWorkPage.integration.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

25. Write failing test for: Mark done rollback collaboration.
   Test file: `client/src/pages/MyWorkPage.integration.test.tsx`
   Level: component integration
   Test intent: Given Mark done conflict while older refresh exists, when response arrives, then rollback/refresh runs and stale snapshot cannot reinsert item.
   Exercise through: page/action/refresh collaboration.
   Test doubles: fake mutation/refresh sequence; do not mock reconciliation.
   Expected RED: mutation collaboration is absent.

26. Run test — verify FAIL:
   `npm run test -- client/src/pages/MyWorkPage.integration.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

27. Implement minimal behavior:
   Add rollback/race assertion.

28. Run test — verify PASS:
   `npm run test -- client/src/pages/MyWorkPage.integration.test.tsx`
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

---

### Task 11: Add My Work observability and performance verification [depends: T3, T6] [test-risk]

## OBJECTIVE

Instrument personal rollup latency/count/error telemetry and verify the p95 `<100ms` target at 10 workspaces/1,000 active items without logging task content or unauthorized identifiers.

Files:

- Create: `server/src/core/my-work-observability.ts`
- Create: `server/src/core/my-work-observability.test.ts`
- Create: `server/src/routes/my-work.performance.integration.test.ts`
- Create: `client/src/pages/MyWorkPage.performance.test.tsx`
- Modify: `server/src/routes/my-work.ts`

Steps:

1. Write failing test for: sanitized observability event.
   Test file: `server/src/core/my-work-observability.test.ts`
   Level: unit
   Test intent: Given timing/count/error inputs, when telemetry records, then latency/count/error class exist without task content/unauthorized identifiers.
   Exercise through: observability helper.
   Test doubles: fake logger/timestamp; do not mock sanitization.
   Expected RED: helper does not exist.

2. Run test — verify FAIL:
   `npm run test -- server/src/core/my-work-observability.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

3. Implement minimal behavior:
   Implement domain observability helper.

4. Run test — verify PASS:
   `npm run test -- server/src/core/my-work-observability.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

5. Write failing test for: server p95 workload target.
   Test file: `server/src/routes/my-work.performance.integration.test.ts`
   Level: integration/performance
   Test intent: Given 10 workspaces/1,000 active items, when warm rollup repeats, then p95 is below 100ms and telemetry is safe.
   Exercise through: authenticated HTTP API/real migrated DB.
   Test doubles: real DB; no mocked query path.
   Expected RED: performance fixture/instrumentation absent.

6. Run test — verify FAIL:
   `RUN_INTEGRATION=1 npm run test -- server/src/routes/my-work.performance.integration.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

7. Implement minimal behavior:
   Implement warm-up/fixture/p95/telemetry assertion and document DATABASE_URL/migration/Node/CI environment.

8. Run test — verify PASS:
   `RUN_INTEGRATION=1 npm run test -- server/src/routes/my-work.performance.integration.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

9. Write failing test for: client initial UI readiness.
   Test file: `client/src/pages/MyWorkPage.performance.test.tsx`
   Level: component performance
   Test intent: Given immediate authorized response, when page mounts, then first usable toolbar/list state appears under one second in controlled Vitest/Node environment.
   Exercise through: real MyWorkPage with fake network only.
   Test doubles: fake API response; do not mock page/helpers.
   Expected RED: readiness test/ready marker absent.

10. Run test — verify FAIL:
   `npm run test -- client/src/pages/MyWorkPage.performance.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

11. Implement minimal behavior:
   Implement controlled client timing assertion and document environment.

12. Run test — verify PASS:
   `npm run test -- client/src/pages/MyWorkPage.performance.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

13. Refactor while green (bounded):
   Keep logic within the task's declared files, reuse existing helpers, and do not implement out-of-scope behavior. Re-run the task test command.

14. Commit:
   git add server/src/core/my-work-observability.ts server/src/core/my-work-observability.test.ts server/src/routes/my-work.performance.integration.test.ts client/src/pages/MyWorkPage.performance.test.tsx server/src/routes/my-work.ts
    git commit -m "test(my-work): verify latency and observability"

## REFERENCES LOADED

- Spec performance, observability, failure, and privacy criteria.
- `server/src/core/work-item-latency.ts` — existing latency sampling conventions.
- `server/src/routes/my-work.ts` from T2 and Mark done route from T3.
- Existing server integration fixture patterns.
- `client/src/pages/MyWorkPage.tsx` and client test conventions for visible-ready markers.
- node-postgres/Kysely docs for pool/query behavior relevant to a real DB performance test.

## WHY THIS APPROACH

Complexity: deep
Justification: p95, workload size, error classification, and sanitized telemetry materially change the test level and require real DB collaboration; this is marked test-risk.

## SANDWICH CONTEXT

[CRITICAL: Performance instrumentation must never log task content or unauthorized identifiers, and the personal query must remain set-based.]
You are verifying My Work production quality.
Spec: `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md`
Design decision: server-side personal rollup with bounded Active data and no global SSE.
Files in scope: observability helper/tests, My Work route instrumentation, server performance integration test, and client readiness test.
Available after: T3 and T6.
Architecture rule: measure the real API/DB boundary; do not replace the workload with mocked query timing.
[RESTATE: Performance instrumentation must never log task content or unauthorized identifiers, and the personal query must remain set-based.]

## DELIVERABLE

Given the approved 10-workspace/1,000-item fixture, when the rollup is measured, then p95 is below 100ms and safe telemetry is emitted.
Given a normal successful response, when the client page mounts, then its first usable state is ready within one second.
Given unauthorized or transient failures, when telemetry records them, then only class/count/latency data is emitted.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- p95 test uses a real DB/query path and documents prerequisites.
- Client readiness test uses real page rendering with only the network boundary doubled.
- Telemetry is structured, sanitized, and covered by unit tests.
- The route remains set-based and response semantics are unchanged.

Must-not-have:

- No task title/description/key in metrics or error logs.
- No performance test that measures mocked queries.
- No global SSE or projection introduced for the benchmark.

Open question risks:

- CI hardware/database variance may require a controlled performance-test environment; record `DATABASE_URL`, migration state, Node version, and runner details, and report DONE_WITH_CONCERNS if threshold cannot be reproduced honestly.

Rollback note:

- Remove observability wiring; route/read behavior remains.

## STOP CONDITIONS

Done when: safe telemetry unit tests and controlled performance integration tests pass or report a documented environment concern.
Uncertain when: p95 cannot be measured against a migrated DB fixture.
Escalate when: meeting p95 requires a schema migration, persistent projection, or client-side authorization shortcut.

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
| ------ | ------ | --------- | ------------ | ----------------- |
| T1 | Add My Work contract and Fuse.js dependency | prereq | standard | API methods serialize query/detail/Mark done contract |
| T2 | Implement server personal rollup and detail | T1 | deep | authorized cross-workspace read and reauthorized detail |
| T3 | Extract and implement source-aware Mark done | T2 | deep | source mapping, conflicts, idempotent activity |
| T4 | Build normalization/order/pagination/Fuse helpers | T1 | standard | status/timezone/order/search unit tests |
| T5 | Add global My Work navigation | T1 | lightweight | desktop/collapsed/mobile active nav |
| T6 | Build My Work page and responsive list | T2, T4, T5 | deep | filters, groups, 50-page, errors, empty, row UI |
| T7 | Add global detail and guarded source navigation | T6 | standard | no silent switch, reauth, back/guard state |
| T8 | Add client Mark done action | T3, T7 | standard | mutation routing, disabled state, optimistic rollback |
| T9 | Verify cross-unit server acceptance | T2, T3 | deep | real auth/DB read/detail/mutation/failure boundary |
| T10 | Verify cross-component client acceptance | T8 | standard | route/detail/URL/mobile/error/mutation collaboration |
| T11 | Add observability and performance verification | T3, T6 | deep | sanitized telemetry, p95 workload, and client-ready target |
