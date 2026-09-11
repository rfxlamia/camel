# Pitch Exploration: my-work

Date: 2026-09-11 | Project: camel-kanban | Status: pitch-only

---

## Problem Statement

Users who belong to multiple workspaces cannot see all work items assigned to them in one place. They must switch the active workspace repeatedly, while board cards and tracker items carry different source, route, and mutation semantics.

My Work should provide a global, authenticated view of the current user's assigned work across every workspace they belong to, without weakening workspace boundaries or hiding the item's original context.

## Root Tension

Personal triage needs a global user scope, while authorization, detail routes, realtime streams, and writes remain workspace-scoped and source-aware across the intentional `cards` + `tracker_items` dual-table shim.

## Key Constraints

- The scope is `assigned to me`: an item is included when the signed-in user is an assignee.
- Only workspaces returned by the user's memberships may contribute items; workspace membership is a security boundary.
- The current product supports up to 10 workspaces per user.
- The canonical unified read layer already merges board cards and tracker items per workspace.
- The dual-table model is intentional; this feature must not require a `work_items` migration.
- Unified identity must include workspace and source; a key alone is ambiguous across workspaces.
- Reads may be global, but writes must remain workspace-scoped and route through source-aware mutation rules.
- Board cards and tracker items use separate assignee junction tables, both indexed by `user_id`.
- Live rows must exclude soft-deleted cards and tracker items.
- Existing SSE subscriptions follow the active workspace only; global realtime requires an explicit later decision.
- Existing UI authority is Work Sans, 6px base radius, calm navy/blue OKLCH tokens, and structured Notion/Linear-inspired density.

---

## Brainstorming Methods Used

### Question Storming — deep

Key insights:

- “Assigned to me” must include multi-assignee items while preserving the distinction between assignee, creator, and workspace member.
- Active versus completed work needs an intentional default; showing the full archive first would bury current work.
- Workspace and source must remain visible because similar keys and titles can exist in different contexts.
- Opening an item must define whether it stays in a global detail surface or explicitly enters its source workspace.
- Cross-workspace loading, partial failures, and realtime changes are product behavior, not only implementation details.

### First Principles Thinking — creative

Key insights:

- The core job is reducing context switching, not replacing Board or Tracker.
- The natural data unit is the existing unified `WorkItem`, enriched with workspace identity.
- The personal scope is an assignee relationship to the current user, not the active workspace or item creator.
- Global reads and workspace-scoped writes are compatible if navigation and mutation boundaries are explicit.
- A scannable row must answer “what is it, where is it, and what state is it in?” before showing secondary metadata.

### Solution Matrix — structured

Key dimensions explored:

- Server-side global query versus client fan-out versus a persistent projection.
- Flat status-oriented list versus workspace grouping versus user-selected grouping.
- Global primary navigation versus Tracker sub-surface versus workspace switcher shortcut.
- Active-first scope versus all-history default.
- Read/navigation-first behavior versus inline edits versus full mutation support.

The strongest combination is a server-side global read, global primary navigation, active-first status-oriented list, and explicit source-workspace entry for deep edits.

### Reverse Brainstorming — creative

Key failure modes:

- Hide workspace identity and make similar tasks indistinguishable.
- Reuse `activeWorkspaceId` silently for a global result, causing incorrect routes or writes.
- Merge board and tracker data without preserving `source`.
- Fan out one request per workspace without bounded loading and partial-error handling.
- Show all completed and canceled items before active work.
- Use key alone as identity across workspaces.
- Add inline editing before cross-table mutation orchestration is ready.

The preventive principles are explicit workspace/source metadata, active-first filtering, server-side authorization, source-aware navigation, and graceful partial failure handling.

---

## Advisor Synthesis

The advisor identified context switching as the true problem and separated global user scope from workspace scope. The strongest pattern is global read with workspace-scoped writes: workspace should be visible metadata and a filter, not the primary grouping that recreates the old navigation model. V1 should prioritize discovery and triage; fan-out and full inline editing were discarded because they increase partial-failure, dual-table, and optimistic-locking risk.

---

## Spike Results

**Unknown resolved:** Can an assigned-to-me cross-workspace read be implemented safely and efficiently on the current dual-table model without a migration?

**Finding:** Yes for a V1 read surface, with a new set-based server-side query. `workspace_members` supports lookup by `(user_id, workspace_id)`, both `card_assignees` and `tracker_item_assignees` have `user_id` indexes, and both physical item tables already expose live-row filters. Existing batch hydration helpers can be reused. The current per-workspace `listMergedWorkItems()` must not be called once per workspace; the global read needs one bounded query path per source and per-workspace tracker-wins dedup.

**Implication:** A new personal rollup can remain a read-layer adapter over the existing tables. It must add workspace metadata and compound identity, preserve source-aware navigation, and keep writes on the existing workspace-scoped paths. Existing active-workspace SSE does not cover the global surface; V1 needs explicit refresh/polling behavior or a later user-level event stream. Actual p95 latency should be measured after implementation, with the ADR's 100ms threshold as the review trigger.

---

## Directional UX Shape

The recommended experience is a global **My Work** page. It appears as a primary sidebar item above the Kanban/Agent mode switcher, so it is visibly independent of the selected workspace. On mobile it is the first authenticated navigation destination.

The page opens with an `Active / All` scope control, search, workspace filter, source filter, and a compact count such as “8 active tasks across 3 workspaces.” The default list is grouped by portable status category (`In progress`, `Todo`, `Backlog`, `Done`) rather than workspace. Each row shows key, title, status, workspace badge, source badge, project or board-column context, assignee state, and due date where available.

A row can open a global read/detail panel without changing the active workspace. A deliberate `Open in Board` or `Open in Tracker` action enters the original workspace context and makes that transition visible. V1 is discovery/triage-first: search, filters, status-oriented scanning, and safe navigation are in scope; full inline editing and bulk mutation are deferred.

---

## Approach Directions

### Direction A: Server-side personal rollup

Add a dedicated authenticated read direction for the current user's assigned work across all member workspaces, while keeping existing workspace-scoped detail and mutation paths. Present the result as a global My Work page with active-first filtering, status-oriented grouping, workspace/source badges, and explicit source-workspace navigation.

- Best fit for reducing context switching while preserving authorization and the dual-table boundary.

- Requires a new cross-workspace read contract and an explicit decision about global detail versus source-workspace transition.

### Direction B: Client fan-out over existing workspace endpoints

Load the user's workspaces in the client, request each workspace's existing unified list, and merge/filter the results locally.

- Fastest throwaway experiment and reuses existing workspace APIs.

- Creates N requests, partial loading states, duplicated merge logic, larger payloads, and no clean solution for global realtime or detail routing.

### Direction C: Persistent global projection

Introduce a durable read projection or database view for cross-workspace personal work, leaving the physical board and tracker tables as write sources.

- Strongest future foundation for global search, reporting, calendar views, and user-level realtime.

- Premature for the initial need; adds synchronization/invalidation complexity and does not remove source-aware writes.

---

## Open Questions for pocket-grinding

- [ ] Should the first click open a global read/detail panel, or should it offer only an explicit “Open in workspace” action?
- [ ] How should workspace-specific status vocabularies map into portable status categories and ordering?
- [ ] What is the default ordering within each status group: due date, updated time, position, or a user preference?
- [ ] What refresh contract is acceptable for V1 while SSE remains active-workspace scoped?
- [ ] What result limit, pagination, and search behavior keep the global list within the existing latency budget?
- [ ] Which safe triage actions, if any, should be enabled before full cross-workspace mutation orchestration exists?

---

## Recommended Direction

**Direction A — Server-side personal rollup.** It directly addresses the confirmed context-switching problem, uses existing assignee indexes and unified serialization patterns, respects the intentional dual-table architecture, and keeps the first release focused on global discovery and safe navigation rather than risky cross-workspace writes.

---

## Handoff Context (for pocket-grinding)

When pocket-grinding reads this document:

- Start with the Problem Statement and the confirmed `assigned to me` scope.
- Use Direction A as the working hypothesis for design proposals.
- Treat the Open Questions as discovery targets, especially detail navigation, status normalization, refresh behavior, and result ordering.
- Preserve the global-read/workspace-scoped-write boundary.
- Do not treat the Approach Directions or Directional UX Shape as final architecture; validate them through GWT scenarios first.
