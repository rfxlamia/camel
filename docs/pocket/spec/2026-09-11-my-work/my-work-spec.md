# My Work

**Date:** 2026-09-11
**Status:** approved
**Author:** brainstorm session
**Spec path:** `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md`

---

## Summary

My Work is a global, authenticated page for the current user's assigned work across every workspace they belong to. It removes the need to switch the active workspace for daily triage while preserving workspace identity, Board/Tracker source identity, membership authorization, and source-aware writes.

V1 is discovery and triage focused: active-first list, status-oriented grouping, typo-tolerant search, pagination, global read detail, explicit source navigation, and one bounded mutation (`Mark done`). It does not migrate the intentional `cards` + `tracker_items` dual-table model or provide a global realtime stream.

## Context

### Current State

- `BoardContext` owns one `activeWorkspaceId`; board, presence, settings, and the existing SSE stream are scoped to it.
- `GET /workspaces/:workspaceId/work-items` is the canonical per-workspace unified read. It merges `cards` and `tracker_items` in `work-item-response.ts` and applies tracker-wins deduplication within that workspace.
- Board assignees and tracker assignees are stored in separate junction tables with indexes on `user_id`.
- `WorkItem` already contains source, key, status, priority, labels, assignees, and source-specific fields, but not global workspace display metadata.
- Existing Tracker detail and Board detail routes assume an active workspace. Existing mutation routing is source-aware and must remain so.
- Existing status semantics are not a single `done` category: `TrackerStatusCategory` values are `backlog`, `started`, `completed`, and `canceled`; status `slot` values include `backlog`, `todo`, `in_progress`, `done`, and `canceled`. Board columns use `is_done` and the existing column/status resolver.

### Problem / Motivation

A user with assignments in multiple workspaces must repeatedly switch workspaces to find and triage their own work. This creates missed-task risk and unnecessary context switching. The pitch exploration and code scan established that the current dual-table model can support a server-side personal rollup without a physical migration, provided authorization and source boundaries remain explicit.

### Related Areas

- Client: `client/src/App.tsx`, `client/src/layout/AppLayout.tsx`, `client/src/layout/sidebar/Sidebar.tsx`, `client/src/layout/sidebar/MobileNav.tsx`, `client/src/layout/sidebar/navItems.ts`, `client/src/api.ts`, `client/src/types.ts`, `client/src/context/BoardContext.tsx`, Tracker row/detail components.
- Server: `server/src/routes.ts`, `server/src/routes/work-items.ts`, `server/src/routes/tracker-items.ts`, `server/src/routes/work-item-response.ts`, `server/src/routes/workspaces.ts`, `server/src/middleware/workspace.ts`, assignee helpers, and existing status-change services.
- Contracts: `docs/pocket/adr/2026-09-board-tracker-dual-table.md`, `docs/pocket/spec/2026-08-31-board-tracker-unified-view/unified-view.md`, and `docs/pocket/spec/2026-09-work-items-api-addendum.md`.
- Tests: existing unified work-item integration tests, Tracker page/detail/row tests, assignee tests, workspace access tests, status mapping tests, and concurrency tests.

## Scope

### In-Scope

- Authenticated global `/my-work` route and primary navigation entry independent of the active workspace.
- Server-side rollup of Board cards and Tracker items assigned to the current user from authorized memberships.
- Workspace/source metadata and composite identity on every row.
- `Active` and `All` scopes; Active excludes `completed` and `canceled` categories, while unknown categories remain visible under `Other`.
- Status-oriented grouping with workspace/source badges and workspace/source filters.
- Ordering by status group first, then overdue, due date, and stable updated-time tie-breakers within each group.
- Workspace-timezone-aware overdue behavior; due today is not overdue until the local workspace day ends.
- Key/title/description search, URL-persisted view state, 50-item rendered pages, and Fuse.js fuzzy ranking for the bounded active set.
- All-scope server-backed pagination/search across active, completed, canceled, and Other items.
- Global read/detail panel or bottom sheet that does not change `activeWorkspaceId`.
- Explicit `Open in Board` / `Open in Tracker` transition using existing workspace and focus/unsaved-edit guards.
- `Mark done` as the only V1 mutation, with membership/assignment reauthorization, canonical source mappings, version conflicts, rollback/refresh, and idempotent retry.
- Reauthorization on detail and mutation requests; unauthorized workspaces are excluded without data leakage.
- Whole-page error state for transient/5xx/timeout failures, retry, visibility/manual refresh, stale-response protection, mobile responsive list, and bottom-sheet detail.
- Unit, route/integration, component, mutation-routing, performance, and observability tests.

### Out-of-Scope

- Migrating `cards` and `tracker_items` to a physical `work_items` table — the dual-table shim is intentional and sufficient for this feature.
- Full inline editing, bulk actions, reassignment, and arbitrary cross-workspace writes — they require a broader write orchestration surface.
- User-level SSE or a guaranteed global realtime stream — V1 uses initial load plus visibility/manual refresh.
- Cross-workspace reporting, calendar, roadmap, and analytics — those require a different read model.
- Tasks created by the user but not assigned to them — the product scope is `assigned to me`.
- Silent workspace switching — all source-context transitions must be explicit and guarded.
- Client-side filtering as an authorization boundary — the server remains authoritative.

## Architecture Constraints

- **Layers this work may touch:** authenticated server read routes/services, the existing unified response/serialization layer, client API/types, global client routing/navigation, a new My Work page/detail surface, and tests.
- **Layers this work must NOT touch:** physical table consolidation, unrelated Board/Tracker mutation semantics, active-workspace SSE contract, or direct client-to-database access.
- **Patterns that must be followed:** server-side membership and assignment authorization; set-based queries and batched hydration; per-workspace tracker-wins deduplication; source-aware `workItemMutations.ts`; optimistic version handling; NodeNext `.js` server imports; client bundler imports; Biome; root `npm run test`.
- **Status mapping:** normalize existing `category`/`slot` semantics into UI groups. Do not introduce a new global status category solely for My Work.
- **Done mapping:** reuse existing Board `is_done`/position resolver and Tracker `slot="done"` vocabulary. A deterministic canonical target is required; no valid target means Mark done is disabled.
- **Authorization:** membership and assignment are rechecked at mutation time. Revoked membership or removed assignment returns the existing 404/Not found behavior without a source write or activity. `canMarkDone` is disabled only for missing done mapping, terminal state, or a pending mutation.
- **Architecture validation result:** CONDITIONAL PASS, with the status normalization, existing done-mapping reuse, and Active-vs-All retrieval rules above treated as mandatory mitigations.

## Dependencies

### Existing (to leverage)

- `react-router@^7.18.2` — global `/my-work` route, URL query state, and deep-linkable global detail.
- `lucide-react@^1.17.0` — navigation icons, status/action affordances, and responsive controls.
- React 18 and existing client context/API patterns — page state and request boundary.
- `kysely@^0.29.2` and `pg@^8.13.1` — set-based membership, assignee, card, and tracker queries.
- Existing `work-item-response.ts` serializers and assignee loaders — unified source fields and batched hydration.
- Existing version/conflict, workspace guard, Board status resolver, Tracker status resolver, and activity logging paths.
- Vitest and existing client/server test harnesses — unit, component, route, integration, and concurrency coverage.

### New (proposed)

- `fuse.js@^7.5.0` — typo-tolerant ranking over the bounded active assigned set using key/title/description fields and a result limit. A custom fuzzy matcher is rejected because it would hand-roll a commodity search algorithm; server-only exact search is rejected because it does not satisfy the user's mistype-tolerant triage goal.

## Stories + Scenarios

### Story: Load authorized assigned work

> As a signed-in user with multiple workspace memberships, I want one list of work assigned to me, so that I can triage without switching workspaces.

**Rule 1: Membership and assignment are server-side boundaries.**

- Example A: Alice (`userId=42`) belongs to Atlas (`workspaceId=7`) and Orbit (`workspaceId=12`), but not Nebula (`workspaceId=19`). Atlas has assigned Board card `AT-17`; Orbit has assigned Tracker item `OR-4`; Nebula has assigned `NB-9`.
- Example B: A work item with several assignees appears once when Alice is one of them.

```gherkin
Scenario: Load assigned active work across authorized workspaces
  Given Alice is a member of Atlas and Orbit but not Nebula
  And AT-17 is an active Board card assigned to Alice
  And OR-4 is an active Tracker item assigned to Alice
  And NB-9 is assigned to Alice in Nebula
  When Alice opens My Work with scope=active
  Then AT-17 and OR-4 are listed
  And NB-9 is not present
  And every row identifies its workspace and source

Scenario: Include a multi-assignee item once
  Given OR-7 has Alice and Bob as assignees
  When Alice opens My Work
  Then OR-7 appears exactly once
```

**Rule 2: Global identity is composite.**

```gherkin
Scenario: Preserve same keys in different workspaces
  Given key AT-17 exists in Atlas and key AT-17 exists in Orbit
  When My Work loads
  Then they remain two distinct rows identified by workspace and source

Scenario: Tracker wins an in-workspace collision
  Given a card and tracker item share key number 17 in Atlas
  When My Work loads
  Then the existing tracker-wins rule applies within Atlas
  And the same key number in Orbit remains independent
```

### Story: Triage active and historical work

> As a user doing daily triage, I want active work prioritized and historical work available on demand, so that completed work does not bury what needs attention.

**Rule 1: Scope and grouping use existing status semantics.**

- `completed` and `canceled` categories are excluded from Active.
- `backlog` and `started` categories are active; unknown/null categories remain visible under Other.
- UI labels may say Backlog, In progress, Done, Canceled, and Other; the API preserves the existing category/slot values.

```gherkin
Scenario: Active hides terminal categories
  Given AT-17 has category started
  And OR-5 has category completed
  And OR-6 has category canceled
  When Alice views My Work with scope=active
  Then AT-17 is visible
  And OR-5 and OR-6 are hidden

Scenario: All includes terminal and unknown work
  Given OR-5 is completed, OR-6 is canceled, and OR-9 has an unknown category
  When Alice changes scope to all
  Then OR-5, OR-6, and OR-9 are visible
  And OR-9 is grouped under Other

Scenario: Status groups take precedence over urgency
  Given AT-17 is overdue in the started group
  And OR-4 is due sooner in the backlog group
  When Alice opens My Work
  Then groups remain ordered by status-group order
  And items within each group are ordered by overdue, due date, and stable tie-breakers
```

### Story: Search, ordering, pagination, and view state

> As a user triaging many assignments, I want fast, typo-tolerant search and stable pagination, so that I can find the right task without scanning every workspace.

**Rule 1: Active search is local and bounded.**

```gherkin
Scenario: Prioritize overdue and soon-due work
  Given the test date is 2026-09-11 in the workspace timezone
  And AT-17 is overdue with due date 2026-09-10
  And OR-4 is due on 2026-09-12
  And AT-19 has no due date and was updated after OR-4
  When Alice opens My Work with scope=active
  Then AT-17 appears first within its group
  And OR-4 appears before AT-19 within its group

Scenario: Active fuzzy search finds a typo-tolerant match
  Given the active assigned set contains OR-22 titled “Image upload retry"
  When Alice searches for “imgae uplod"
  Then OR-22 is included in the Fuse.js ranked results

Scenario: Render active work in pages of 50
  Given Alice has 73 active assigned items
  When My Work loads
  Then the active set is available for local ranking
  And the first rendered page contains 50 items
  And the remaining 23 items are reachable through pagination
```

**Rule 2: All search covers all status categories without an unbounded client payload.**

```gherkin
Scenario: All search finds terminal work
  Given OR-5 is completed and its title matches the search intent
  When Alice searches in scope=all
  Then OR-5 can appear alongside active, canceled, and Other items
  And the result remains server-paginated at 50 rendered items per page

Scenario: Preserve view state through navigation
  Given My Work has scope=active, a workspace filter, a search query, and page=2 in the URL
  When Alice opens global detail and presses Back
  Then the scope, filter, query, and page are restored
```

**Rule 3: Overdue uses workspace timezone.**

```gherkin
Scenario: Due today is not overdue before the local day ends
  Given Atlas timezone is Asia/Jakarta
  And AT-17 is due on the current Atlas local date
  When the local day has not ended
  Then AT-17 is not marked overdue

Scenario: Due today becomes overdue after the local day ends
  Given AT-17 remains incomplete after the Atlas local day ends
  When My Work refreshes
  Then AT-17 is marked overdue within its existing status group
```

### Story: Global detail and explicit source navigation

> As a user, I want to inspect an assigned item without losing my current context, so that I can decide whether to enter its source workspace.

**Rule 1: Global detail never silently changes the active workspace.**

```gherkin
Scenario: Inspect an item without changing active workspace
  Given Alice is currently in Orbit
  And AT-17 belongs to Atlas
  When Alice selects AT-17 in My Work
  Then a global read/detail panel or bottom sheet opens
  And Orbit remains the active workspace
  And Atlas and Board are shown as the item's context

Scenario: Reauthorize stale detail access
  Given AT-17 was visible before Alice lost Atlas membership
  When Alice opens its global detail afterward
  Then the server reauthorizes the request
  And the detail shows unavailable without cached task content
```

**Rule 2: Source navigation is explicit and guarded.**

```gherkin
Scenario: Open source context through the existing guard
  Given AT-17 belongs to Atlas
  And Alice has no blocking unsaved edit or focus session
  When Alice selects Open in Board and confirms the transition
  Then Atlas becomes the active workspace
  And the existing Board detail route opens for AT-17

Scenario: Preserve state when the switch guard blocks
  Given Alice has an active focus session or unsaved card edits in Orbit
  When she selects Open in Board for AT-17 in Atlas
  Then the existing block/confirmation behavior is shown
  And My Work does not discard state or bypass the guard
```

### Story: Mark done as a bounded, source-aware action

> As a user assigned to an active item, I want to mark it done from My Work, so that daily triage can finish work without opening every workspace.

**Rule 1: Reauthorization and canonical mapping are required.**

- Board target: existing `is_done` column resolver, deterministic by existing column ordering.
- Tracker target: workspace status with `slot="done"`, deterministic by position/id.
- If no valid target exists, Mark done is disabled.

```gherkin
Scenario: Membership revocation blocks Mark done
  Given AT-17 was visible while Alice belonged to Atlas
  And Alice is removed from Atlas before Mark done is submitted
  When Alice selects Mark done
  Then the server returns HTTP 404 with the existing Not found behavior
  And no card update or activity is recorded

Scenario: Assignment removal blocks Mark done
  Given AT-17 was visible while Alice was assigned to it
  And Alice is removed from AT-17 before Mark done is submitted
  When Alice selects Mark done
  Then the server returns HTTP 404 with the existing Not found behavior
  And no card update or activity is recorded

Scenario: Mark a Board card done
  Given AT-17 is an active Board card in Atlas
  And Alice remains an authorized workspace member and assignee
  And Atlas has a valid done column mapping
  When Alice selects Mark done
  Then the existing source-aware Board status path moves AT-17 to the done column
  And the Active view removes AT-17 after success
  And exactly one activity event is recorded

Scenario: Mark a Tracker item done
  Given OR-4 is an active Tracker item in Orbit
  And Alice remains an authorized workspace member and assignee
  And Orbit has a status with slot="done"
  When Alice selects Mark done
  Then OR-4 receives the canonical done status
  And the Active view removes OR-4 after success
  And exactly one activity event is recorded

Scenario: Mark done is unavailable without a mapping
  Given a workspace has no valid done column or slot="done" status
  When Alice views an assigned item in that workspace
  Then Mark done is disabled
  And the UI explains that no done mapping is configured
```

**Rule 2: Mark done is conflict-safe and idempotent.**

```gherkin
Scenario: Resolve a stale Mark done write
  Given Alice optimistically marks AT-17 done
  And another user updates AT-17 before the write completes
  When the server returns the existing version-conflict response
  Then the optimistic change is rolled back
  And the latest item is refreshed
  And Alice sees a warning that the item changed elsewhere

Scenario: Reject a stale tracker write
  Given OR-4's status changes before Alice's Mark done write completes
  When the server detects the stale version
  Then the write is rejected
  And My Work rolls back and refreshes OR-4

Scenario: Retry an uncertain commit without duplicate activity
  Given Mark done may have committed AT-17 but its response timed out
  When the client retries the same intent
  Then the operation succeeds if AT-17 is already at the canonical target
  And exactly one activity event exists

Scenario: Do not partially write after a mapping race
  Given the canonical done target is removed after the page loads
  When Alice selects Mark done
  Then no partial source write occurs
  And the optimistic state is restored
  And the item is refreshed with a clear failure message
```

### Story: Failure, refresh, and responsive behavior

> As a user, I want predictable failure and refresh behavior, so that I never mistake incomplete data for a complete personal work list.

**Rule 1: Fail closed for transient list failures, but drop revoked access.**

```gherkin
Scenario: Fail the whole page for a transient workspace error
  Given Atlas data loads successfully
  And Orbit data encounters a timeout or 5xx failure
  When Alice opens My Work
  Then the page shows an error state instead of a partial list
  And Alice can retry the complete query

Scenario: Drop an unauthorized workspace without leakage
  Given Orbit is no longer authorized when the rollup executes
  When Alice opens My Work
  Then Orbit contributes no rows or task metadata
  And the remaining authorized results may be shown

Scenario: Distinguish expired auth from empty work
  Given Alice's session has expired
  When the personal rollup is requested
  Then the app shows the existing authentication/session error
  And it does not show an empty-state message
```

**Rule 2: Refresh is newest-request-wins and removes stale assignments.**

```gherkin
Scenario: Remove work after access or assignment changes
  Given AT-17 is visible in My Work
  And Alice is removed from Atlas or AT-17 is no longer assigned to Alice
  When My Work refreshes after visibility returns
  Then AT-17 is no longer listed
  And no Atlas detail data is exposed

Scenario: Discard an older refresh response
  Given refresh request R1 starts before refresh request R2
  And R2 completes before R1
  When R1 finally completes
  Then the UI keeps R2's result and discards R1

Scenario: Keep mutation results ahead of an in-flight refresh
  Given Mark done succeeds while an older refresh is still running
  When the older refresh response arrives
  Then the item does not reappear incorrectly
  And the latest mutation state remains authoritative
```

**Rule 3: Mobile keeps the same behavior with a compact surface.**

```gherkin
Scenario: Use the mobile detail surface
  Given Alice opens My Work on a 390px-wide viewport
  When she selects an item
  Then rows use a responsive stacked layout
  And global detail opens as a bottom sheet
  And key, status, workspace/source context, action, and close control remain usable
```

## Acceptance Criteria

```text
Rule: Authorized personal rollup
  ✓ Given a user belongs to Atlas and Orbit but not Nebula, When My Work loads, Then only assigned items from Atlas and Orbit appear.
  ✓ Given an item has multiple assignees including the current user, When My Work loads, Then it appears exactly once.
  ✓ Given same keys exist across workspaces, When My Work loads, Then composite workspace/source identity keeps them distinct.
  ✗ Given an item is not authorized by current membership, When it is requested, Then no item metadata is returned.

Rule: Active/All and status normalization
  ✓ Given categories completed and canceled, When scope=active, Then those items are hidden.
  ✓ Given category is null/unrecognized, When My Work loads, Then the item remains under Other.
  ✓ Given scope=all, When search runs, Then terminal and Other items are eligible.

Rule: Ordering, search, and pagination
  ✓ Given an item is overdue, When its status group is rendered, Then it precedes non-overdue items in that group.
  ✓ Given due date is today, When the workspace local day has not ended, Then the item is not overdue.
  ✓ Given an active title contains “Image upload retry”, When the user searches “imgae uplod”, Then Fuse.js returns it in the active result set.
  ✓ Given 73 active items, When the page renders, Then 50 items are shown and 23 remain reachable through pagination.
  ✓ Given URL query state exists, When detail is closed or Back is used, Then the state is restored.

Rule: Global detail and source navigation
  ✓ Given an item belongs to a non-active workspace, When its row is selected, Then global detail opens without changing activeWorkspaceId.
  ✗ Given access is revoked before detail opens, When detail is requested, Then unavailable is shown without cached task content.
  ✓ Given source navigation is selected, When no guard blocks it, Then the existing workspace switch guard and source detail route are used.

Rule: Mark done
  ✓ Given membership/assignment remains valid and a Board done mapping exists, When Mark done is selected, Then the card uses the existing Board status path and one activity event is recorded.
  ✓ Given membership/assignment remains valid and a Tracker `slot=done` mapping exists, When Mark done is selected, Then the tracker item receives that status and one activity event is recorded.
  ✗ Given membership or assignment was revoked, When Mark done is selected, Then HTTP 404/Not found returns without a source write or activity.
  ✗ Given no valid done mapping, terminal state, or pending mutation, When Mark done is selected, Then the action is disabled or rejected without a source write.
  ✗ Given a stale version, When Mark done is submitted, Then the write conflicts, optimistic state rolls back, and the item refreshes.
  ✓ Given a commit succeeded but response timed out, When the same intent is retried, Then it is idempotent and does not duplicate activity.

Rule: Failure and freshness
  ✗ Given a transient timeout/5xx in any workspace query, When My Work loads, Then the whole page shows retryable error rather than a partial list.
  ✓ Given a workspace is unauthorized, When the rollup runs, Then it contributes no data while authorized results may remain.
  ✓ Given two refreshes race, When the older response arrives last, Then it is discarded.
  ✓ Given the page regains visibility, When refresh runs, Then stale/unassigned work is removed.

Rule: Performance and observability
  ✓ Given 10 workspaces and 1,000 active assigned items, When the personal rollup runs, Then server p95 is below 100ms.
  ✓ Given a normal connection, When My Work first opens, Then the initial UI is ready within 1 second.
  ✓ Given success, slow, unauthorized, or failed requests, When telemetry is emitted, Then it includes latency/count/error class without task content or unauthorized identifiers.
```

## Design Decision

**Chosen option:** Option A — Server-side personal rollup + global detail.

**Summary:** Use one authenticated personal read boundary over the existing dual-table model, add a global My Work route above workspace/mode navigation, use Fuse.js for the bounded Active set, keep All server-paginated, and expose only a source-aware Mark done command with membership/assignment reauthorization. Global detail never changes the active workspace; source navigation is explicit and guarded.

**Rejected options:**

- **Option B — server aggregator over existing workspace endpoints:** rejected for production because per-workspace calls create N+1 database work, weaken the p95 target, complicate failure semantics, and repeat merge/hydration logic.
- **Option C — persistent personal-work projection:** deferred because it adds synchronization/invalidation and stale-authorization risk without being necessary for the V1 daily-triage problem.

**Key tradeoffs accepted:**

- Active work may be loaded as a bounded set for better Fuse.js ranking; the 1,000-item target and observability guard the payload.
- All/history search is server-paginated and may use a candidate window for client ranking; complete fuzzy ranking over unbounded history is deferred.
- Mark done adds a narrow cross-surface command boundary, but full editing and bulk actions remain excluded.
- Visibility/manual refresh is less immediate than user-level SSE but avoids expanding realtime infrastructure in V1.

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
| ---------- | ------------ | --------------- |
| How should All-scope fuzzy ranking cover unbounded history? | Assumption: server returns all-status candidates in 50-item pages; Fuse.js ranks the loaded/candidate window. | A typo may miss a result outside the candidate window; a later server fuzzy/indexed search may be needed. |
| What is the exact global detail route shape? | Assumption: a URL-addressable `/my-work` detail state carries workspace id, source, and key; implementation may use a nested route or query state. | Deep-link/back-navigation tests and component boundaries may change. |
| What makes a done target canonical when multiple targets exist? | Assumption: reuse existing Board `is_done` position resolver and choose Tracker `slot=done` by deterministic position/id; no new setting. | User-configured ordering may not match the preferred completion destination. |
| Which conditions disable the Mark done control before a request? | Resolved: missing done mapping, terminal state, or pending mutation; membership and assignment are enforced server-side at request time. | A stale UI state may show an enabled action, but the server must still return 404/Not found without writing. |
| How often should visibility refresh run? | Resolved for V1: initial load plus visibility/manual refresh; no guaranteed periodic/global SSE. | A user may see changes from another workspace later than expected. |

## Implementation Notes

- Add My Work to the global navigation section above the Kanban/Agent mode switcher; keep it visible in collapsed desktop and mobile navigation.
- Store scope, query, workspace/source filters, page/cursor, and detail selection in URL query/route state.
- Keep the existing `activeWorkspaceId` untouched while loading or inspecting My Work.
- Use one set-based personal query path per source with membership and assignee predicates; do not call the existing per-workspace list endpoint in a loop.
- Return workspace display metadata and composite identity in the personal response without breaking existing `WorkItem` consumers.
- Preserve tracker-wins dedup per workspace, soft-delete filters, and batch assignee/label hydration.
- Route all client mutations through `client/src/lib/workItemMutations.ts`; do not call update APIs directly from the new page.
- Mark done must reuse existing status mapping and activity logging, return the existing version-conflict semantics, and treat an already-completed target as an idempotent success without a second activity event.
- Add `fuse.js@^7.5.0` only after confirming package lock update and bundle impact; configure explicit keys and a bounded result limit.
- Test with `npm run test` from the repository root. Run `npm run check:mutation-routing`, `npm run typecheck`, and the server key-collision check when `DATABASE_URL` is available.
- Add structured latency/count/error telemetry without task titles, descriptions, or unauthorized identifiers.

## Rollback Plan

- Hide/remove the My Work navigation entry and route while leaving existing Board and Tracker surfaces untouched.
- Disable the Mark done control if its command path produces incorrect writes; existing Board/Tracker mutation paths remain available.
- Revert the additive server/client commit; no physical schema migration or data backfill is required.
- If Fuse.js causes bundle or ranking problems, temporarily use the server candidate result ordering while retaining the same read contract and URL state.
