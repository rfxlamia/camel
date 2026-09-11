# EXECUTION PLAN — My Work

**Date:** 2026-09-11
**Spec:** `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md`
**Status:** draft
**Total tasks:** 11

---

## Execution Overview

### Recommended Order

```text
T1 → T2, T4, T5 (parallel) → T3 → T6 → T7 → T8 → T9, T10, T11 (parallel)
```

> Dependency order above is recommended — pocket skill enforces actual parallelism and sequencing based on its routing logic.

### Phases

- **Phase A — Foundation:** T1
- **Phase B — Server and client foundations:** T2, T3, T4, T5
- **Phase C — Product surfaces:** T6, T7, T8
- **Phase D — Cross-unit verification and quality:** T9, T10, T11

### Parallelizable Groups

| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T2, T4, T5 | T1 completes |
| Group B | T9, T11 | T2 and T3 complete |
| Group C | T10 | T8 completes |

### Constraints Reminder

**Architecture:** Personal reads must be authorized server-side by workspace membership and assignee relationship; queries must be set-based with batched hydration; the intentional `cards` + `tracker_items` dual-table shim remains; tracker-wins dedup is per workspace; client writes use `workItemMutations.ts`; Board/Tracker status mappings and activity/version semantics are preserved; no client-side authorization boundary; no silent workspace switching; server imports use NodeNext `.js` extensions; root verification uses `npm run test`.

**Out-of-scope:** Physical `work_items` migration; full inline editing; bulk actions; reassignment; arbitrary cross-workspace writes; user-level SSE; reporting/calendar/roadmap/analytics; created-by-only items; silent workspace switching.

**Assumptions at risk:** All-scope fuzzy ranking is candidate-window based; global detail route shape is additive; Tracker done target uses deterministic `slot="done"` position/id selection; existing edit permission checks are reused; visibility/manual refresh is the V1 freshness contract.

**Sequencing:** Dependency order shown is recommended — pocket-development enforces actual blocking rules. T9–T11 are intentionally independent verification tasks after the product surfaces are complete.

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

1. Write failing test for: list request serializes all supplied filters.
   Test file: `client/src/api.my-work.test.ts`
   Level: unit
   Test intent:
   Given the request boundary is configured with a fake fetch implementation
   When `api.listMyWork` is called with scope, query, workspace/source filters, cursor, and page size
   Then the exact personal-list URL/query is requested and the typed response is returned.
   Exercise through: public `api.listMyWork`.
   Test doubles: fake fetch through `configureRequestBoundaryForTests`; do not mock API methods.
   Expected RED: `listMyWork` and its contract do not exist.

2. Run test — verify FAIL:
   `npm run test -- client/src/api.my-work.test.ts`
   Expected failure: missing `listMyWork` export/property.

3. Write failing test for: omitted optional filters produce no invalid query parameters.
   Test file: `client/src/api.my-work.test.ts`
   Level: unit
   Test intent:
   Given only the default Active scope
   When `api.listMyWork` is called without query, workspace, source, or cursor
   Then the request contains only valid default parameters and no `undefined`/empty filter values.
   Exercise through: public API method and captured fetch URL.
   Test doubles: fake fetch; do not mock query construction.
   Expected RED: the method does not exist and cannot satisfy omission behavior.

4. Run test — verify FAIL:
   `npm run test -- client/src/api.my-work.test.ts`
   Expected failure: missing API method/contract.

5. Write failing test for: detail and Mark done paths use composite identity and version.
   Test file: `client/src/api.my-work.test.ts`
   Level: unit
   Test intent:
   Given workspace id, source, key, and version
   When `api.getMyWorkItem` and `api.markMyWorkDone` are called
   Then detail uses workspace/source/key and Mark done sends the expected version/body.
   Exercise through: public API methods.
   Test doubles: fake fetch; do not mock response parsing.
   Expected RED: detail/Mark done methods do not exist.

6. Run test — verify FAIL:
   `npm run test -- client/src/api.my-work.test.ts`
   Expected failure: missing detail/Mark done API methods.

7. Write failing test for: the client API forwards authorized responses and does not implement authorization.
   Test file: `client/src/api.my-work.test.ts`
   Level: unit
   Test intent:
   Given the server response contains an authorized item and action metadata
   When the API method resolves
   Then the response is returned unchanged and no client membership/assignment query is issued.
   Exercise through: public API method and fetch call count.
   Test doubles: fake fetch only; do not mock the API boundary.
   Expected RED: no My Work contract exists.

8. Run test — verify FAIL:
   `npm run test -- client/src/api.my-work.test.ts`
   Expected failure: missing response contract/API methods.

9. Implement minimal contract and dependency:
   - Add `fuse.js@^7.5.0` to the client workspace and update `package-lock.json` with the repository's package manager command.
   - Create `client/src/types/myWork.ts` with `MyWorkScope`, `MyWorkItem`, `MyWorkPage`, `MyWorkDetail`, and request/filter types. Include workspace identity, source, composite identity, normalized due/overdue metadata, edit permission, and Mark done availability reason.
   - Re-export the domain types from `client/src/types.ts` without moving unrelated types.
   - Create `client/src/api/myWork.ts` as a domain API factory receiving the existing request function. Keep `api.ts` as the public façade while avoiding a second fetch boundary.
   - Compose the domain methods into the existing `api` object from `client/src/api.ts`.

10. Run test — verify PASS:
    `npm run test -- client/src/api.my-work.test.ts`
    Expected: all four API contract cycles pass.

11. Refactor while green (bounded):
    - Keep all My Work request construction in `client/src/api/myWork.ts`; do not duplicate query serialization in the page.
    - Keep `client/src/api.ts` as the existing façade and do not refactor unrelated API methods.
    - Re-run: `npm run test -- client/src/api.my-work.test.ts` — must stay PASS.

12. Commit:
    `git add client/src/types/myWork.ts client/src/api/myWork.ts client/src/api.my-work.test.ts client/src/types.ts client/src/api.ts client/package.json package-lock.json`
    `git commit -m "feat(my-work): define client contract and search dependency"`

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
- My Work response types carry workspace/source/composite identity and permission/action metadata.
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

1. Write failing test for: authorized cross-workspace rollup includes both sources exactly once.
   Test file: `server/src/routes/my-work.test.ts`
   Level: unit

   Test intent:
   Given a current user is a member of Atlas and Orbit but not Nebula, with assigned Board and Tracker rows in the first two workspaces
   When the personal rollup entry point is called with `scope=active`
   Then:
   - only authorized workspaces contribute rows
   - both physical sources are represented
   - each row carries workspace id/name, source, key, composite identity, and action metadata
   - duplicate assignee joins do not duplicate rows
   - tracker-wins dedup applies only within a workspace

   Exercise through:
   - the exported personal list handler/service boundary with a fake DB executor and membership result

   Test doubles:
   - mock/fake: DB executor queries, workspace membership lookup, assignee/label loaders
   - do NOT mock: the personal merge/dedup/serialization logic under test

   Expected RED:
   - the personal route/response module does not exist.

2. Run test — verify FAIL:
   `npm run test -- server/src/routes/my-work.test.ts`
   Expected failure: missing personal rollup module or route behavior.

3. Implement minimal code:
   - Create `my-work-response.ts` with source-specific selection, membership-scoped query builders, per-workspace key dedup, batched assignee/label hydration, workspace metadata, composite identity, and normalized response serialization.
   - Use one set-based query path per source; do not call `listMergedWorkItems()` once per workspace.
   - Preserve soft-delete filters and existing Board/Tracker status/slot values. Expose enough workspace timezone/due metadata for the approved overdue behavior.
   - Create `my-work.ts` with authenticated list and detail handlers. List supports active/all, key/title/description query, workspace/source filters, cursor/page-size handling, and unauthorized-workspace exclusion. Detail rechecks membership and assignment before returning data.
   - Mount the router from `server/src/routes.ts` behind the existing authenticated API router.

4. Run test — verify PASS:
   `npm run test -- server/src/routes/my-work.test.ts`
   Expected: authorization, source merge, identity, dedup, and serialization tests pass.

5. Write failing test for: Active/All normalization, unknown status, and detail reauthorization.
   Test file: `server/src/routes/my-work.test.ts`
   Level: unit
   Test intent:
   Given completed/canceled, backlog/started, and unknown status categories plus a previously visible item whose membership is revoked
   When Active/All list or detail is requested
   Then terminal filtering, Other preservation, and unavailable detail behavior match the spec.
   Exercise through: route/service boundary.
   Test doubles: fake DB executor and membership/assignment state; do not mock normalization.
   Expected RED: current implementation lacks scope normalization and detail reauthorization.

6. Run test — verify FAIL:
   `npm run test -- server/src/routes/my-work.test.ts`
   Expected failure: missing Active/All and reauthorization assertions.

7. Implement minimal code to satisfy the tests, including explicit unauthorized-versus-transient error classification.

8. Run test — verify PASS:
   `npm run test -- server/src/routes/my-work.test.ts`
   Expected: all personal read tests pass.

9. Write failing test for: All-scope search, workspace/source filters, and cursor pagination.
   Test file: `server/src/routes/my-work.test.ts`
   Level: unit
   Test intent:
   Given active, completed, canceled, and Other items across Atlas and Orbit
   When an All request includes q, workspace/source filters, cursor, and page size
   Then all-status candidates are searched, filters apply server-side, and the response returns deterministic items plus the next cursor.
   Exercise through: personal list handler/service boundary.
   Test doubles: fake DB executor with captured predicates and result pages; do not mock query construction.
   Expected RED: the current implementation does not prove All/search/filter/cursor behavior.

10. Run test — verify FAIL:
    `npm run test -- server/src/routes/my-work.test.ts`
    Expected failure: missing All/search/filter/cursor assertions.

11. Implement the All/search/filter/cursor behavior and explicit transient-error classification without changing unauthorized-workspace exclusion.

12. Run test — verify PASS:
    `npm run test -- server/src/routes/my-work.test.ts`
    Expected: all personal read tests, including All pagination/search, pass.

13. Write failing test for: transient list failure returns a retryable error classification rather than an empty/partial success.
    Test file: `server/src/routes/my-work.test.ts`
    Level: unit
    Test intent:
    Given the personal query dependency throws a transient database/network error
    When the list handler runs
    Then it returns the route's retryable error classification and no partial result payload.
    Exercise through: route factory with an injected failing query dependency.
    Test doubles: injected query dependency that throws; do not mock error mapping.
    Expected RED: the route has no explicit transient failure seam/classification.

14. Run test — verify FAIL:
    `npm run test -- server/src/routes/my-work.test.ts`
    Expected failure: transient error is unclassified or becomes an empty response.

15. Implement the injected route dependency/error mapping and keep production wiring on the real Kysely executor.

16. Run test — verify PASS:
    `npm run test -- server/src/routes/my-work.test.ts`
    Expected: transient, unauthorized, All, filter, cursor, and detail assertions pass.

17. Refactor while green (bounded):
    - Keep global query/serialization logic in `my-work-response.ts`; do not grow `work-item-response.ts` or `tracker-items.ts` with cross-workspace branches.
    - Keep route parsing/error translation in `my-work.ts` and make the failure injection seam explicit for tests.
    - Re-run: `npm run test -- server/src/routes/my-work.test.ts`.

18. Commit:
    `git add server/src/routes/my-work-response.ts server/src/routes/my-work.ts server/src/routes.ts server/src/routes/my-work.test.ts`
    `git commit -m "feat(my-work): add authorized personal rollup"`

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

Provide the only V1 My Work mutation: permission-checked, source-aware, version-safe, canonical-target Mark done with idempotent retries and exactly-once activity behavior.

Files:

- Create: `server/src/core/tracker-item-status-change.ts`
- Create: `server/src/core/my-work-mark-done.ts`
- Create: `server/src/core/tracker-item-status-change.test.ts`
- Create: `server/src/core/my-work-mark-done.test.ts`
- Modify: `server/src/routes/tracker-items.ts`
- Modify: `server/src/routes/my-work.ts`

Steps:

1. Write failing test for: Tracker status-change extraction preserves existing route behavior and resolves the canonical `slot="done"` target deterministically.
   Test file: `server/src/core/tracker-item-status-change.test.ts`
   Level: unit
   Test intent:
   Given a Tracker item with current version and multiple status vocabulary rows
   When the extracted status-change service is asked to mark it done
   Then it selects the deterministic position/id target, updates the item once, and records one tracker activity event.
   Exercise through: exported status-change service used by both route consumers.
   Test doubles: chainable Kysely executor and activity recorder; do not mock the resolver under test.
   Expected RED: no extracted service exists and existing route logic is inline.

2. Run test — verify FAIL:
   `npm run test -- server/src/core/tracker-item-status-change.test.ts`
   Expected failure: missing service export.

3. Extract the minimal tracker status mutation primitive from `tracker-items.ts`, preserve its existing API behavior, and make the canonical done selection deterministic.

4. Run test — verify PASS:
   `npm run test -- server/src/core/tracker-item-status-change.test.ts`
   Expected: extraction and canonical target tests pass.

5. Write failing test for: Mark done permission, mapping, conflict, idempotency, and activity behavior.
   Test file: `server/src/core/my-work-mark-done.test.ts`
   Level: unit
   Test intent:
   Given Board and Tracker source rows, edit permission, versions, and mappings
   When Mark done is requested
   Then:
   - unauthorized actors and missing mappings produce no source write
   - stale versions return conflict for both sources
   - already-done items return idempotent success without a duplicate activity
   - successful Board/Tracker writes use the correct source primitive and record one activity
   Exercise through: `my-work-mark-done.ts` public service boundary.
   Test doubles: fake DB transaction, existing Board status service, extracted Tracker status service, and activity recorders; do not mock the command's decision logic.
   Expected RED: command service and route action do not exist.

6. Run test — verify FAIL:
   `npm run test -- server/src/core/my-work-mark-done.test.ts`
   Expected failure: missing command behavior and decision assertions.

7. Implement `my-work-mark-done.ts` and add the POST action to `my-work.ts`:
   - reauthorize membership, assignment, and existing edit permission;
   - resolve Board `is_done`/position and Tracker `slot="done"` mappings;
   - delegate Board changes to `applyBoardCardStatusChange` and Tracker changes to the extracted primitive;
   - preserve version conflicts and activity semantics;
   - treat an already-canonical target as idempotent success without a second activity.

8. Run test — verify PASS:
   `npm run test -- server/src/core/my-work-mark-done.test.ts`
   Expected: all source, permission, conflict, mapping, and idempotency tests pass.

9. Write failing test for: canonical target removal after page load causes no partial write.
   Test file: `server/src/core/my-work-mark-done.test.ts`
   Level: unit
   Test intent:
   Given a valid done mapping was read earlier
   When the mapping is removed before the Mark done transaction resolves
   Then no source row is partially updated, the command returns a mapping failure, and activity is not recorded.
   Exercise through: `my-work-mark-done.ts` transaction boundary.
   Test doubles: fake transaction whose mapping lookup changes between reads; do not mock command decision logic.
   Expected RED: mapping-race behavior is not explicitly covered.

10. Run test — verify FAIL:
    `npm run test -- server/src/core/my-work-mark-done.test.ts`
    Expected failure: mapping-race assertion is absent or partial write is observed.

11. Implement the atomic mapping recheck/rollback behavior.

12. Run test — verify PASS:
    `npm run test -- server/src/core/my-work-mark-done.test.ts`
    Expected: permission, mapping, conflict, idempotency, activity, and mapping-race tests pass.

13. Refactor while green (bounded):
    - Keep source-specific behavior in existing/extracted domain services; keep route parsing in `my-work.ts`.
    - Do not duplicate Tracker mutation logic in My Work.
    - Run existing regression tests: `npm run test -- server/src/core/board-card-status-change.test.ts server/src/routes/tracker-items.write.test.ts`.

14. Commit:
    `git add server/src/core/tracker-item-status-change.ts server/src/core/my-work-mark-done.ts server/src/core/tracker-item-status-change.test.ts server/src/core/my-work-mark-done.test.ts server/src/routes/tracker-items.ts server/src/routes/my-work.ts`
    `git commit -m "feat(my-work): add source-aware mark done"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md` — Mark done rules, permission, mapping, conflict, retry, and activity criteria.
- `server/src/core/board-card-status-change.ts` — existing Board status/column/WIP/activity transaction.
- `server/src/core/column-status-map.ts` and `column-status-reverse.ts` — existing Board mapping.
- `server/src/routes/tracker-items.ts` — inline Tracker status mutation to extract without behavior drift.
- `server/src/routes/tracker-activity.ts` — Tracker activity contract.
- Existing Board status-change tests — chainable Kysely test-double pattern.

## WHY THIS APPROACH

Complexity: deep
Justification: Mark done crosses authorization, two physical sources, version conflicts, status mappings, activity logging, and uncertain-response idempotency. The extraction prevents a second Tracker mutation implementation.

## SANDWICH CONTEXT

[CRITICAL: Mark done must route through source-specific transactional mutation primitives and must not bypass version/activity/permission rules.]
You are implementing the bounded My Work mutation for `camel-kanban`.
Spec: `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md`
Design decision: Mark done is the only V1 write; full editing and bulk actions remain out of scope.
Files in scope: the listed core services, My Work route, Tracker extraction, and their tests.
Available after: T2.
Architecture rule: preserve `recordActivity`/`recordTrackerActivity`, optimistic version conflicts, and existing Board/Tracker mappings.
[RESTATE: Mark done must route through source-specific transactional mutation primitives and must not bypass version/activity/permission rules.]

## DELIVERABLE

Given an authorized assignee with a valid Board or Tracker done target, when Mark done is requested, then the correct source changes and exactly one activity is recorded.
Given stale version, missing mapping, or unauthorized edit permission, when Mark done is requested, then no partial write occurs and the specific failure is returned.
Given the source is already at the canonical done target, when the command is retried, then it succeeds idempotently without duplicate activity.
[must-not] Given a tracker item, when Mark done runs, then it must not write the `cards` table.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Existing Tracker write behavior remains green after extraction.
- Board and Tracker use their correct source tables and activity streams.
- Permission, mapping, version, idempotency, and no-partial-write behavior are tested.
- Route tests use the existing auth/permission boundary rather than trusting UI flags.

Must-not-have:

- No generic cross-source table write.
- No duplicate Tracker status mutation implementation.
- No bulk edit or reassignment behavior.

Open question risks:

- Existing permission helpers may classify member edit rights differently than the product phrase “edit permission”; reuse current route behavior and report NEEDS_CONTEXT if it cannot be shared.

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
   Test intent:
   Given backlog/started/completed/canceled/unknown categories
   When the helper derives Active/All groups
   Then completed/canceled are excluded from Active and unknown remains under Other.
   Exercise through: exported pure normalization/filter functions.
   Test doubles: plain `MyWorkItem` fixtures; do not mock helper logic.
   Expected RED: helper module does not exist.

2. Run test — verify FAIL:
   `npm run test -- client/src/lib/myWorkUtils.test.ts`
   Expected failure: missing helper exports.

3. Write failing test for: workspace-timezone overdue ordering and deterministic ties.
   Test file: `client/src/lib/myWorkUtils.test.ts`
   Level: unit
   Test intent:
   Given due dates at the same local day boundary and equal tie values
   When the helper orders items within a status group
   Then due-today/overdue behavior uses workspace timezone and equal items use a stable tie-breaker.
   Exercise through: exported ordering/date functions.
   Test doubles: fake clock/time values and plain fixtures; do not mock Intl/date behavior.
   Expected RED: timezone-aware ordering is not implemented.

4. Run test — verify FAIL:
   `npm run test -- client/src/lib/myWorkUtils.test.ts`
   Expected failure: overdue/tie assertions fail.

5. Write failing test for: 50-item render pagination and URL view-state parsing.
   Test file: `client/src/lib/myWorkUtils.test.ts`
   Level: unit
   Test intent:
   Given 73 active items and scope/filter/page query values
   When pagination and URL helpers run
   Then page one contains 50, page two contains 23, and omitted/invalid query values resolve to safe defaults.
   Exercise through: exported pagination and URL-state helpers.
   Test doubles: plain fixtures; do not mock URLSearchParams.
   Expected RED: pagination/view-state helpers are absent.

6. Run test — verify FAIL:
   `npm run test -- client/src/lib/myWorkUtils.test.ts`
   Expected failure: pagination/view-state assertions fail.

7. Write failing test for: Fuse.js key/typo ranking and bounded result limit.
   Test file: `client/src/lib/myWorkSearch.test.ts`
   Level: unit
   Test intent:
   Given authorized items with key/title/description values
   When search runs for “imgae uplod” with a result limit
   Then key/title/description are searchable, “Image upload retry” ranks, and the limit is respected.
   Exercise through: exported search helper using real Fuse.js.
   Test doubles: plain fixtures only; do not mock Fuse.js.
   Expected RED: search helper and Fuse configuration do not exist.

8. Run test — verify FAIL:
   `npm run test -- client/src/lib/myWorkSearch.test.ts`
   Expected failure: missing search helper/configuration.

9. Write failing test for: All candidate-window and authorization must-not behavior.
   Test file: `client/src/lib/myWorkSearch.test.ts`
   Level: unit
   Test intent:
   Given only the server-provided candidate list
   When All search runs
   Then terminal/Other candidates are ranked, result limits apply, and the helper performs no fetch/membership discovery or authorization decision.
   Exercise through: exported search helper with a spy-free plain input list.
   Test doubles: plain fixtures; do not mock or call a network boundary.
   Expected RED: candidate-window and no-discovery behavior is not explicit.

10. Run test — verify FAIL:
    `npm run test -- client/src/lib/myWorkSearch.test.ts`
    Expected failure: missing candidate/no-discovery assertions.

11. Implement `myWorkUtils.ts` and `myWorkSearch.ts`:
    - normalize groups, Active/All, timezone dates, stable ordering, 50-item pages, and URL state;
    - configure Fuse keys/threshold/limit and keep All candidate ranking bounded;
    - do not authorize, fetch, or mutate from helpers.

12. Run test — verify PASS:
    `npm run test -- client/src/lib/myWorkUtils.test.ts client/src/lib/myWorkSearch.test.ts`
    Expected: all normalization, timezone, pagination, typo, limit, candidate, and no-discovery tests pass.

13. Refactor while green:
    - Keep status/date/order logic in `myWorkUtils.ts` and Fuse configuration in `myWorkSearch.ts`.
    - Do not duplicate grouping or overdue logic inside page components.
    - Re-run both test files.

14. Commit:
    `git add client/src/lib/myWorkUtils.ts client/src/lib/myWorkSearch.ts client/src/lib/myWorkUtils.test.ts client/src/lib/myWorkSearch.test.ts`
    `git commit -m "feat(my-work): add list derivation and fuzzy search"`

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

1. Write failing test for: expanded desktop global navigation and route active state.
   Test file: `client/src/layout/sidebar/myWorkNavigation.test.tsx`
   Level: component
   Test intent:
   Given an authenticated expanded desktop sidebar in `/my-work`, `/board`, and `/tracker`
   When the navigation renders
   Then My Work is visible outside Kanban/Agent mode lists and only `/my-work` has its active state.
   Exercise through: rendered `Sidebar` with MemoryRouter.
   Test doubles: fake Board/Notifications context and router history; do not mock Sidebar.
   Expected RED: no global My Work link exists.

2. Run test — verify FAIL:
   `npm run test -- client/src/layout/sidebar/myWorkNavigation.test.tsx`
   Expected failure: missing global link/active state.

3. Write failing test for: collapsed desktop navigation keeps an accessible My Work affordance.
   Test file: `client/src/layout/sidebar/myWorkNavigation.test.tsx`
   Level: component
   Test intent:
   Given the desktop sidebar is collapsed
   When navigation renders and My Work is clicked
   Then the icon has an accessible title/label and navigation goes to `/my-work` without changing mode/workspace.
   Exercise through: rendered collapsed `Sidebar`.
   Test doubles: fake Board/Notifications context and router history; do not mock link behavior.
   Expected RED: collapsed global navigation behavior is absent.

4. Run test — verify FAIL:
   `npm run test -- client/src/layout/sidebar/myWorkNavigation.test.tsx`
   Expected failure: collapsed label/navigation assertion fails.

5. Write failing test for: mobile navigation placement and close behavior.
   Test file: `client/src/layout/sidebar/myWorkNavigation.test.tsx`
   Level: component
   Test intent:
   Given mobile navigation is open
   When My Work is clicked
   Then the global item is visible outside mode lists, navigates to `/my-work`, and closes the mobile menu.
   Exercise through: rendered `MobileNav`.
   Test doubles: fake Board context and router history; do not mock MobileNav.
   Expected RED: mobile global item/close behavior is absent.

6. Run test — verify FAIL:
   `npm run test -- client/src/layout/sidebar/myWorkNavigation.test.tsx`
   Expected failure: mobile placement/close assertion fails.

7. Implement a global navigation item in `navItems.ts` and render it in both desktop/mobile navigation before mode-specific items. Preserve existing focus styles, notification behavior, and workspace switcher position.

8. Run test — verify PASS:
   `npm run test -- client/src/layout/sidebar/myWorkNavigation.test.tsx`
   Expected: expanded, collapsed, mobile, and active-state tests pass.

9. Refactor while green:
   - Keep the global item definition separate from `KANBAN_NAV` and `AGENT_NAV` rather than making My Work workspace-specific.
   - Re-run the navigation test.

10. Commit:
    `git add client/src/layout/sidebar/navItems.ts client/src/layout/sidebar/Sidebar.tsx client/src/layout/sidebar/MobileNav.tsx client/src/layout/sidebar/myWorkNavigation.test.tsx`
    `git commit -m "feat(my-work): add global navigation entry"`

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

1. Write failing test for: route load, Active/All controls, workspace/source filters, status grouping, and whole-page error/empty states.
   Test file: `client/src/pages/MyWorkPage.test.tsx`
   Level: component
   Test intent:
   Given the API returns assigned Board/Tracker items or a failure
   When My Work renders and the user changes scope/filter/search
   Then route `/my-work` loads without using activeWorkspaceId as rollup scope, URL filters update, badges/groups render, empty Active differs from transient error, and retry is available without partial data.
   Exercise through: `RouterProvider`/MemoryRouter, page component, and configured API boundary.
   Test doubles: fake API responses and BoardContext user/guards; do not mock page state/helpers.
   Expected RED: route/page/components do not exist.

2. Run test — verify FAIL:
   `npm run test -- client/src/pages/MyWorkPage.test.tsx`
   Expected failure: missing route/page or expected UI controls.

3. Write failing test for: visibility/manual refresh and expired-session distinction.
   Test file: `client/src/pages/MyWorkPage.test.tsx`
   Level: component
   Test intent:
   Given the page is hidden then visible, or the API returns an auth/session error
   When refresh/effect handling runs
   Then visibility triggers a newest-request-wins refresh, while expired auth renders an auth/session error rather than an empty state.
   Exercise through: page effect and visibility event boundary.
   Test doubles: fake API responses, document visibility events, and timers; do not mock stale-response handling.
   Expected RED: refresh/auth classification is absent.

4. Run test — verify FAIL:
   `npm run test -- client/src/pages/MyWorkPage.test.tsx`
   Expected failure: visibility/auth assertions fail.

5. Write failing test for: page-level 73-item ordering and 50/23 pagination.
   Test file: `client/src/pages/MyWorkPage.test.tsx`
   Level: component
   Test intent:
   Given 73 active items with overdue/due-date ordering across groups
   When the page renders and the user changes page
   Then the first page renders 50 rows in the helper-defined group/order and the second page renders 23 without duplicates/gaps.
   Exercise through: full page/list rendering with real helper modules.
   Test doubles: deterministic API fixture only; do not mock list derivation.
   Expected RED: page has no pagination/order integration.

6. Run test — verify FAIL:
   `npm run test -- client/src/pages/MyWorkPage.test.tsx`
   Expected failure: page-level pagination/order assertions fail.

7. Implement:
   - Add the authenticated lazy route to `App.tsx`.
   - Build toolbar controls for Active/All, search, workspace/source filters, counts, and retry.
   - Load the personal API response, guard against stale requests, refresh on visibility, and apply `myWorkUtils`/`myWorkSearch`.
   - Render status groups and 50-item pages with stable row identity.
   - Fail the whole page on transient list failure; distinguish session failure from empty state.
   - Preserve URL state for scope/query/filter/page/detail placeholders.

8. Run test — verify PASS:
   `npm run test -- client/src/pages/MyWorkPage.test.tsx`
   Expected: route/load/filter/error/empty/refresh/auth/pagination/order assertions pass.

9. Write failing test for: responsive row content and compact mobile layout.
   Test file: `client/src/components/my-work/MyWorkRow.test.tsx`
   Level: component
   Test intent:
   Given a Board or Tracker item with long title/workspace/source metadata, when rendered at compact/mobile props, then key, title, status, workspace/source, due state, and an accessible detail trigger remain usable without horizontal table dependence.
   Exercise through: `MyWorkRow` public props.
   Test doubles: plain item fixtures and viewport/container class assertions; do not mock row rendering.
   Expected RED: row component does not exist.

10. Run test — verify FAIL:
    `npm run test -- client/src/components/my-work/MyWorkRow.test.tsx`
    Expected failure: missing row component or required metadata.

11. Implement `MyWorkRow`/`MyWorkList`/`MyWorkToolbar` responsive rendering and stable action slots without adding mutation behavior.

12. Run test — verify PASS:
    `npm run test -- client/src/components/my-work/MyWorkRow.test.tsx`
    Expected: desktop/mobile content assertions pass.

13. Refactor while green:
    - Keep fetch/URL/visibility state in the page, controls in the toolbar, grouping/list rendering in list, and row presentation in row.
    - Keep Mark done/detail actions as explicit slots for T7/T8.
    - Re-run both page and row tests.

14. Commit:
    `git add client/src/pages/MyWorkPage.tsx client/src/components/my-work/MyWorkToolbar.tsx client/src/components/my-work/MyWorkList.tsx client/src/components/my-work/MyWorkRow.tsx client/src/App.tsx client/src/pages/MyWorkPage.test.tsx client/src/components/my-work/MyWorkRow.test.tsx`
    `git commit -m "feat(my-work): build personal work list"`

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

1. Write failing test for: global detail opens without active workspace change and closes/restores URL state.
   Test file: `client/src/components/my-work/MyWorkDetailSheet.test.tsx`
   Level: component
   Test intent:
   Given Orbit is active and AT-17 belongs to Atlas
   When AT-17 is selected and detail opens/closes
   Then detail shows Atlas/Board context, activeWorkspaceId remains Orbit, and Back/close restores filters/page.
   Exercise through: MemoryRouter, detail component, and BoardContext test seam.
   Test doubles: fake detail API response and BoardContext callbacks; do not mock detail/URL helper.
   Expected RED: no detail sheet/navigation helper exists.

2. Run test — verify FAIL:
   `npm run test -- client/src/components/my-work/MyWorkDetailSheet.test.tsx`
   Expected failure: missing detail component/navigation behavior.

3. Write failing test for: stale detail reauthorization hides cached content.
   Test file: `client/src/components/my-work/MyWorkDetailSheet.test.tsx`
   Level: component/integration
   Test intent:
   Given AT-17 was visible before Atlas access was revoked
   When global detail is requested
   Then unavailable is shown without cached task content or source action.
   Exercise through: detail API error boundary.
   Test doubles: fake unauthorized detail response; do not mock unavailable rendering.
   Expected RED: reauthorization/unavailable behavior is absent.

4. Run test — verify FAIL:
   `npm run test -- client/src/components/my-work/MyWorkDetailSheet.test.tsx`
   Expected failure: unavailable/detail authorization assertion fails.

5. Write failing test for: explicit source navigation guard behavior.
   Test file: `client/src/components/my-work/MyWorkDetailSheet.test.tsx`
   Level: component/integration
   Test intent:
   Given an item in a non-active workspace
   When Open in Board/Tracker is selected with no guard, with a blocking focus/unsaved state, or canceled
   Then successful navigation invokes the existing guard/source route, while blocked/canceled navigation leaves My Work state unchanged.
   Exercise through: public source action and BoardContext guard.
   Test doubles: fake `attemptSwitchWorkspace`/focus guard and router history; do not mock navigation decision logic.
   Expected RED: source transition behavior is absent.

6. Run test — verify FAIL:
   `npm run test -- client/src/components/my-work/MyWorkDetailSheet.test.tsx`
   Expected failure: source guard assertions fail.

7. Implement composite route/detail state helpers, read-only sheet, server-error mapping, explicit source navigation, guard reuse, and page wiring.

8. Run test — verify PASS:
   `npm run test -- client/src/components/my-work/MyWorkDetailSheet.test.tsx`
   Expected: global detail, reauthorization, guard, and URL restoration assertions pass.

9. Refactor while green:
   - Keep route identity/source transition decisions in `myWorkNavigation.ts`; keep presentation in the sheet.
   - Do not make global detail mutate `activeWorkspaceId`.
   - Re-run the detail test.

10. Commit:
    `git add client/src/components/my-work/MyWorkDetailSheet.tsx client/src/lib/myWorkNavigation.ts client/src/pages/MyWorkPage.tsx client/src/components/my-work/MyWorkDetailSheet.test.tsx`
    `git commit -m "feat(my-work): add global detail navigation"`

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

Connect the approved Mark done command to My Work through `workItemMutations.ts`, expose only the permission/mapping-allowed action, remove successful items from Active, and rollback/refresh on conflict or failure.

Files:

- Create: `client/src/components/my-work/MyWorkDoneAction.tsx`
- Modify: `client/src/lib/workItemMutations.ts`
- Modify: `client/src/components/my-work/MyWorkRow.tsx`
- Modify: `client/src/components/my-work/MyWorkDetailSheet.tsx`
- Test: `client/src/lib/workItemMutations.test.ts`
- Test: `client/src/components/my-work/MyWorkDoneAction.test.tsx`

Steps:

1. Write failing test for: mutation router selects the My Work Mark done API with workspace/source/key/version.
   Test file: `client/src/lib/workItemMutations.test.ts`
   Level: unit
   Test intent:
   Given a Board or Tracker `MyWorkItem` with a version
   When `markWorkItemDone` is invoked
   Then the My Work command receives workspace/source/key/version and returns source-preserving state.
   Exercise through: exported mutation helper.
   Test doubles: fake `api.markMyWorkDone`; do not mock routing decision.
   Expected RED: helper has no Mark done function.

2. Run test — verify FAIL:
   `npm run test -- client/src/lib/workItemMutations.test.ts`
   Expected failure: missing mutation helper/API call.

3. Implement `markWorkItemDone` in `workItemMutations.ts`.

4. Run test — verify PASS:
   `npm run test -- client/src/lib/workItemMutations.test.ts`
   Expected: source-aware routing assertions pass.

5. Write failing test for: disabled permission/mapping state.
   Test file: `client/src/components/my-work/MyWorkDoneAction.test.tsx`
   Level: component
   Test intent:
   Given `canMarkDone=false` and a disabled reason
   When the action renders
   Then it is disabled, explains permission/mapping, and does not call any mutation API.
   Exercise through: `MyWorkDoneAction` public props.
   Test doubles: fake mutation callback; do not mock disabled rendering.
   Expected RED: action component does not exist.

6. Run test — verify FAIL:
   `npm run test -- client/src/components/my-work/MyWorkDoneAction.test.tsx`
   Expected failure: missing action/disabled behavior.

7. Write failing test for: successful Mark done removes Active item and exposes All/Done state.
   Test file: `client/src/components/my-work/MyWorkDoneAction.test.tsx`
   Level: component
   Test intent:
   Given an eligible item and a successful mutation response
   When Mark done is clicked
   Then the page mutation callback removes it from Active, preserves it for All/Done, and shows success feedback.
   Exercise through: action callback boundary.
   Test doubles: fake mutation success and page-state callback; do not mock optimistic transition.
   Expected RED: success wiring is absent.

8. Run test — verify FAIL:
   `npm run test -- client/src/components/my-work/MyWorkDoneAction.test.tsx`
   Expected failure: success/removal assertion fails.

9. Write failing test for: version conflict rolls back and refreshes.
   Test file: `client/src/components/my-work/MyWorkDoneAction.test.tsx`
   Level: component
   Test intent:
   Given Mark done returns version conflict or transient failure
   When the action resolves
   Then optimistic state is restored, refresh is requested, and an actionable warning/error is shown without pretending success.
   Exercise through: action/page mutation callback.
   Test doubles: fake conflict/error mutation results and refresh callback; do not mock rollback state.
   Expected RED: conflict/failure recovery is absent.

10. Run test — verify FAIL:
    `npm run test -- client/src/components/my-work/MyWorkDoneAction.test.tsx`
    Expected failure: rollback/refresh assertion fails.

11. Write failing test for: Mark done racing an older refresh and direct-API must-not behavior.
    Test file: `client/src/components/my-work/MyWorkDoneAction.test.tsx`
    Level: component/integration
    Test intent:
    Given Mark done succeeds while an older refresh is in flight
    When the older snapshot arrives
    Then the item is not reinserted, and no component calls `api.updateCard` or `api.updateTrackerItem` directly.
    Exercise through: row/detail/page mutation collaboration and spy on forbidden direct methods.
    Test doubles: fake mutation/refresh responses; do not mock the state reconciliation under test.
    Expected RED: stale-refresh and forbidden-call behavior are not explicit.

12. Run test — verify FAIL:
    `npm run test -- client/src/components/my-work/MyWorkDoneAction.test.tsx`
    Expected failure: race/must-not assertions fail.

13. Implement the action, row/detail slots, optimistic reconciliation, rollback/refresh mapping, and no-direct-call boundary.

14. Run test — verify PASS:
    `npm run test -- client/src/components/my-work/MyWorkDoneAction.test.tsx`
    Expected: disabled, success, conflict, stale-refresh, and must-not assertions pass.

15. Refactor while green:
    - Keep permission/mapping display separate from mutation routing.
    - Do not add full edit/bulk controls.
    - Re-run both mutation and action tests plus `npm run check:mutation-routing`.

16. Commit:
    `git add client/src/components/my-work/MyWorkDoneAction.tsx client/src/lib/workItemMutations.ts client/src/components/my-work/MyWorkRow.tsx client/src/components/my-work/MyWorkDetailSheet.tsx client/src/lib/workItemMutations.test.ts client/src/components/my-work/MyWorkDoneAction.test.tsx`
    `git commit -m "feat(my-work): add mark done action"`

## REFERENCES LOADED

- Spec Mark done, permission, conflict, idempotency, and rollback criteria.
- `client/src/lib/workItemMutations.ts` and test — existing source-aware mutation router.
- `client/src/api/myWork.ts` — Mark done API contract from T1.
- `client/src/pages/MyWorkPage.tsx`, `MyWorkRow`, and `MyWorkDetailSheet` — action slots from T6/T7.

## WHY THIS APPROACH

Complexity: standard
Justification: Client mutation behavior must remain separate from read/list state and must prove source routing, disabled permission state, optimistic removal, and rollback.

## SANDWICH CONTEXT

[CRITICAL: All My Work writes must pass through `workItemMutations.ts` and the server source-aware command; the page must never call table-specific update APIs directly.]
You are implementing the single allowed My Work mutation.
Spec: `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md`
Design decision: Mark done only; full inline edit and bulk actions are out of scope.
Files in scope: mutation helper, action component, row/detail wiring, and listed tests.
Available after: T3 and T7.
Architecture rule: preserve version conflict, idempotency, and permission/mapping disabled behavior.
[RESTATE: All My Work writes must pass through `workItemMutations.ts` and the server source-aware command; the page must never call table-specific update APIs directly.]

## DELIVERABLE

Given an eligible Board/Tracker item, when Mark done succeeds, then Active removes it and All can show it as done.
Given disabled permission/mapping or conflict, when Mark done is attempted, then no incorrect source write is exposed and the UI recovers/refreshes.
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

- Existing API error code for no edit permission must be mapped without turning authorization failures into empty state.

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

1. Write failing test for: cross-workspace authorized read and source identity.
   Test file: `server/src/routes/my-work.integration.test.ts`
   Level: integration
   Test intent:
   Given a real test DB with Alice in Atlas/Orbit, assigned Board/Tracker items, unauthorized Nebula, and same-key fixtures
   When authenticated Alice requests My Work
   Then authorized items appear once, unauthorized data is absent, and per-workspace tracker-wins/composite identity holds.
   Exercise through: Express app and HTTP API boundary, not internal helpers.
   Test doubles:
   - real test PostgreSQL fixture and cookie/session auth helper
   - do NOT mock routes, Kysely, membership, assignee, or activity behavior
   Expected RED: My Work API is not mounted/implemented or does not satisfy full collaboration.

2. Run test — verify FAIL:
   `npm run test -- server/src/routes/my-work.integration.test.ts`
   Expected failure: route/fixture/assertion failure.

3. Implement integration fixtures/setup and assertions using existing `work-item-unified.integration.test.ts` and workspace fixture conventions. Keep test data isolated and deterministic.

4. Run test — verify PASS:
   `npm run test -- server/src/routes/my-work.integration.test.ts`
   Expected: authorized read and identity tests pass with a migrated test DB.

5. Write failing test for: detail reauthorization, Mark done source routing/idempotency, conflict, and unauthorized mutation rejection.
   Test file: `server/src/routes/my-work.integration.test.ts`
   Level: integration
   Test intent:
   Given item access/assignment/permission changes and Board/Tracker source fixtures
   When detail or Mark done is requested, including retry/conflict cases
   Then:
   - revoked detail returns unavailable without content
   - correct source changes and exactly one activity event is recorded
   - stale version conflicts without partial write
   - already-done retry is idempotent
   - an assignee without edit permission receives the unauthorized response and neither source table nor activity changes
   Exercise through: authenticated HTTP API.
   Test doubles:
   - real DB state transitions and cookie/session auth helper
   - do NOT mock the My Work command or route
   Expected RED: cross-unit detail/mutation/permission behavior is not yet covered.

6. Run test — verify FAIL:
   `npm run test -- server/src/routes/my-work.integration.test.ts`
   Expected failure: at least one cross-unit assertion fails before the complete implementation.

7. Implement fixtures/assertions and only the minimal test-support helpers needed for isolated workspace/auth setup.

8. Run test — verify PASS:
   `npm run test -- server/src/routes/my-work.integration.test.ts`
   Expected: read/detail/mutation/auth/idempotency/conflict scenarios pass.

9. Refactor while green:
   - Reuse existing integration fixture helpers instead of inventing a second auth/DB harness.
   - Keep the transient failure injection seam and route classification in `server/src/routes/my-work.test.ts` (T2), not this real-DB suite.
   - Re-run the integration file.

10. Commit:
    `git add server/src/routes/my-work.integration.test.ts`
    `git commit -m "test(my-work): verify server acceptance boundary"`

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

1. Write failing test for: route-to-detail-to-back state and guarded source navigation.
   Test file: `client/src/pages/MyWorkPage.integration.test.tsx`
   Level: component integration
   Test intent:
   Given a MemoryRouter, BoardContext guard state, and API fixtures
   When the user opens `/my-work`, filters/searches, opens a non-active item, closes detail, and selects Open in Board
   Then:
   - URL state survives detail/back
   - activeWorkspaceId is unchanged for global detail
   - source navigation calls existing guard and only navigates when allowed
   - blocked/canceled transition leaves list state intact
   Exercise through: route tree/page/detail/guard collaboration.
   Test doubles:
   - fake API boundary and BoardContext callbacks
   - do NOT mock My Work page/detail/navigation units under verification
   Expected RED: cross-component route behavior is not wired.

2. Run test — verify FAIL:
   `npm run test -- client/src/pages/MyWorkPage.integration.test.tsx`
   Expected failure: route/detail/guard collaboration assertions fail.

3. Implement the integration test harness and only the minimal test wrapper needed for authenticated BoardContext state.

4. Run test — verify PASS:
   `npm run test -- client/src/pages/MyWorkPage.integration.test.tsx`
   Expected: route/detail/back/guard assertions pass.

5. Write failing test for: mobile bottom sheet, whole-page transient error, Active empty state, and Mark done rollback.
   Test file: `client/src/pages/MyWorkPage.integration.test.tsx`
   Level: component integration
   Test intent:
   Given mobile viewport and API/mutation responses
   When the user opens detail, receives a transient list error, has no Active items, or marks an item done with conflict
   Then the responsive/detail/error/empty/rollback behavior matches the spec.
   Exercise through: complete My Work page surface.
   Test doubles:
   - fake API/mutation responses and viewport/container dimensions
   - do NOT mock list/detail/action collaboration
   Expected RED: one or more cross-component behaviors are not integrated.

6. Run test — verify FAIL:
   `npm run test -- client/src/pages/MyWorkPage.integration.test.tsx`
   Expected failure: missing mobile/error/mutation collaboration assertions.

7. Implement the integration test coverage and only required accessibility/test seams.

8. Run test — verify PASS:
   `npm run test -- client/src/pages/MyWorkPage.integration.test.tsx`
   Expected: all client acceptance collaboration tests pass.

9. Refactor while green:
   - Keep test wrappers local to this file; do not add production-only test flags.
   - Re-run page unit tests and this integration file.

10. Commit:
    `git add client/src/pages/MyWorkPage.integration.test.tsx`
    `git commit -m "test(my-work): verify client surface integration"`

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

### Task 11: Add My Work observability and performance verification [depends: T2, T3] [test-risk]

## OBJECTIVE

Instrument personal rollup latency/count/error telemetry and verify the p95 `<100ms` target at 10 workspaces/1,000 active items without logging task content or unauthorized identifiers.

Files:

- Create: `server/src/core/my-work-observability.ts`
- Create: `server/src/core/my-work-observability.test.ts`
- Create: `server/src/routes/my-work.performance.integration.test.ts`
- Create: `client/src/pages/MyWorkPage.performance.test.tsx`
- Modify: `server/src/routes/my-work.ts`

Steps:

1. Write failing test for: telemetry captures success, slow, unauthorized, and transient error classes without sensitive content.
   Test file: `server/src/core/my-work-observability.test.ts`
   Level: unit
   Test intent:
   Given rollup timing, authorized/unauthorized counts, source counts, and classified failures
   When the observability helper records an event
   Then the structured event contains latency/count/error class but no title, description, key, or unauthorized identifier.
   Exercise through: exported observability helper.
   Test doubles:
   - fake logger sink and deterministic timestamps
   - do NOT mock field sanitization under test
   Expected RED: helper does not exist.

2. Run test — verify FAIL:
   `npm run test -- server/src/core/my-work-observability.test.ts`
   Expected failure: missing helper or telemetry fields.

3. Implement the domain-scoped observability helper and wrap My Work list/detail route timing/error classification without changing response semantics.

4. Run test — verify PASS:
   `npm run test -- server/src/core/my-work-observability.test.ts`
   Expected: safe telemetry assertions pass.

5. Write failing test for: performance target at the approved workload.
   Test file: `server/src/routes/my-work.performance.integration.test.ts`
   Level: integration/performance
   Test intent:
   Given 10 authorized workspaces and up to 1,000 active assigned items with both sources represented
   When the warm personal rollup is requested repeatedly
   Then:
   - the measured p95 server duration is below 100ms in the controlled test environment
   - response rows remain deduplicated and authorized
   - telemetry records latency and counts without task content
   Exercise through: authenticated HTTP API and real migrated PostgreSQL fixtures.
   Test doubles:
   - real DB fixture; deterministic seed data; no mocked query path
   - do NOT mock the rollup implementation
   Expected RED: no performance fixture/telemetry target exists.

6. Run test — verify FAIL:
   `npm run test -- server/src/routes/my-work.performance.integration.test.ts`
   Expected failure: missing performance fixture, instrumentation, or p95 assertion.

7. Implement fixture setup, warm-up, repeated measurement, p95 calculation, and telemetry assertions. Keep the test isolated from unrelated suites and document DB/container prerequisites.

8. Run test — verify PASS:
   `npm run test -- server/src/routes/my-work.performance.integration.test.ts`
   Expected: controlled workload meets p95 target and telemetry assertions pass.

9. Write failing test for: client initial UI readiness under one second on a normal successful response.
   Test file: `client/src/pages/MyWorkPage.performance.test.tsx`
   Level: component performance
   Test intent:
   Given an immediate authorized active response and a normal test viewport
   When My Work mounts
   Then the first usable list/toolbar state is rendered within the spec's one-second budget.
   Exercise through: real My Work page with a deterministic fake network boundary; measure from mount to visible ready marker.
   Test doubles: fake API response only; do not mock page rendering or helpers.
   Expected RED: no explicit client readiness verification exists.

10. Run test — verify FAIL:
    `npm run test -- client/src/pages/MyWorkPage.performance.test.tsx`
    Expected failure: missing performance test/ready marker or page does not meet the assertion.

11. Implement the client readiness fixture/assertion and document the controlled environment; do not weaken the production loading behavior to satisfy the test.

12. Run test — verify PASS:
    `npm run test -- client/src/pages/MyWorkPage.performance.test.tsx`
    Expected: initial usable state meets the one-second test budget.

13. Refactor while green:
    - Keep metrics fields stable and sanitized.
    - Reuse existing latency conventions where compatible; do not log task content.
    - Re-run observability, server performance, and client readiness tests.

14. Commit:
    `git add server/src/core/my-work-observability.ts server/src/core/my-work-observability.test.ts server/src/routes/my-work.performance.integration.test.ts client/src/pages/MyWorkPage.performance.test.tsx server/src/routes/my-work.ts`
    `git commit -m "test(my-work): verify latency and observability"`

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
Available after: T2 and T3.
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

- CI hardware/database variance may require a controlled performance-test environment; report the measured environment with DONE_WITH_CONCERNS if threshold cannot be reproduced honestly.

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
| T11 | Add observability and performance verification | T2, T3 | deep | sanitized telemetry and p95 workload target |
