# Demo Board (client-only) at /demo

**Date:** 2026-10-11
**Status:** approved
**Author:** pocket-grinding session (input: `pitch-exploration.md`, issue #207)
**Spec path:** docs/pocket/spec/2026-10-11-demo-board-client-only/demo-board-spec.md

---

## Summary

Logged-out visitors cannot try Camel's board before signing up. Add a public `/demo` route that renders the real board UI against an in-browser data source: no login, no database rows, no `/api/*` calls. State persists in `localStorage` and can be reset. Import into a real account after signup (#207 "Save this board") is a later phase.

---

## Context

### Current State
- `client/src/main.tsx` mounts `<App />`. `App` runs `useBuildReload()` (fetches `/api/health`) and `api.me()` before it picks a router, so every route, including a future `/demo`, currently fires `/api/*` first (`client/src/App.tsx:164-181`).
- Authenticated tree: `ToastProvider → WorkspaceProvider → PresenceProvider → BoardProvider → FocusSessionProvider`. `BoardProvider` (288 lines) calls `useWorkspace()` and `api.*` and opens an SSE `EventSource` (`useBoardEventStream.ts`).
- Board components call `useWorkspace()` for narrow fields: `activeWorkspaceId`, `boardViewMode`/`setBoardViewMode`, `setHasUnsavedCardEdits`, `ticketIntakeEnabled`, `focusModeEnabled`. `AddCard` calls `useTaskMetadataCatalogs()`. `usePresence` is not used inside `features/board`.
- Hard-coded `/board` navigation: `ContextPanelSurface.tsx:53,66`, `cardPanel.ts:48`, `BoardPageSurface.tsx:33`, `ContextPanelEditorView.tsx:97`, `CalendarView.tsx:223,362` (calendar hidden in demo).
- The client has no column-delete call (`api.ts` has add, `updateColumn`, `applyTemplate` only). Cards delete via `api.deleteCard`.
- Server rules a demo must mirror: WIP limit (positive integer or null), fractional positions (`POSITION_GAP = 1024`, `MIN_SPACING = 1e-9`, `server/src/core/position.ts`), card `version`, length caps (`server/src/validators/input-length.ts`: card title 255, description 10000, column name 50). WIP toast text: "WIP limit reached — finish something first.".
- Fixture precedent: `server/src/db/seed.ts` (4 columns: Backlog, To Do wip 5, In Progress wip 3, Done; 6 cards distributed 2/2/1/1). Server-only; client needs its own copy.
- Storage precedent: `shared/boardViewPrefs.ts` (`localStorage` with try/catch).

### Problem / Motivation
Marketing copy is all a logged-out visitor sees. The board is the product. The cost sits in decoupling the board from `WorkspaceContext`, the API and SSE without forking the UI and without regressing `/board`.

### Related Areas
`client/src/App.tsx`, `client/src/main.tsx`, `client/src/features/board/*`, `client/src/shared/{WorkspaceContext,PresenceContext,ToastContext,TaskMetadataCatalogProvider,boardViewPrefs}.ts*`, `scripts/feature-modules/map.mjs`, `scripts/check-work-item-mutation-routing.mjs`, `client/src/pages/LandingPage.tsx`.

---

## Scope

### In-Scope
- Public `/demo` and `/demo/card/:cardId`, interactive board, no login or signup.
- Card add, edit (title, description), move (drag, cross-column and within-column), delete (trash zone). Column add, rename, set WIP limit. Fractional positions, WIP rules, per-card version.
- Client-owned fixture, persistence in `localStorage`, Reset with confirmation, "stored only in this browser" notice.
- `/demo` shows the demo for everyone, including logged-in and unverified users.
- Landing page link to `/demo` (link only; copy decided in planning).

### Out-of-Scope
- Save-after-signup and import into a real account (assumption: later phase; user said "tanpa signup" and "tidak perlu di store ke db").
- List and Calendar views; `ViewSwitcher` hidden, demo forces board view.
- AI intake, attachments and image staging, presence, tracker fields (status, priority, labels, project, phase), focus, activity feed, assignees, due dates, column policy/done/signable settings.
- Column delete (not in the real client either), templates.
- Cross-tab sync, analytics, SEO/sitemap decision (planning).
- Any change to `server/*` or the DB schema.

---

## Architecture Constraints

- Layers this work may touch: `client/src/App.tsx` / `main.tsx` (pre-App branch), `client/src/features/board` (data-source seam), new `client/src/features/demo/`, `scripts/feature-modules/map.mjs`, `scripts/check-work-item-mutation-routing.mjs` allowlist.
- Layers this work must NOT touch: `server/*`, DB schema, behavior of the authenticated API path.
- Patterns that must be followed: feature-module convention (new files ≤300 lines, public API through `features/demo/index.ts`, `features/demo/` registered in `map.mjs`); 300-on-touch extraction for `BoardProvider.tsx` (288 lines, will cross 300); client bundler imports (no extensions); creative brief tokens for the notice (Info semantic tokens, Work Sans, radius 6px); API-backed data source keeps calling `api.*` from `client/src/api.ts` so existing mocked tests still intercept.
- Architecture validation result: CONDITIONAL PASS (two claims UNVERIFIED, see below).

### Validation Evidence

| Claim or constraint | Codebase evidence | External source | Result |
|---|---|---|---|
| New code fits module boundaries | `scripts/feature-modules/map.mjs:3` has only `"board"` today; `features/demo` needs an entry | n/a | PASS (entry to add) |
| Board context reads are narrow and injectable | `BoardProvider.tsx:34-42`; grep of `useWorkspace()` in `features/board` (ColumnView, BoardPageSurface, ContextPanelSections x2, useContextPanelEditor) | n/a | PASS |
| Realtime can be disabled | `useBoardEventStream.ts` returns early only for `activeWorkspaceId === null`, else calls `refresh()` and `new EventSource(...)` | n/a | PASS with required change: explicit `enabled` flag |
| `/demo` can avoid all `/api/*` | `App.tsx:164` `useBuildReload` (fetches `/api/health`, `useBuildReload.ts:16`) and `api.me()` at `App.tsx:175` run before any gate | n/a | PASS only if the `/demo` branch sits above `App` (in `main.tsx` or a wrapper that does not mount `App`) |
| Mutation guard | `scripts/check-work-item-mutation-routing.mjs` allowlist = `workItemMutations.ts`, `api.ts`, `BoardProvider.tsx` | n/a | PASS with required change: add API data source file; memory source never calls `api.*` |
| Existing tests stay a regression net | 10 board tests mock the `api` module (`BoardContext.*`, `CardAttachments.integration`, `CardView.integration`, `ColumnView`, `AddCard`, `BoardCardTaxonomyFields`) | n/a | PASS if API source calls `api.*` |
| Description renders as plain text | `CardView.tsx:75-81` renders `{card.description}` as JSX text; panel uses a controlled textarea (`ContextPanelEditorView.tsx:129`) | n/a | PASS (no HTML injection from storage) |
| Server caps exist | `server/src/validators/input-length.ts` `MAX_LENGTHS` | n/a | PASS (demo reuses the numbers) |
| Third-party stubs needed | `AddCard.tsx:25` calls `useTaskMetadataCatalogs()`; `useShowToast` (13 board sites) and `useWorkspace` throw outside providers | n/a | PASS with required change: demo supplies toast provider and an empty catalog |
| No new dependency needed | client `package.json` has no `zod`; react-router `^7.18.2` installed | n/a | PASS |
| react-router patterns | `App.tsx` already uses `createBrowserRouter`, nested children, `Navigate`; routes used by demo are the same shapes | Context7 `/remix-run/react-router` (docs up to 7.9.4 only; installed 7.18.2): prefix routes with `children`, route-relative links, splat `*` | UNVERIFIED for 7.18-specific changes; low impact (patterns already in use) |
| Fixture content | `server/src/db/seed.ts` distribution 2/2/1/1 over 4 columns | n/a | PASS (titles copied in planning) |

---

## Dependencies

### Existing (to leverage)
- `react-router` 7.18.2 — demo route tree with `card/:cardId` child and `*` fallback.
- `@dnd-kit/core`, `@dnd-kit/sortable` — unchanged drag behavior through reused board components.
- Existing board components, `ToastProvider`, `boardViewPrefs.ts` storage pattern.

### New (proposed)
none. Payload validation is a small hand-written guard in `features/demo/` (no client validation library; adding `zod` to the client for one guard is not worth a new dependency).

---

## Stories + Scenarios

### Story 1: See a working board
> As a logged-out visitor, I want to open `/demo` and see a populated board, so that I can judge Camel before signing up.

**Rule 1.1:** `/demo` renders without auth and without any `/api/*` request, including `/api/health` and `/api/auth/me`.
**Rule 1.2:** First visit loads the fixture: Backlog 2 cards, To Do 2 cards (wip 5), In Progress 1 card (wip 3), Done 1 card. Fixture ids 1..6, keys `DEMO-1..6`, column ids 1..4.
**Rule 1.3:** `/demo` ignores auth state entirely (loading, logged in, unverified, expired); no redirect to `/board`, no global 401 handler.
**Rule 1.4:** A persistent notice says data is stored only in this browser.

```gherkin
Scenario: Visitor opens /demo for the first time
  Given a logged-out visitor with empty localStorage
  When  they navigate to /demo
  Then  the board shows Backlog, To Do, In Progress, Done with 6 cards (2/2/1/1)
  And   the "stored only in this browser" notice is visible
  And   no request is sent to /api/*

Scenario: Logged-in user opens /demo
  Given a user logged in with a verified email
  When  they navigate to /demo
  Then  the demo board renders, the URL stays /demo, and no /api/* request is sent

Scenario: Unverified or expired session on /demo
  Given a user whose email is unverified (or whose session expired)
  When  they open /demo
  Then  the demo renders with no redirect and no /api/* request

Scenario: Demo does not open realtime stream
  Given the demo board is mounted
  When  it finishes loading
  Then  no EventSource is created
```

### Story 2: Work on the board
> As a visitor, I want to add, edit, move, and delete cards and tweak columns, so that trying the product feels real.

**Rule 2.1:** Card add/edit/move/delete and column add/rename/WIP edit mutate in-memory state and write to `localStorage`.
**Rule 2.2 (WIP parity):** WIP limit is a positive integer or null (0 and 1.5 rejected, old value kept). Add is disabled when the column is full. A cross-column move into a full column is rejected with toast "WIP limit reached — finish something first." and nothing is written. Within-column reorder in a full column is allowed. Lowering a limit below the card count is allowed (over-limit style).
**Rule 2.3 (positions):** Fractional positions only. `POSITION_GAP = 1024`, `MIN_SPACING = 1e-9` (same values as `server/src/core/position.ts`). When neighbors are closer than `MIN_SPACING`, the column is rebalanced to `(i+1)*1024` and the dropped card keeps its slot between the same neighbors. Rebalancing rewrites positions but does not bump versions.
**Rule 2.4 (version):** Card `version` starts at 1 and increases by 1 per successful edit or move of that card. An update carrying an expected version different from the stored one is rejected and not applied (data-source level; no user-visible conflict UI).
**Rule 2.5 (ids):** User-created cards get `id = nextId`, key `DEMO-<id>`; `nextId` only increases (never below 7) and lives in the payload. User-created ids are never reused after a delete.
**Rule 2.6 (limits):** Card title trimmed, 1..255; description ≤10000; column name 1..50 (same as `MAX_LENGTHS`). Over-limit or whitespace-only input is rejected like on the real board, nothing is written. Serialized payload (UTF-8 bytes of the JSON string) ≤512 KB: a mutation that would exceed it is rejected with a visible message ("Demo storage is full — delete something first."), state and storage unchanged.
**Rule 2.7:** Double submit creates one card with a unique id.

```gherkin
Scenario: Add a card
  Given the fixture board
  When  the visitor adds "Write pitch" to Backlog
  Then  the card appears at the bottom of Backlog with key DEMO-7
  And   localStorage contains it and after reload it is still there

Scenario: Move a card within WIP
  Given In Progress holds 2 of 3 cards (set up in the test)
  When  the visitor drags a To Do card into In Progress
  Then  the card appears at the dropped index with a float position between its neighbors

Scenario: Move a card into a full column
  Given In Progress holds 3 of 3 cards
  When  the visitor drags a To Do card into In Progress
  Then  the card returns to To Do
  And   the toast "WIP limit reached — finish something first." is shown
  And   localStorage is unchanged

Scenario: Reorder inside a full column
  Given In Progress holds 3 of 3 cards
  When  the visitor reorders inside In Progress
  Then  the reorder succeeds with no toast

Scenario: Neighbors too close
  Given two adjacent cards whose positions differ by less than 1e-9
  When  the visitor drops a card between them
  Then  the column is rebalanced to 1024-spaced values
  And   the dropped card sits between the same two neighbors
  And   no card version changes except the moved card

Scenario: Delete a card
  Given the fixture board
  When  the visitor drops a card on the trash zone
  Then  the card is removed from state and localStorage

Scenario: Invalid WIP limit
  Given a column with wip 3
  When  the visitor saves wip 0 (or 1.5)
  Then  it is rejected and wip stays 3

Scenario: Payload would exceed 512 KB
  Given the stored payload is 511 KB
  When  the visitor saves a description that makes it exceed 512 KB
  Then  the save is rejected with "Demo storage is full — delete something first."
  And   state and localStorage are unchanged

Scenario: Whitespace-only or over-cap title
  Given a card titled "Alpha"
  When  the visitor saves a title of "   " (or 256 characters)
  Then  the save is rejected, the title stays "Alpha", and localStorage is not written

Scenario: Version guard
  Given a card at version 3
  When  the data source receives an update expecting version 2
  Then  the update is rejected and the card is unchanged

Scenario: User-created ids never reused
  Given cards DEMO-1..DEMO-6 and nextId = 7
  When  the visitor adds a card (DEMO-7), deletes it, and adds another
  Then  the second new card is DEMO-8

Scenario: Double submit
  Given the add-card form
  When  the visitor double-clicks submit
  Then  one card is created with a unique id
```

### Story 3: Reset
> As a visitor, I want to reset the board, so that I can start over.

**Rule 3.1:** Reset needs confirmation; Escape or outside click cancels.
**Rule 3.2:** Confirmed reset restores the fixture columns and cards with their original ids (DEMO-1..6), overwrites localStorage, sets `nextId = max(stored nextId, 7)`, closes any open panel, editor or drag, and returns the URL to `/demo`.

```gherkin
Scenario: Confirmed reset
  Given the visitor added 3 cards and deleted DEMO-6
  When  they press Reset and confirm
  Then  the board shows the fixture (6 cards, DEMO-1..6, DEMO-6 back)
  And   localStorage holds the fixture columns and cards, nextId unchanged (10)

Scenario: Cancelled reset
  Given the visitor added 3 cards
  When  they press Reset and press Escape
  Then  the board is unchanged

Scenario: Reset while a card panel is open
  Given /demo/card/3 is open
  When  the visitor confirms Reset
  Then  the panel closes and the URL is /demo
```

### Story 4: Unreliable storage
> As a visitor in a private window or with a stale payload, I still want a working board.

**Rule 4.1:** All storage reads and writes are in try/catch.
**Rule 4.2:** Payload shape `{ version: 1, nextId, columns, cards }` under key `camel.demoBoard.v1` (key suffix and payload version bump together). On load validate: JSON object, version 1, unique ids, every card `columnId` exists, finite positions, WIP null or integer ≥1, length caps, `nextId` greater than max card id, size ≤512 KB (UTF-8 bytes of the serialized JSON). Any failure loads the fixture and replaces the stored value.
**Rule 4.3:** If writes fail, in-memory state stays authoritative and a notice says changes will not survive a reload, shown once per session. Write failure is also treated the same for quota errors.
**Rule 4.4:** Cross-tab is last-write-wins; no `storage` listener in v1.
**Rule 4.5:** The key is independent of `boardViewModeByWorkspace`; demo forces board view; auth flows never read or clear the key.

```gherkin
Scenario: Storage unavailable on write
  Given localStorage.setItem throws on every write
  When  the visitor makes 5 edits
  Then  all 5 appear in-session
  And   the non-persist notice appears once

Scenario: Storage unavailable on read
  Given localStorage.getItem throws
  When  the visitor opens /demo
  Then  the fixture loads and the non-persist notice shows

Scenario: Corrupt or wrong-shape payload
  Given localStorage holds "{not json", or "null", or an array
  When  the visitor opens /demo
  Then  the fixture loads and the stored value is replaced

Scenario: Older schema version
  Given a payload with version 0
  When  the visitor opens /demo
  Then  the fixture loads

Scenario: Tampered references
  Given a payload with version 1 and a card whose columnId does not exist
  When  the visitor opens /demo
  Then  the fixture loads

Scenario: Tampered nextId
  Given a payload whose nextId is not greater than the max card id
  When  the visitor opens /demo
  Then  the fixture loads

Scenario: Shared view-mode key says calendar
  Given boardViewModeByWorkspace holds "calendar"
  When  the visitor opens /demo
  Then  the board view renders
```

### Story 5: Isolation from product surfaces
> As the product team, I want per-user features absent in the demo, so that nothing reaches the server or a real workspace.

**Rule 5.1:** ViewSwitcher, AI intake, attachments and image staging, presence, tracker fields, focus, activity feed, assignees, due dates are not rendered.
**Rule 5.2:** Board links use a base path from a small `BoardEnv` context (default `/board`, demo `/demo`). Only `/demo` and `/demo/card/:cardId` exist; any other `/demo/*` redirects to `/demo`. The route param is the numeric id. Unknown or non-numeric ids keep the URL, show the board, panel closed. Back from a card returns to `/demo`.
**Rule 5.3:** Demo state never reaches a real workspace.

```gherkin
Scenario: Open card panel
  Given the demo board
  When  the visitor clicks a card
  Then  the URL becomes /demo/card/<id>
  And   the panel shows title, description, column; no attachment, AI, assignee or due-date controls

Scenario: Unknown card id
  Given the demo board
  When  the visitor opens /demo/card/99999 (or /demo/card/abc)
  Then  the URL stays, the board renders, the panel is closed, no error page

Scenario: Deep link on hard reload
  Given the payload contains card 3
  When  the visitor loads /demo/card/3 directly
  Then  the board and the panel open

Scenario: Delete the open card
  Given /demo/card/3 is open
  When  the visitor drops card 3 on the trash zone
  Then  the panel closes and the URL is /demo

Scenario: Unknown demo route
  Given a visitor
  When  they open /demo/foo
  Then  they are redirected to /demo

Scenario: Back button
  Given the visitor opened a card from /demo
  When  they press Back
  Then  the panel closes and the URL is /demo

Scenario: Logged-in user edits demo
  Given a logged-in user edits a card at /demo
  When  they open /board
  Then  the real board is unchanged and no demo state was sent to any API
```

### Story 6: Real board unchanged
> As an existing user, I want the authenticated board to behave exactly as before.

**Rule 6.1:** The API-backed data source calls `api.*` from `client/src/api.ts`; behavior is identical.
**Rule 6.2:** Existing board tests pass unmodified.
**Rule 6.3:** `make check`, `check:mutation-routing`, `check:feature-modules`, lint and typecheck pass.

```gherkin
Scenario: Authenticated board loads
  Given a logged-in user with an active workspace
  When  they open /board
  Then  api.getBoard is called and the SSE stream is opened

Scenario: Stale card save on real board
  Given an authenticated card edit with an old version
  When  the save is sent
  Then  the API returns 409 and the existing conflict path runs
```

---

## Acceptance Criteria

```
ACCEPTANCE CRITERIA — Demo board (client-only)
Date: 2026-10-11 | Scope confirmed: from the user's request; import-after-signup excluded by assumption

Rule: Access and isolation (1.x, 5.x)
  ✓ Given a visitor, When opening /demo, Then the fixture renders with the notice, with no /api/* request (including /api/health, /api/auth/me) and no EventSource
  ✓ Given a logged-in, unverified or expired user, When opening /demo, Then the demo renders with no redirect
  ✓ Given /demo/card/<unknown or non-numeric>, Then the URL stays and the panel is closed
  ✗ Given /demo/foo, When opened, Then redirect to /demo

Rule: Board behavior parity (2.x)
  ✓ add, move, delete persist; user ids monotonic; positions fractional with rebalance
  ✓ WIP: add disabled when full; cross-column move rejected with the toast; reorder allowed
  ✗ wip 0 or 1.5; empty, whitespace or over-cap title or name; stale expected version → rejected, nothing written

Rule: Persistence and reset (3.x, 4.x)
  ✓ reload keeps edits; confirmed reset restores DEMO-1..6, closes panel, URL /demo
  ✗ corrupt, wrong-shape, old-version, dangling columnId, bad nextId payload → fixture
  ✓ storage unavailable → works in session, notice once

Rule: Authenticated board unchanged (6.x)
  ✓ existing BoardContext.*, CardAttachments.integration, CardView.integration, ColumnView, AddCard tests pass unmodified
  ✓ make check, check:mutation-routing, check:feature-modules, lint, typecheck pass
```

---

## Design Decision

**Chosen option:** Option B — data-source injection.

**Summary:** Extract a `BoardDataSource` interface (the ~15 board calls). `BoardProvider` takes the data source plus explicit props (`workspaceId`, `user`, `enabled` for realtime). Two implementations: `apiBoardDataSource` (calls `api.*`) and `memoryBoardDataSource` in `features/demo/`. Board components read a narrow `BoardEnv` (`workspaceId`, `boardBasePath`, feature flags, forced view mode) instead of `useWorkspace()`. The `/demo` branch is mounted above `App` so `useBuildReload` and `api.me()` never run. Demo supplies its own `ToastProvider` and an empty task-metadata catalog.

**Rejected options:**
- Option A (parallel `DemoBoardProvider` + stub contexts): rejected because WIP, position and version logic would be duplicated inside a second provider, and stubbing `WorkspaceContext` grows with every board change; fails the "no drift" intent behind Rules 2.2–2.4.
- Option C (fake `fetch` in browser): rejected because it must also fake SSE, uploads, AI and auth probes (Story 1, 5), re-implements 409/WIP/position semantics, and ships a fake backend to production.

**Key tradeoffs accepted:**
- Refactors the authenticated path (`BoardProvider`, `useBoardPageActions`, `useBoardDragInteractions`, `useContextPanelEditor`, `BoardCardTaxonomyFields`); regression net is the existing mocked-`api` tests.
- Server rules (WIP, position, version, caps) exist twice (server and memory source); parity is held by the shared scenarios above, not by shared code.
- Allowlist in `scripts/check-work-item-mutation-routing.mjs` is extended for the new API data source file.
- Board links use a `boardBasePath` value rather than route-relative links, because the hard-coded sites sit at different route depths.

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Import after signup in v1? | assumed: later phase | Scope grows by a server import endpoint and retry flow |
| Which views in demo? | assumed: board only | Calendar/list add date and tray handling |
| Per-user surfaces hidden or disabled? | assumed: hidden | Visitors may wonder where features are |
| Logged-in users see demo at `/demo`? | assumed: yes | If redirect is wanted, add a branch and update Story 1 |
| Fixture content | assumed: copy of `seed.ts` titles, 2/2/1/1 | Cosmetic |
| Reset keeps `nextId`, restores fixture ids | assumed: yes (see Rule 3.2) | Deep link `/demo/card/6` can reopen the restored fixture card |
| Demo caps (title 255, description 10000, column 50, payload 512 KB) | assumed: server `MAX_LENGTHS`; payload cap is our choice | Limit mismatch is cosmetic |
| Cross-tab last-write-wins | assumed: acceptable | A stale tab can overwrite a Reset |
| Landing CTA copy, SEO/sitemap for `/demo` | decide in planning | Marketing only |
| react-router 7.18 specifics | UNVERIFIED (docs up to 7.9.4) | Low: demo uses patterns already in `App.tsx` |
| `/demo` branch location (`main.tsx` vs wrapper) | decide in planning | Must stay above `App`; otherwise `/api/health` and `/api/auth/me` fire |

---

## Implementation Notes

- Keep the WIP field visible in the column edit UI while hiding policy/done/signable settings (Rule 2.2 needs it).
- The "stored only in this browser" notice (Rule 1.4) and the "changes will not survive a reload" notice (Rule 4.3) are separate UI elements.
- Memory data source accepts the expected `version` from the panel edit path and rejects mismatches silently at data level; the 409 conflict scenario (Story 6) stays API-only.
- The card panel shows column name via the board's column data; do not pull in policy or tracker fields to render it.

- Branch `/demo` before `App` mounts; `App`'s `useBuildReload` and `api.me()` effects would otherwise violate Rule 1.1.
- Disable `useBoardEventStream` via an explicit flag; do not rely on `activeWorkspaceId === null`.
- `BoardProvider.tsx` will cross 300 lines: extract in the same PR (300-on-touch).
- Register `features/demo` in `scripts/feature-modules/map.mjs`; export via `index.ts` only.
- Notice and Reset UI follow `docs/pocket/rule/creative-brief.md` (Info semantic tokens, Work Sans, 6px radius).

## Rollback Plan

- Remove the `/demo` branch and landing link; the board seam is behavior-neutral for `/board`.
- The `camel.demoBoard.v1` `localStorage` key is orphaned harmlessly.
