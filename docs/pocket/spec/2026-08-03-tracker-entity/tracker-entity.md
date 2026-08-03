# Tracker Entity

**Date:** 2026-08-03
**Status:** approved
**Author:** pocket-grinding session
**Spec path:** docs/pocket/spec/2026-08-03-tracker-entity/tracker-entity.md

---

## Summary

Camel models fast-moving daily work on the Board but has no home for weeks-horizon product/backlog items. Tracker introduces a per-workspace entity with human-readable keys (`CA-42`), workspace vocabulary (status, priority, labels), and a dedicated dense list page grouped by status. Board is untouched; tracker items are independent of cards (no FK). Direction B: status-grouped list, search only, no filter UI or URL browsing state.

---

## Context

### Current State

- Board (`cards`, `columns`) handles daily ops with ~110px card rows; 29 cards in one column is already unreadable.
- `recordActivity()` writes to `card_events` with card/column FKs and a closed `eventType` union — not usable for tracker without touching Board's activity table.
- Reusable primitives exist: `ListView.tsx` / `boardViewUtils.ts` (dense rows, Card-typed), `columnColorUtils.ts` (OKLCH colours), `workspaceInitials()` in `workspaceSwitcher.ts`, SSE channel `camel:workspace:{id}:events`.
- A prior cycle (`2026-08-01-workspace-pivot-scope`) shipped List/Calendar as Board view preferences and was rejected; `ListView` row layout is harvestable but framing is not.

### Problem / Motivation

Product/backlog work (`Workspace Rename`, `[Tech Debt] Refactor realtime.ts`) has no durable record, stable citation key, or classification axes. One tracker item may spawn several Board cards over weeks (1:N granularity) — write-back rules are unspecifiable. Scale is dozens per workspace, not hundreds.

### Related Areas

- `server/src/db/schema.sql` — new tables, workspace counter column
- `server/src/routes/helpers.ts` — pattern for `recordActivity` (do NOT extend for tracker)
- `server/src/routes/cards.ts`, `server/src/routes/card-assignees.ts` — assignee validation, 409 pattern
- `server/src/realtime.ts` — new SSE event types
- `server/src/routes/activity.ts` — must NOT query tracker events
- `client/src/lib/workspaceSwitcher.ts` — `workspaceInitials()`
- `client/src/lib/columnColorUtils.ts` — vocab colour generation
- `client/src/components/ListView.tsx` — row layout pattern (~40px)
- `client/src/layout/sidebar/navItems.ts` — nav entry between Board and Inbox
- `client/src/lib/boardViewUtils.ts` — extract `assigneeInitials`; tracker-specific helpers for Card-bound logic

---

## Scope

### In-Scope

- `tracker_items` table (workspace-scoped, independent of `cards`)
- Per-workspace `key_number` (integer, gaps permitted); prefix computed from `workspaceInitials(workspace.name)` at read time; counter via atomic `workspaces.tracker_key_counter`
- Unified `tracker_vocabularies` table (`kind`: status | priority | label) with fractional `position` for ordered kinds
- Junction tables: `tracker_item_labels` (multi-select), `tracker_item_assignees` (multi-select)
- Retroactive vocabulary seeding for all existing workspaces on migration
- Default status: `Backlog`, `Todo`, `In Progress`, `Done`, `Canceled`
- Default priority: `High`, `Medium`, `Low`
- Default labels: `Feature`, `Bug`, `Maintain`
- Vocabulary rules v1: all members can add; no delete/rename; user sets position on create for status/priority; duplicate names rejected (case-insensitive); auto pastel colour on create
- `tracker_events` table + `recordTrackerActivity()` helper (NOT `card_events` / `recordActivity`)
- CRUD API: `version` optimistic locking (409 on stale), `deleted_at` soft delete
- Tracker list page at `/tracker`: dense Linear-style rows, grouped by status (collapsible, all open on first visit, collapse resets each navigation to `/tracker`)
- Within-section sort: oldest first (`created_at ASC`)
- Search: title + description + key (partial numeric `42` matches `CA-42`); case-insensitive; hide empty status sections when search active
- Global `+` button opens create modal (Linear-style): title, description, status/priority/assignee/label pickers; default status Backlog, priority null
- Detail page at `/tracker/{PREFIX}-{N}`; stale prefix redirects to canonical; soft-deleted item → 404
- Per-item changelog on detail page (from `tracker_events`)
- Row display: key, status icon, title, label chips, assignee avatars, created date (`// TODO: due date preference`)
- Realtime SSE for tracker mutations (new event types on existing per-workspace channel)
- Sidebar nav: `/tracker` between Board and Inbox
- Assignee cleanup on membership removal (mirror `card_assignees` pattern in `helpers.ts`)
- 409 conflict UX mirrors cards (refresh + warning toast)

### Out-of-Scope

- Board / kanban cards / columns changes
- Tracker ↔ card linkage (`card_id` nullable FK — future additive upgrade)
- Write-back rules at 1:N granularity
- Grouping by label/priority, filter UI, URL-persisted browsing state (Direction C)
- Vocabulary delete/rename in v1
- Vocabulary colour edit after create
- `fuse.js` / client-side fuzzy search (server `ILIKE` sufficient at scale)
- New DB indexes or dedicated filtered-read endpoints
- Done-column archive/collapse on Board (separate candidate)
- Event scheduling / calendar roadmap
- Tracker events in Board Activity feed
- `localStorage` / `sessionStorage` for section collapse persistence

---

## Architecture Constraints

- **May touch:** `schema.sql`, server routes, Kysely types, client pages/components, nav, realtime event types
- **Must NOT touch:** Board rendering, card/column mutation paths, existing card queries, `card_events` / `recordActivity`
- **Patterns:** `recordTrackerActivity()` on every tracker mutation; `version` + HTTP 409; `deleted_at` filtering; NodeNext `.js` imports on server; `requireWorkspaceMember` on all routes
- **Reuse:** `workspaceInitials()`, `columnColorUtils.ts`, `position.ts` for vocab ordering, `assigneeInitials` from boardViewUtils (extract if needed)
- **Architecture validation:** PASS

---

## Dependencies

### Existing (to leverage)

- `culori` — OKLCH pastel generation for vocabulary colours (`columnColorUtils.ts`)
- Kysely + PostgreSQL — CRUD, `ILIKE` search, atomic counter `UPDATE … RETURNING`
- Redis Pub/Sub → SSE — realtime fan-out (`realtime.ts`)
- Existing auth/workspace middleware

### New

none

---

## Stories + Scenarios

### Story: Browse Tracker list

> As a workspace member, I want a dense status-grouped Tracker list, so I can scan weeks-horizon work without Board scroll pain.

**Rule 1: Status grouping**
- Example A: 5 items across Backlog and Todo → two collapsible sections, all expanded on first visit
- Example B: User collapses Done, navigates to Board, returns to `/tracker` → all sections expanded again

```gherkin
Scenario: Open Tracker page
  Given workspace has seeded vocabulary and tracker items
  When member navigates to /tracker
  Then items appear in status-grouped sections sorted oldest-first within each section
  And all sections are expanded

Scenario: Search hides empty sections
  Given items in Backlog and Done
  When member searches a term matching only a Backlog item
  Then Backlog section shows matches
  And Done section is hidden
```

**Rule 2: Dense row display**
- Example A: Item `CA-42` "Workspace Rename" with label Feature, assignee, created Jul 4 → row shows key, status icon, title, label chip, avatar, date

```gherkin
Scenario: Row shows Linear-style metadata
  Given item CA-42 with title, label Feature, one assignee, created_at Jul 4
  When member views /tracker
  Then row displays key, status icon, title, label chip with colour dot, assignee avatar, and created date
```

---

### Story: Create tracker item

> As a workspace member, I want to create tracker items via a modal, so I can capture backlog work quickly.

**Rule 1: Defaults on create**
- Example A: Title only → status Backlog, priority null, no labels, no assignees, key auto-assigned

```gherkin
Scenario: Minimal create via modal
  Given member clicks global + on /tracker
  When they submit title "Fix realtime" with no other fields
  Then item is created with status Backlog, priority null, and next key_number
  And displayed key uses current workspace prefix (e.g. CA-1)

Scenario: Create with pickers
  Given member opens create modal
  When they set status In Progress, priority High, two labels, two assignees
  Then item is saved with those values
```

**Rule 2: Title validation**
- Example A: Whitespace-only title → 400

```gherkin
Scenario: Reject empty title
  Given member submits title "   "
  When create is attempted
  Then API returns 400
```

---

### Story: Human-readable keys and URLs

> As a workspace member, I want stable citation keys and shareable URLs, so I can reference work in commits and conversations.

**Rule 1: Prefix computation**
- Example A: Workspace "Camel" → prefix `CA`; item #42 → `CA-42`
- Example B: Workspace renamed → prefix updates; `key_number` unchanged

```gherkin
Scenario: Stale prefix redirect
  Given item key_number 42 exists, workspace renamed so prefix is now CK
  When member opens /tracker/CA-42
  Then redirect to /tracker/CK-42

Scenario: Wrong workspace context
  Given CA-42 exists only in workspace A
  When member in workspace B opens /tracker/CA-42
  Then 404

Scenario: Numeric search
  Given item CA-42 exists
  When member searches "42"
  Then CA-42 appears in results
```

---

### Story: Edit and delete tracker item

> As a workspace member, I want to edit and delete tracker items on a detail page, so I can maintain backlog accuracy.

```gherkin
Scenario: Detail page with changelog
  Given item CA-42 had status changes recorded in tracker_events
  When member opens /tracker/CA-42
  Then detail shows editable fields and per-item changelog

Scenario: Stale write conflict
  Given two tabs open on CA-42, tab A saves first
  When tab B saves with old version
  Then API returns 409 and client shows conflict UX mirroring cards

Scenario: Soft delete
  Given item CA-42 exists
  When member deletes CA-42
  Then item is absent from list and search
  And /tracker/CA-42 returns 404
  And key_number 42 is not reused
```

---

### Story: Workspace vocabulary

> As a workspace member, I want custom status/priority/label vocabulary, so I can classify tracker items.

```gherkin
Scenario: Migration seeds defaults
  Given workspace existed before tracker migration
  When migration runs
  Then default status, priority, and label vocabulary rows exist

Scenario: Add custom status with position
  Given defaults Backlog, Todo, In Progress exist
  When member adds status "Blocked" positioned between Todo and In Progress
  Then list sections reflect that order

Scenario: Reject duplicate vocabulary name
  Given status "Blocked" exists
  When member adds another status "blocked"
  Then API returns 400 or 409

Scenario: Realtime vocabulary add
  Given member B is on /tracker
  When member A adds status "Blocked"
  Then member B sees new section without refresh
```

---

### Story: Assignees and permissions

> As a workspace member, I want to assign tracker items to teammates, so ownership is visible.

```gherkin
Scenario: All members can CRUD
  Given user with role member
  When they create or update a tracker item
  Then operation succeeds

Scenario: Reject non-member assignee
  Given user U is not a workspace member
  When member assigns U to CA-42
  Then API returns 400

Scenario: Assignee removed from workspace
  Given CA-42 assigned to member M
  When M is removed from workspace
  Then M is stripped from CA-42 assignees
```

---

### Story: Realtime updates

> As a workspace member, I want live updates on the Tracker page, so I see teammates' changes without refreshing.

```gherkin
Scenario: Live status change
  Given two members on /tracker
  When member A changes CA-42 status to In Progress
  Then member B's list updates without refresh

Scenario: Live delete
  Given member B's list shows CA-42
  When member A soft-deletes CA-42
  Then row disappears from B's list without refresh
```

---

## Acceptance Criteria

```
Rule: Tracker list browsing
  ✓ Given seeded vocabulary and items, When member opens /tracker, Then status-grouped dense rows sorted oldest-first, all sections expanded
  ✓ Given active search, When no items match a status section, Then that section is hidden
  ✓ Given item with metadata, When viewing list row, Then key, status icon, title, labels, assignees, created date display

Rule: Create item
  ✓ Given global + modal, When member submits title only, Then item created with Backlog status, null priority, auto key
  ✓ Given whitespace title, When create attempted, Then 400

Rule: Keys and URLs
  ✓ Given workspace "Camel", When first item created, Then displayed as CA-1
  ✓ Given stale prefix URL, When opened in correct workspace, Then redirect to canonical prefix
  ✓ Given search "42", When CA-42 exists, Then item appears
  ✗ Given key in wrong workspace, When detail URL opened, Then 404

Rule: Edit, delete, conflict
  ✓ Given detail page, When opened, Then changelog visible from tracker_events
  ✓ Given stale version, When PATCH attempted, Then 409 with card-mirror UX
  ✓ Given soft delete, When list or detail accessed, Then item absent / 404

Rule: Vocabulary
  ✓ Given pre-tracker workspace, When migration runs, Then default vocab seeded
  ✓ Given custom status with position, When added, Then section order updated
  ✗ Given duplicate vocab name, When add attempted, Then rejected

Rule: Assignees and permissions
  ✓ Given role member, When CRUD tracker item, Then allowed
  ✗ Given non-member assignee, When assigned, Then 400

Rule: Realtime
  ✓ Given two members on /tracker, When one mutates item, Then other sees update without refresh
```

---

## Design Decision

**Chosen option:** Option A — Unified vocabulary table

**Summary:** `tracker_items` + `tracker_vocabularies` (kind discriminator) + junction tables for labels and assignees + `tracker_events` + `workspaces.tracker_key_counter`. Prefix computed at read time; search via server `ILIKE`; activity fully separate from `card_events`.

**Rejected options:**
- Option B (three vocab tables): rejected — duplicate CRUD/seed patterns without benefit at dozens scale
- Option C (settings JSONB): rejected — violates typed-columns settings pattern

**Key tradeoffs accepted:**
- Two activity systems (`card_events` vs `tracker_events`) — acceptable because Tracker history stays on Tracker pages only
- Prefix per workspace (not per user) — two workspaces named "Camel" both use `CA-*`; disambiguated by active workspace context
- Vocabulary typos are permanent in v1 (no delete/rename) — acceptable; items can use Canceled status instead

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Search case sensitivity | assumed: case-insensitive `ILIKE` | Minor UX inconsistency |
| 409 when version omitted on PATCH | assumed: require version (mirror cards) | Last-write-wins bugs |
| Create modal "Create more" toggle | assumed: out of v1 | Minor UX gap vs Linear |
| Status icon per vocab entry | assumed: default icons per status kind; custom statuses get generic icon | Visual inconsistency for custom statuses |
| Concurrent key allocation | assumed: atomic `UPDATE workspaces SET tracker_key_counter = tracker_key_counter + 1 … RETURNING` in transaction | Rare duplicate key_number under concurrency |
| Linear CAM-* collision with ticket intake | assumed: acceptable; different systems | User confusion citing keys |

---

## Implementation Notes

- `assigneeInitials(name)` from `boardViewUtils.ts` is generic; `isCardDone` / `isDueOverdue` need tracker equivalents or are unused on Tracker rows (status comes from vocabulary, not `done_at`)
- Row created date: use `created_at`; add `// TODO: due date preference` in component
- Colour edit after create: deferred; seed auto pastel via `columnColorUtils.ts`
- Do NOT call `recordActivity()` for tracker mutations
- Membership removal must delete `tracker_item_assignees` rows (mirror `card_assignees` cleanup in `helpers.ts:311-317`)

---

## Rollback Plan

- Migration is additive (new tables + column on `workspaces`); rollback = revert deploy + drop tracker tables/column in maintenance window
- No Board data affected; safe to disable Tracker nav route via revert without data loss on cards
