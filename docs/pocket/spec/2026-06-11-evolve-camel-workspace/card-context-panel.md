# Card-Centric Context Panel — Shell + Per-Card Activity

**Date:** 2026-06-11
**Status:** draft
**Author:** brainstorm session (pocket-grinding)
**Spec path:** docs/pocket/spec/2026-06-11-evolve-camel-workspace/card-context-panel.md

---

## Summary

Replace the centered `CardModal` with a route-driven **Context Panel** — a sidebar
that slides in from the right when a card is clicked, keeping the board visible
behind it. This first cycle delivers the panel *shell* plus two sections: **Details**
(full parity with the current modal — editable title/description, delete, optimistic
locking) and **Activity** (per-card event history derived from `card_events`). The
panel is the extensible container that future sub-views (threads, GitHub) will plug
into as nested routes. This is the foundation sub-scope of the `evolve-camel-workspace`
pitch, Direction A — "card as center of gravity."

---

## Context

### Current State
- Card detail today is a centered modal (`client/src/components/CardModal.tsx`)
  triggered by `openCard` local state in `BoardPage` ([BoardPage.tsx:38](../../../../client/src/pages/BoardPage.tsx),
  rendered at [BoardPage.tsx:262](../../../../client/src/pages/BoardPage.tsx)).
  It supports title + description edit and delete only.
- Mutation handlers `onSaveCard` / `onDeleteCard` live inside `BoardPage`
  ([BoardPage.tsx:181-204](../../../../client/src/pages/BoardPage.tsx)) and share a
  closure with `columns`, `refresh`, and `showToast` from `useBoard()`.
- Optimistic locking is in place: `updateCard`/`moveCard` send `version`; a mismatch
  returns 409 (`version_conflict`) and the client toasts
  `"Someone else updated this card first — board refreshed."` ([BoardPage.tsx:193](../../../../client/src/pages/BoardPage.tsx)).
- Real-time is coarse: Redis Pub/Sub → SSE fan-out; every SSE event triggers a full
  `refresh()` in `BoardProvider`. `BoardProvider` wraps `RouterProvider` in
  [App.tsx:56-59](../../../../client/src/App.tsx), so `useBoard()` (columns, refresh,
  showToast) is available to **any** route.
- `card_events` already records `create`/`update`/`move`/`delete` per card with
  `event_type`, `payload` (JSONB), `actor_id`, and `from_column_id`/`to_column_id`
  ([schema.sql:23-32](../../../../server/src/db/schema.sql)). Indexed by card via
  `idx_events_card`. A global activity feed endpoint already exists
  (`GET /activity`, [routes.ts:397](../../../../server/src/routes.ts)) — the per-card
  endpoint will mirror its JOIN shape.
- Router uses `createBrowserRouter` with nested children under `AppLayout`; `board`,
  `dashboard`, `activity` are sibling routes ([App.tsx:20-38](../../../../client/src/App.tsx)).

### Problem / Motivation
The pitch's success criterion is: *open one card and understand everything — what,
why, what's been tried, what's linked — without switching tabs.* A centered modal
hides the board and is a dead end for growth: it cannot host the threads / GitHub /
decision-record sections the pitch envisions. The panel is the container that makes
those future cycles additive rather than rewrites.

### Related Areas
- `client/src/pages/BoardPage.tsx` — current modal trigger + mutation handlers
- `client/src/components/CardModal.tsx` — behavior to port for parity
- `client/src/context/BoardContext.tsx` — will own lifted save/delete handlers
- `client/src/App.tsx` — nested route registration
- `client/src/api.ts` — new `getCardActivity` client method
- `server/src/routes.ts` — new read-only `GET /cards/:id/activity`
- `docs/pocket/rule/creative-brief.md` — design authority (tokens, atoms, copy)

---

## Scope

### In-Scope
- Replace card-click behavior: `CardModal` removed; clicking a card opens the
  **Context Panel** (right sidebar, board still visible behind it on desktop).
- **Details section**: editable title + description with full parity to today's modal
  (explicit Save/Cancel, empty-title rejection, delete, optimistic-locking `version`),
  plus read-only metadata (created / started / done).
- **Activity section**: per-card history from `card_events` (`create` + `move` +
  `update`), newest-first, no pagination this cycle.
- Panel as an **extensible container** with slots for future sections (threads,
  GitHub) without rewrite.
- **URL-driven state** (`/board/card/:id` nested route): deep-link / refresh re-opens
  the panel; link is shareable.
- **Real-time**: panel reflects card updates via the existing SSE → `refresh()` model.
- **Mobile**: full-screen overlay below a small breakpoint (single media query).
- Design follows `creative-brief.md` (tokens, atoms, copy guidelines).

### Out-of-Scope (deliberately deferred to separate cycles)
- Threaded discussion / comments table, decision markers — *separate cycle (Direction C).*
- GitHub integration (PR status, auto-sync, OAuth) — *separate cycle (Direction B).*
- Workspace pulse / daily digest — *separate cycle.*
- Notification system — *not needed by this shell.*
- Card templates (bug/feature/chore) — *unrelated concern.*
- Inline auto-save — *explicit Save chosen; auto-save is a possible later enhancement.*

---

## Architecture Constraints

Confirmed in Phase 2, validated in Phase 6 (PASS).

- **Layers this work MAY touch:**
  - client: `App.tsx` (nested route), `BoardPage` (render `<Outlet/>`, keep DnD +
    columns ownership), `BoardContext` (lift `onSaveCard`/`onDeleteCard` + 409
    handling so the route-sibling panel can call them), new `ContextPanel` +
    section components, `CardView` trigger, `api.ts` (new per-card activity method).
  - server: `routes.ts` only — read-only `GET /cards/:id/activity`.
- **Layers this work must NOT touch:**
  - DB schema — no new tables/columns; reuse `card_events`.
  - `realtime.ts` Pub/Sub contract, auth, presence, metrics core.
- **Patterns that MUST be followed:**
  - Optimistic locking (`version`) preserved on edit/delete.
  - SSE → `refresh()` coarse-update model — no new sync protocol.
  - Tailwind + creative-brief tokens only.
  - All endpoints behind `requireAuth`.
- **Architecture validation result:** PASS (all 7 checks; expansion to `BoardContext`
  + `App.tsx` declared and user-approved as part of choosing Option B).

---

## Stories + Scenarios

### Story 1: Open & view a card via the Context Panel
> As a team member, I want clicking a card to open a context panel (sidebar),
> so that I see a card's details + history without losing board context.

**R1.1: Click opens slide-in panel; board stays visible (desktop).**
- Example: click card #42 → right panel appears with Details + Activity for #42;
  no full-screen dark overlay on desktop.

**R1.2: Panel state lives in the URL (`/board/card/:id`).**
- Example: open `/board/card/42` directly (paste/refresh) → panel #42 opens after
  board load.

**R1.3: Invalid / non-numeric / missing card id → board normal, panel closed, URL
cleared silently (no toast).**
- Example: `/board/card/999` (no such card) → panel closed, URL replaced with `/board`.
- Example: `/board/card/abc` (non-numeric) → panel closed, URL replaced with `/board`.

**R1.4: Mobile (small breakpoint) → full-screen overlay; background scroll locked.**
- Example: viewport < 768px, click card → panel covers the whole viewport.

```gherkin
Scenario: Open panel by clicking a card
  Given I am signed in at /board and card #42 exists
  When  I click card #42
  Then  a context panel slides in from the right showing Details + Activity for #42
  And   the URL becomes /board/card/42
  And   the board stays visible behind the panel (desktop)

Scenario: Deep-link opens panel on load
  Given card #42 exists
  When  I open /board/card/42 directly (paste or refresh)
  Then  panel #42 opens automatically after the board loads

Scenario: Missing card id in URL is cleared silently
  Given card #999 does not exist
  When  I open /board/card/999
  Then  the board loads normally and the panel stays closed
  And   the URL is replaced with /board with no toast

Scenario: Non-numeric card id is ignored
  Given I open /board/card/abc
  When  the board loads
  Then  the panel stays closed and the URL is replaced with /board with no toast

Scenario: Mobile shows full-screen overlay
  Given the viewport is < 768px
  When  I click card #42
  Then  the panel covers the whole viewport (not a narrow sidebar)
  And   background board scroll is locked while it is open
```

### Story 2: Edit & delete a card from the panel (Details section)
> As a team member, I want to edit title/description & delete from the panel,
> so that I keep full parity with the old modal while optimistic locking stays safe.

**R2.1: Explicit Save — changes commit only on "Save changes".**
- Example: change description, click Save → persisted, board refreshes, `version` +1.

**R2.2: Empty/whitespace title is rejected (no commit).**
- Example: clear the title, click Save → nothing persists, panel stays open on #7.

**R2.3: Save sends `version`; mismatch → 409 → toast + panel refreshes to latest.**
- Example: A & B open #7 (v3); B saves first (→v4); A saves with v3 → 409 toast,
  panel A now shows v4.

**R2.4: Delete removes the card, closes the panel, refreshes the board.**
- Example: click "Delete card" → card gone, panel closed.

```gherkin
Scenario: Edit description with explicit save
  Given the panel for card #7 (version 3) is open
  When  I change the description and click "Save changes"
  Then  the change is persisted, the board refreshes, and card #7 becomes version 4

Scenario: Empty title is rejected
  Given the panel for card #7 is open
  When  I clear the title and click "Save changes"
  Then  nothing is committed and the panel stays open showing card #7

Scenario: Concurrent edit triggers version conflict
  Given A and B both have card #7 version 3 open
  And   B saves a change first (card becomes version 4)
  When  A clicks "Save changes" with version 3
  Then  A receives 409 and a toast "Someone else updated this card first — board refreshed."
  And   panel A shows card #7 version 4

Scenario: Delete card from panel
  Given the panel for card #7 is open
  When  I click "Delete card"
  Then  card #7 is deleted, the panel closes, and the board refreshes
```

### Story 3: Activity section
> As a team member, I want to see a card's history in the panel,
> so that I understand what has happened to this card.

**R3.1: Show `create` + `move` + `update` events for the card, newest-first, all
events (no pagination).**
- Example: a card with 1 create + 2 move + 1 update → 4 entries, newest→oldest.

**R3.2: Each entry shows actor (display_name) + action + relative time.**
- Example: "Sinta moved Doing → Review · 2h ago".

**R3.3: A `move` whose source column was deleted (`from_column_id` NULL) omits the
null side.**
- Example: column "Doing" deleted → render "Sinta moved this to Review · 2h ago"
  (no broken "→").

**R3.4: No events → "No activity yet."**

```gherkin
Scenario: Activity lists card history newest-first
  Given card #5 has 1 create, 2 move, and 1 update event
  When  the panel for #5 is open
  Then  Activity shows 4 entries ordered newest→oldest with actor, action, relative time

Scenario: Move with deleted source column omits the null side
  Given card #5 has a move event whose from_column_id is NULL
  When  the panel for #5 is open
  Then  that entry reads "<actor> moved this to <to_column> · <time>" with no dangling arrow

Scenario: Empty activity state
  Given card #5 has no displayable events
  When  the panel for #5 is open
  Then  Activity shows "No activity yet."
```

### Story 4: Real-time while panel is open + close mechanics
> As a team member, I want the panel to reflect teammates' changes and close easily,
> so that context stays accurate without a stale view.

**R4.1: Teammate edits/moves the open card while I am NOT typing → panel contents
(Details + read-only metadata + Activity) auto-refresh.** (Silent; no banner —
consistent with the existing SSE→refresh model.)
- Example: panel #5 open & idle; teammate moves #5 Doing→Review → Activity shows the
  new move, Details/metadata update.

**R4.2: I AM typing (dirty) → my input is not overwritten; conflict is caught on Save
(R2.3).** Dirty = a field value differs from the saved card.
- Example: I type a new title for #5 (unsaved); teammate edits #5 → my input is
  intact; Save → 409.

**R4.3: Teammate deletes the open card → panel auto-closes + toast "This card was
deleted."** Panel existence is derived from board `columns`: on each `refresh`, if
`:id` is no longer in `columns`, the panel closes. The toast fires only if the panel
was previously showing that card; if it was opened from a URL and the card was never
found, close silently (this unifies R4.3 + R1.3 + SSE-drop).
- Example: panel #5 open; teammate deletes #5 → panel closes + toast.

**R4.4: Close via X button, Esc key, or click on the board area outside the panel →
URL returns to `/board`.**

```gherkin
Scenario: Panel auto-refreshes on teammate change while idle
  Given the panel for card #5 is open and I am not typing
  When  a teammate moves card #5 from Doing to Review
  Then  Details/metadata update and Activity shows the new move entry

Scenario: Dirty input is preserved during teammate change
  Given the panel for card #5 is open and I am typing a new title (unsaved)
  When  a teammate edits card #5
  Then  my input is not overwritten
  And   when I click Save I receive 409 (R2.3)

Scenario: Panel auto-closes when card is deleted by a teammate
  Given the panel for card #5 is open
  When  a teammate deletes card #5
  Then  the panel auto-closes and a toast "This card was deleted." appears

Scenario: Close panel via Esc / X / click-outside
  Given the panel for card #42 is open
  When  I press Esc (or click X, or click the board area)
  Then  the panel closes and the URL returns to /board
```

---

## Acceptance Criteria

```
ACCEPTANCE CRITERIA — Card-Centric Context Panel (shell + per-card activity)
Date: 2026-06-11 | Scope confirmed: yes

Rule R1: Open & view via panel
  ✓ Given card #42, When I click it, Then the panel slides in from the right and URL = /board/card/42
  ✓ Given card #42, When I open /board/card/42 directly, Then the panel opens after board load
  ✗ Given no card #999, When I open /board/card/999, Then panel stays closed and URL is replaced with /board (no toast)
  ✗ Given /board/card/abc, When board loads, Then panel stays closed and URL is replaced with /board (no toast)
  ✓ Given viewport < 768px, When I click a card, Then the panel is a full-screen overlay with scroll locked

Rule R2: Edit & delete (Details)
  ✓ Given panel #7 v3, When I edit description and click Save, Then it persists, board refreshes, version → 4
  ✗ Given panel #7, When I clear the title and click Save, Then nothing commits and the panel stays open
  ✗ Given A & B on #7 v3 and B saved first (v4), When A saves with v3, Then 409 + toast and panel A shows v4
  ✓ Given panel #7, When I click Delete card, Then card is deleted, panel closes, board refreshes

Rule R3: Activity section
  ✓ Given #5 has create+2move+update, When panel opens, Then 4 entries newest→oldest with actor/action/time
  ✓ Given a move with from_column_id NULL, When panel opens, Then the entry omits the null side (no dangling arrow)
  ✓ Given #5 has no displayable events, When panel opens, Then it shows "No activity yet."

Rule R4: Real-time + close mechanics
  ✓ Given panel #5 open & idle, When teammate moves #5, Then Details + Activity auto-refresh
  ✓ Given panel #5 open & I am typing, When teammate edits #5, Then my input is preserved (conflict caught on Save)
  ✓ Given panel #5 open, When teammate deletes #5, Then panel auto-closes + toast "This card was deleted."
  ✓ Given panel #42 open, When I press Esc / click X / click board, Then panel closes and URL = /board

OPEN QUESTIONS (risks if unresolved):
  - "Dirty" definition → assumed: dirty = field value differs from saved card (focus alone ≠ dirty). Non-blocking.

OUT-OF-SCOPE (remind pocket-planning):
  - Threaded discussion / comments, GitHub integration, workspace pulse, notifications,
    card templates, inline auto-save.
```

---

## Design Decision

**Chosen option:** Option B — Nested route `/board/card/:id` with panel rendered via
`<Outlet/>`; mutation handlers lifted to `BoardContext`.

**Summary:** A nested route gives a clean, path-based, shareable deep-link and a
natural home for future card sub-views (`/board/card/:id/thread`, `…/github`) without
restructuring later. Because `BoardProvider` already wraps the router, the panel
route reads `columns`/`refresh` from `useBoard()` like any route; the one real cost —
moving `onSaveCard`/`onDeleteCard` (and 409 handling) out of `BoardPage` — is paid
once, now, and was explicitly accepted because the panel is destined to grow.

**Rejected options:**
- **Option A (`?card=42` query param, panel inside BoardPage):** rejected as a
  foundation choice because every future sub-view would be a tab inside one component
  rather than a route — it keeps the mutation handlers in place (cheaper now) but
  accumulates tech debt for a panel that *will* host threads + GitHub. A→B migration
  stays cheap if priorities change (URL is the contract).
- **Option C (panel state in BoardContext as `openCardId`):** rejected — mixes UI
  concern into the data provider (YAGNI); the URL already serves as cross-page state.

**Key tradeoffs accepted:**
- Lifting `onSaveCard`/`onDeleteCard` (+ 409 handling) from `BoardPage` to
  `BoardContext` touches sensitive optimistic-lock code — mitigated by porting logic
  verbatim (no behavior change) and covering it with the R2.3 conflict scenario.
- URL is a path (`/board/card/42`), not a query string — slightly more route wiring,
  but cleaner semantics and future sub-route headroom.

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| What counts as "dirty" for R4.2? | assumed: a field value differs from the saved card (focusing an unchanged field is not dirty) | Low — at worst an idle-but-focused panel skips one auto-refresh; conflict is still caught on Save |
| Card data source for the panel | resolved: derive the card from board `columns` (no `GET /cards/:id`); only Activity needs a new endpoint | Low — single source of truth, panel can never diverge from board |
| Auto-refresh visual indicator | resolved: stay silent (consistent with existing SSE→refresh); no "updated by teammate" banner | Low |
| URL cleanup mechanism | resolved: `history.replaceState` to `/board` (no new history entry, no toast) | Low |

*(No blocking questions remain. Edge case hunter ran after Phase 4; all blocking
findings resolved — see Design Decision and R3.3 / R4.3.)*

---

## Implementation Notes

- **Lift handlers first.** Move `onSaveCard`/`onDeleteCard` (and the
  `version_conflict` → toast → refresh flow at [BoardPage.tsx:181-204](../../../../client/src/pages/BoardPage.tsx))
  into `BoardContext` *verbatim*, expose via `useBoard()`, then have both `BoardPage`
  (during transition) and the panel route consume them. No behavior change intended.
- **New endpoint mirrors the global feed.** `GET /cards/:id/activity` reuses the JOIN
  shape of `GET /activity` ([routes.ts:397-425](../../../../server/src/routes.ts)) but
  filters `WHERE e.card_id = $1`, orders `created_at DESC, id DESC`, returns all rows
  (no `LIMIT` this cycle), behind `requireAuth`. Uses `idx_events_card`. Add a
  matching `api.getCardActivity(id)` in `client/src/api.ts`.
- **Panel existence derives from `columns`.** On each `refresh`/`refreshTick`, if the
  route's `:id` is absent from `columns`, close the panel. This single rule covers
  delete-by-teammate (R4.3), invalid id (R1.3), and SSE-drop staleness.
- **Activity fetch timing:** on panel open and on each `refreshTick` while open.
- **Mobile:** one media query (< 768px) switches sidebar → full-screen overlay +
  scroll lock. No bottom-sheet / gestures this cycle (desktop-first).
- **`CardModal` removal:** delete the component and its `openCard` state/render in
  `BoardPage` once the panel reaches parity; do not leave two edit paths.
- **Design tokens & copy:** all visuals must consult `docs/pocket/rule/creative-brief.md`
  (the project's design authority) — colors, type, spacing, atoms, and copy tone.

---

## Rollback Plan

Pure additive client refactor + one read-only endpoint; no data migration.

- Revert the client diff: restore `CardModal` render + `openCard` state in `BoardPage`,
  remove the `/board/card/:id` route, revert the `BoardContext` handler lift.
- Remove the additive `GET /cards/:id/activity` route and the `api.getCardActivity`
  method. Existing endpoints and the SSE/`card.deleted` contract are untouched.
- No schema change to undo (reused `card_events`).
