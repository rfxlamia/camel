# Tracker Row Inline Property Editing

**Date:** 2026-08-28
**Status:** approved
**Author:** pocket-grinding session
**Spec path:** docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md

---

## Summary

Tracker rows (`TrackerRow.tsx`) currently only allow status to be changed inline — every other property (date range, project, phase, priority, assignee, label) requires opening `TrackerDetailPage`. This spec makes all six of those properties editable directly from the row, reusing the picker components and mutation path the detail page already proves out, without reversing the calm/decluttered row density shipped five days ago (`docs/pocket/spec/2026-08-26-tracker-page-declutter`).

---

## Context

### Current State

`TrackerRow.tsx` renders: priority glyph (display-only, hidden `<sm`), key, status (the only inline picker, via `TrackerPropertyPicker`), title, project chip (display-only, omitted when grouped by project or when the item has no project), labels (display-only, hidden `<sm`), assignee avatars (display-only, hidden `<md`), and a date column currently showing `createdAt` (hidden `<lg`, with a standing `TODO: due date preference on date column`).

`TrackerDetailPage.tsx` already implements every needed editing pattern: `TrackerPropertyPicker` for single-select (status, priority, project, phase) and multi-select with toggle patches (assignee, label, via `TrackerProperties.tsx`'s `assigneeToggle`/`labelToggle`); `TrackerDateFields` for start/end date entry; `resolvePropertyPatch` for computing toggle diffs against `itemRef.current`; `enqueueMutation` for sequential per-item mutation chaining.

`TrackerPage.tsx` fetches `statuses`, `priorities`, `projects` (with nested `phases`) eagerly in one `Promise.all` inside `loadData()`. It does not fetch `labels` or workspace `members`.

Status changes in `TrackerPage.tsx` (`changeStatus`) use an optimistic-update + version-checked pattern: update local state immediately, call `api.updateTrackerItem(workspaceId, key, { statusId, version: item.version })`, and on `409 version_conflict` revert + toast "Someone else updated this item first — refreshed." + `loadData()`. This handler also has a no-op guard (skip if `statusId === item.status.id`) and auto-uncollapses the destination status group if the change would move the row into a collapsed section.

### Problem / Motivation

Row space is wide enough, and the picker components already exist, but every property except status forces a detail-page round-trip to edit — confirmed directly from the user's own workflow complaint and screenshots (see `docs/pocket/spec/2026-08-27-tracker-row-inline-edit/pitch-exploration.md`).

### Related Areas

- `client/src/components/tracker/TrackerRow.tsx` — row rendering, new picker triggers, new per-row "which picker is open" state
- `client/src/components/tracker/TrackerRowShell.tsx` — overlay-button-behind-content nesting pattern every new trigger must follow
- `client/src/pages/TrackerPage.tsx` — new `labels`/`members` fetches, shared per-item mutation queue + per-item live-state ref, group auto-uncollapse extension
- `client/src/components/tracker/TrackerPropertyPicker.tsx`, `TrackerDateFields.tsx` — reused as-is, no changes
- `client/src/components/tracker/TrackerProperties.tsx`, `client/src/pages/TrackerDetailPage.tsx` — reference implementations for toggle-patch resolution and mutation queuing, ported (not modified)
- `server/src/routes/tracker-items.ts` — verified (not modified) to already accept `projectId`+`phaseId`+`startDate`+`endDate`+`assigneeIds`+`labelIds`+`statusId`+`priorityId` combined in one PATCH body, with `version` optimistic locking covering the combined write

---

## Scope

### In-Scope

- Inline edit from the row for: due-date range (`startDate`/`endDate`), project, phase, priority, assignee (multi), label (multi)
- Project and phase chips always render in the row — including when grouped by project, and as a "Set project" / "Set phase" placeholder when unset — replacing today's conditional omission
- New `labels` + `members` fetches in `TrackerPage`, each isolated in its own try/catch, degrading to `[]` on failure (never blanking the whole list)
- A shared per-item mutation queue: every field mutation for a given item (status, date, project, phase, priority, assignee-toggle, label-toggle) funnels through one sequential per-item queue that reads the item's latest settled state before firing the next queued mutation — replacing status's current "latest wins, drop older picks" behavior
- No-op guards on re-picking an already-current value for project, phase, priority, and the date popover (closing without any change) — skip the mutation entirely, no PATCH sent
- Auto-uncollapse of the destination group when an inline project or priority change moves a row into a currently-collapsed group (grouped-by-project / grouped-by-priority views), matching status's existing behavior
- A kebab (⋯) menu below the `lg` (1024px) breakpoint, always listing all 6 editable properties with graceful empty-states (never conditionally hidden), as the mobile/narrow-viewport path to every field
- A single "which picker is open" state per row, scoped per-row, covering every trigger including the kebab panel

### Out-of-Scope

- Description editing from the row — stays detail/create-only, per the user's own framing (needs room to write, doesn't fit a row)
- Bulk/multi-row edit — natural follow-on, not this pass
- Any new mutation endpoint or path bypassing `api.updateTrackerItem` — server route already supports every needed field combination
- Changes to `TrackerProjectsTab.tsx` — row work reads the same `projects` state `TrackerPage` already loads, no duplication into the projects tab
- Redesigning the status picker's visual/UI — only its mutation-queue plumbing changes, its glyph/picker component is untouched
- Board/Card entities — the new per-item mutation queue is Tracker-item-only, must not be generalized into or share code with Board/Card's optimistic-locking path
- A pending/saving visual indicator for queued mutations — flagged as a nice-to-have by edge-case review, not required for this pass (see Open Questions)

---

## Architecture Constraints

- Layers this work may touch: `client/src/components/tracker/*`, `client/src/pages/TrackerPage.tsx`, `client/src/api.ts` (only if patch typing needs extending — verify against existing `PropertyPatch`/`ItemPropertyPatch` types first)
- Layers this work must NOT touch: `server/src/routes/tracker-items.ts` mutation/validation logic, Board/Card code
- Patterns that must be followed: `TrackerPropertyPicker` (single + `multiple` modes), `TrackerDateFields`, version-checked `api.updateTrackerItem`, `TrackerRowShell`'s overlay-button-behind-content nesting (every new trigger isolates its own click event so it never also triggers row navigation)
- Architecture validation result: **PASS** (see Phase 6 checklist in pitch/grinding session — no server changes, no new dependencies, no security regressions, reversible client-only change)

---

## Dependencies

### Existing (to leverage)
- `TrackerPropertyPicker` — every list-pick field (project, phase, priority, assignee, label) reuses this component as-is
- `TrackerDateFields` — date range popover reuses this component as-is
- `api.updateTrackerItem` — single mutation path for all 6 fields, already supports every needed patch shape

### New (proposed)
None. This is internal component reuse and mutation-plumbing extension — no external library need applies (not a commodity problem like crypto/auth/parsing).

---

## Stories + Scenarios

### Story 1: Inline date range edit
> As a tracker user, I want to set/change an item's start and end date directly from the row, so I don't have to open the detail page for scheduling.

**Rule 1: Date popover holds a local draft, commits both fields together on close**
- Example A: Click date column → popover opens with `TrackerDateFields`, pre-filled with current `startDate`/`endDate` (or blank)
- Example B: User edits `startDate` only, then closes/blurs the popover → PATCH sent contains `{ startDate, endDate, version }` together (both keys, sourced from draft state) — never a single-key PATCH, closing the server's `parseDateRange` validation gap that only checks `endDate < startDate` when both keys are present in one body

```gherkin
Scenario: Set both dates for the first time
  Given item TE-4 has startDate=null, endDate=null, version=3
  When  the user opens the date popover, sets startDate=2026-08-06 and endDate=2026-08-26, and closes the popover
  Then  one PATCH is sent with { startDate: "2026-08-06", endDate: "2026-08-26", version: 3 }
  And   on success the row shows "6–26 Aug"

Scenario: Popover closed with no change
  Given item TE-4 has startDate=2026-08-06, endDate=2026-08-26
  When  the user opens the date popover and closes it without editing either field
  Then  no PATCH is sent (no-op guard)

Scenario: Version conflict during date save
  Given item TE-4 is being edited by another session concurrently, TE-4's version has advanced server-side
  When  the user's date PATCH is sent with a stale version
  Then  the date reverts to its prior displayed value, a toast reads "Someone else updated this item first — refreshed.", and loadData() refetches
```

**Rule 2: Row display formats per date state**
- Example C: `startDate=2026-08-06, endDate=2026-08-06` (equal) → row shows "6 Aug"
- Example D: `startDate=2026-08-06, endDate=2026-08-26` (differ, same month) → row shows "6–26 Aug"
- Example E: `startDate=2026-08-28, endDate=2026-09-03` (differ, different months) → row shows "28 Aug–3 Sep"
- Example F: `startDate=2026-12-30, endDate=2027-01-03` (differ, different years) → row shows "30 Dec 2026–3 Jan 2027"
- Example G: only `startDate` set → row shows that single date
- Example H: neither set → row shows placeholder "Set date"

```gherkin
Scenario: Range spans two months
  Given item has startDate=2026-08-28, endDate=2026-09-03
  When  the row renders the date column
  Then  it displays "28 Aug–3 Sep"

Scenario: Range spans two years
  Given item has startDate=2026-12-30, endDate=2027-01-03
  When  the row renders the date column
  Then  it displays "30 Dec 2026–3 Jan 2027"

Scenario: Neither date set
  Given item has startDate=null, endDate=null
  When  the row renders the date column
  Then  it displays placeholder text "Set date", clickable to open the popover
```

---

### Story 2: Inline project/phase edit
> As a tracker user, I want to change an item's project and phase from the row, so triage doesn't require opening the item.

**Rule 1: Project and phase chips always render, independent of groupBy or emptiness**
- Example A: Item has no project → row shows a "Set project" placeholder chip, clickable
- Example B: Tracker view is grouped by project → the project chip still renders in the row (no longer omitted as redundant with the group header)
- Example C: Item has no phase → row shows a "Set phase" placeholder chip, clickable (phase has no existing row element today — this is new)

**Rule 2: Changing project resets phase, in one call — unless re-picking the current project**
- Example D: Item has project=P1, phase=Ph1 → user picks P2 → single PATCH `{ projectId: P2, phaseId: null, version }`
- Example E: Item has project=P1 → user re-picks P1 (already selected) → no PATCH sent (no-op guard), phase is NOT reset

**Rule 3: Phase options are scoped to the currently-selected project**
- Example F: A project with zero phases (e.g. "FASTRACK TRACTOR") → phase picker shows an empty state, no options

```gherkin
Scenario: Change project, phase resets
  Given item TE-3 has projectId=P1, phaseId=Ph1, version=2
  When  the user selects P2 in the row's project picker
  Then  one PATCH is sent with { projectId: P2, phaseId: null, version: 2 }
  And   the row's phase chip immediately shows "Set phase"

Scenario: Re-pick current project is a no-op
  Given item TE-3 has projectId=P1
  When  the user clicks P1 (already selected) in the row's project picker
  Then  no PATCH is sent and phaseId is unchanged

Scenario: Project has no phases
  Given the selected project has zero phases
  When  the user opens the row's phase picker
  Then  it shows an empty state with no selectable options

Scenario: Grouped-by-project view, project changed inline, destination group collapsed
  Given the tracker is grouped by project, and the group for P2 is currently collapsed
  When  the user changes an item's project from P1 to P2 via the row
  Then  the item moves into P2's group and that group auto-uncollapses, matching status's existing uncollapse behavior
```

---

### Story 3: Inline priority edit
> As a tracker user, I want to set priority from the row, matching the existing status-picker pattern.

**Rule 1: Identical picker pattern to status, including "No priority" and a no-op guard**
- Example A: Click priority glyph → picker opens with existing priorities + "No priority" sentinel → select → `{ priorityId: someId }` or `{ priorityId: null }`
- Example B: Re-pick the already-current priority → no PATCH sent

```gherkin
Scenario: Change priority, grouped-by-priority destination collapsed
  Given the tracker is grouped by priority, and the destination priority group is collapsed
  When  the user changes an item's priority from the row
  Then  the item moves into the new priority's group and that group auto-uncollapses

Scenario: Re-pick current priority is a no-op
  Given item's priority is already "High"
  When  the user clicks "High" again in the row's priority picker
  Then  no PATCH is sent
```

---

### Story 4: Inline assignee/label multi-toggle edit
> As a tracker user, I want to add/remove assignees and labels directly from the row.

**Rule 1: Toggle patches resolved against live per-item state at execution time, not click time**
- Example A: Item has assignees=[Alice]. User toggles Bob → patch computed as `assigneeIds=[Alice.id, Bob.id]`
- Example B: User toggles Bob then immediately toggles Carol before Bob's request settles → Carol's patch is computed once Bob's mutation has settled (reading a live per-item ref updated on every settle, mirroring `TrackerDetailPage`'s `itemRef.current` pattern, ported into `TrackerPage` as a per-item-id ref map) → final `assigneeIds=[Alice, Bob, Carol]`, never a dropped or duplicated id

**Rule 2: Labels/members fetched eagerly, isolated from the main list load**
- Example C: `labels` fetch fails (network blip) → `labels` state becomes `[]`, item list still renders normally, only the label picker shows an empty state
- Example D: A workspace has zero labels (rare — 3 defaults are seeded by `tracker-vocabulary-seed.ts`, only reachable via manual deletion) → label kebab/inline entry still renders, shows an empty-state message rather than being hidden

```gherkin
Scenario: Rapid sequential toggles queue correctly
  Given item has assignees=[Alice], version=5
  When  the user toggles Bob, then immediately toggles Carol before Bob's PATCH resolves
  Then  Bob's mutation is sent first and settles (assignees=[Alice,Bob], version=6)
  And   Carol's mutation is then computed against the settled state and sent (assignees=[Alice,Bob,Carol], version=7)
  And   no toggle is dropped or duplicated

Scenario: Labels fetch fails, list still loads
  Given the labels API call fails when TrackerPage loads
  When  the page finishes loading
  Then  items, statuses, priorities, and projects all render normally
  And   labels state is [], the label picker shows an empty state, no full-page error is shown

Scenario: 409 mid-queue
  Given a queued sequence of 2 toggles for the same item
  When  the first toggle's PATCH returns 409 version_conflict
  Then  that toggle reverts, a toast shows, and loadData() refetches
  And   the second queued toggle resumes computing against the refetched item state
```

---

### Story 5: Mobile/narrow-viewport fallback (kebab menu)
> As a tracker user on a narrow viewport, I want one place to edit properties that would otherwise be hidden inline at that width.

**Rule 1: Kebab appears below the `lg` (1024px) breakpoint, lists all 6 properties unconditionally**
- Example A: Viewport = 800px → kebab visible; some fields (priority, label, assignee) are also visible inline at this width — both paths write through the same mutation, accepted as harmless redundancy
- Example B: Viewport = 1200px (≥ lg) → kebab hidden, all 6 fields have permanent inline triggers (now true given Story 2's project/phase chips always render)
- Example C: Viewport = 500px → kebab still lists all 6 properties, not just the subset actually hidden inline at that width

```gherkin
Scenario: Kebab always shows all 6 fields regardless of what's separately visible inline
  Given viewport width is 800px (below lg, above sm/md)
  When  the user opens the row's kebab menu
  Then  it lists date, project, phase, priority, assignee, and label — all 6, with no conditional omission
```

---

### Story 6: Single active picker per row + shared mutation queue
> As a tracker user, I want predictable picker behavior and no accidental lost edits from rapid clicks on the same row.

**Rule 1: One "which picker is open" state per row, scoped per-row**
- Example A: Assignee picker open on a row → user clicks that row's status trigger → assignee picker closes, status picker opens
- Example B: Picker open on row A does not affect row B's independent open-picker state

**Rule 2: All field mutations for one item share a single sequential per-item queue**
- Example C: User changes project then immediately changes priority on the same row, before the project PATCH resolves → priority's mutation waits in the shared queue and is sent only after the project mutation has settled, reading the freshly-settled `version` — no spurious 409
- Example D: A burst of 3 rapid status clicks now produces 3 sequential PATCHes (and 3 changelog entries), replacing the old "keep only the last pick" behavior — an accepted, explicit trade-off

```gherkin
Scenario: Two different field types on the same item no longer race
  Given item TE-5 has version=4
  When  the user changes its project, then immediately changes its priority before the first PATCH resolves
  Then  the project mutation is sent and settles first, item version becomes 5
  And   the priority mutation is then sent reading version=5, not the stale version=4
  And   neither mutation returns a false 409

Scenario: Rapid status clicks are all processed, not collapsed
  Given item TE-1 starts at status "Backlog"
  When  the user rapidly clicks "Todo", then "In Progress", then "Done"
  Then  3 sequential PATCH calls are made in order, and the item ends at "Done" with 3 changelog entries
```

---

## Acceptance Criteria

```
Rule: Date range inline edit
  ✓ Given both dates set and equal, When row renders, Then shows single date
  ✓ Given both dates set and differ (same/different month/year), When row renders, Then shows compact range with month/year shown on both sides whenever they differ
  ✓ Given only one date set, When row renders, Then shows that single date
  ✓ Given neither date set, When row renders, Then shows "Set date" placeholder
  ✓ Given popover closed with changes, When closed, Then one PATCH sent with both startDate+endDate+version together
  ✓ Given popover closed with no changes, When closed, Then no PATCH sent
  ✗ Given a 409 on save, When it occurs, Then date reverts + toast + refetch

Rule: Project/phase inline edit
  ✓ Given item has no project, When row renders, Then shows "Set project" placeholder, clickable
  ✓ Given grouped-by-project view, When row renders, Then project chip still shows (not omitted)
  ✓ Given item has no phase, When row renders, Then shows "Set phase" placeholder, clickable
  ✓ Given project changed to a different project, When submitted, Then single PATCH { projectId, phaseId: null, version }
  ✓ Given project re-picked as the same current project, When submitted, Then no PATCH sent, phase unchanged
  ✓ Given selected project has zero phases, When phase picker opened, Then empty state shown
  ✓ Given grouped-by-project/priority view and destination group collapsed, When project/priority changed inline, Then destination group auto-uncollapses

Rule: Priority inline edit
  ✓ Given priority picker used, When a new priority or "No priority" selected, Then patch sent accordingly
  ✓ Given current priority re-picked, When submitted, Then no PATCH sent

Rule: Assignee/label multi-toggle
  ✓ Given rapid sequential toggles on the same item, When processed, Then each computes against the live settled state at execution time, none dropped or duplicated
  ✓ Given labels or members fetch fails, When TrackerPage loads, Then item list still renders, only that picker degrades to empty state
  ✓ Given a 409 mid-queue, When it occurs, Then that step reverts+toasts+refetches, remaining queued toggles resume against refetched state

Rule: Mobile/narrow-viewport kebab
  ✓ Given viewport < 1024px, When row renders, Then kebab (⋯) trigger appears
  ✓ Given kebab opened, When rendered, Then all 6 properties are listed, with empty-states where options are unavailable — never conditionally hidden
  ✓ Given viewport ≥ 1024px, When row renders, Then kebab is hidden and all 6 fields have inline triggers

Rule: Single picker per row + shared mutation queue
  ✓ Given a picker open on a row, When another trigger on the SAME row is clicked, Then the first closes and the second opens
  ✓ Given a picker open on row A, When a trigger on row B is clicked, Then row A's picker is unaffected
  ✓ Given two different field mutations fired in quick succession on the same item, When processed, Then they execute sequentially through one shared per-item queue, each reading the latest settled version — no false 409s between different fields on the same item
```

---

## Design Decision

**Chosen option:** Option A — Extend `TrackerPage`'s existing state with a `Map<itemId, queue+ref>` for the shared per-item mutation queue and live-state ref, feeding queue/mutation callbacks down to each `TrackerRow` as props.

**Summary:** Keeps the mutation-queue and per-item live-state logic centralized in `TrackerPage` (which already owns all list state and the existing `changeStatus`/`inFlightStatusRef` pattern this replaces), rather than distributing it into a reusable hook inside each row. Matches the scale of this feature — no other component needs this queue.

**Rejected options:**
- Option B (`useTrackerItemMutation` hook per row): rejected — adds an abstraction with no second consumer, and would need to coordinate back to `TrackerPage`'s `setItems` anyway for row display sync, without a real benefit over keeping the queue centralized.

**Key tradeoffs accepted:**
- Rapid status clicks (and any other rapid same-item edits) now produce N sequential PATCHes / changelog entries instead of collapsing to the last pick — explicit, intentional change from status's current behavior, needed to fix the false-409 race across different field types.
- No pending/saving visual indicator is included in this pass — a burst of edits has no visible "still saving" state distinct from "saved." Documented as a follow-up, not blocking.

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Should a pending/saving indicator show while a mutation is queued behind another? | Assumed: not needed for this pass, no visual distinction between "saved" and "queued" | Low — user may double-toggle thinking a click didn't register; acceptable since the queue guarantees eventual correctness, just add a follow-up if reported |
| Exact "No labels in this workspace" / "No phase" copy strings | Assumed: pocket-planning/implementation picks final copy consistent with existing empty-state tone in the app | None — copy is easily adjusted later, not structural |

*(All blocking questions from both edge-case-hunter review cycles were resolved during this session — see Stories above for the resulting rules.)*

---

## Implementation Notes

- Port `resolvePropertyPatch`'s toggle-diff logic from `TrackerDetailPage.tsx` into `TrackerPage.tsx`, adapted to read from a per-item-id ref map instead of a single `itemRef`
- Port `enqueueMutation`'s promise-chain pattern from `TrackerDetailPage.tsx`, adapted to a `Map<itemId, Promise>` so one item's slow save never blocks another item's row
- Retire `inFlightStatusRef`/`queuedStatusRef` in `TrackerPage.tsx` — status now flows through the same shared per-item queue as every other field, not its own separate latest-wins tracking
- Reuse the existing status-group auto-uncollapse logic (`setCollapsedKeys` in `changeStatus`) as the template for the new project/priority group auto-uncollapse
- New date-formatting helper needed for the compact range display (single date / same-month range / cross-month range / cross-year range / placeholder) — likely belongs in `client/src/lib/trackerUtils.ts` alongside other tracker formatting helpers

---

## Rollback Plan

Client-only change, no data migration, no server changes, no feature flag needed — revert via git revert of the client commit(s). No production data is altered by this feature; a rollback only removes the new UI affordances, `TrackerDetailPage` remains the fallback editing path throughout.
