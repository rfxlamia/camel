# Pitch Exploration: demo-board-client-only
Date: 2026-10-11 | Project: Camel | Status: pitch-only | Source issue: #207

---

## Problem Statement
Logged-out visitors cannot see Camel's board in use before creating an account, so the landing page has nothing to show beyond marketing copy. A public `/demo` route needs an interactive kanban board that runs entirely in the browser: no login, no database rows, no authenticated API calls, with state kept in client storage and a reset path.

## Root Tension
The board UI is the fidelity we want to reuse, but it is hard-wired to an authenticated `WorkspaceContext` and to the server API (`BoardProvider` plus 5 hook files). Decoupling it enough to run without a server, without forking the UI (drift risk), and without regressing the authenticated board is the hard part.

## Key Constraints
Evidence-based only.

- `client/src/features/board/BoardProvider.tsx` (288 lines) calls `useWorkspace()`, `api.getBoard/getMetrics/getActivity/updateCard/deleteCard`, and subscribes to SSE via `useBoardEventStream`.
- `useWorkspace()` is imported in 13 places across board features. `usePresence()` in 7. `useShowToast()` in 13. Each one throws when rendered outside its provider (`shared/WorkspaceContext.tsx`, `shared/PresenceContext.tsx`, `shared/TaskMetadataCatalogProvider.tsx`, `shared/ToastContext.tsx`).
- Board API calls live in `BoardProvider.tsx`, `useBoardPageActions.ts`, `useBoardDragInteractions.ts`, `BoardCardTaxonomyFields.tsx`, `useContextPanelEditor.ts`. `ContextPanelSections.tsx` calls `api.ticketIntake` (AI).
- `TaskMetadataCatalogProvider` fetches `getWorkspaceMembers`, `listTrackerVocabularies`, and `listTrackerProjects` on mount, so it must be stubbed or bypassed in demo.
- Navigation is hard-coded to `/board` and `/board/card/:id` in `ContextPanelSurface.tsx`, `cardPanel.ts`, `CalendarView.tsx`, `BoardPageSurface.tsx`, and `ContextPanelEditorView.tsx`. A `/demo` mount breaks these unless links become relative or base-path aware.
- `App.tsx` gates by auth state. The public router has `*` → `/`, and the authenticated router has `*` → `/board`. `/demo` must sit in a branch that runs before the auth gate, or a logged-in visitor gets redirected to real data.
- `api.ts` is 1055 lines, so touching it triggers 300-on-touch extraction. `configureRequestBoundaryForTests` exists but is test-only; it is not a runtime seam.
- Feature-module convention: new code goes in `client/src/features/demo/`, registered in `scripts/feature-modules/map.mjs`. Public API via `index.ts`. Files ≤300 lines.
- Mutations: board-native edits in `BoardContext.tsx` are the documented exception to the `workItemMutations.ts` routing rule. A new wrapper that calls `api.updateCard` outside that exception fails `npm run check:mutation-routing`.
- Seed fixture exists only server-side at `server/src/db/seed.ts` (4 columns: Backlog / To Do wip 5 / In Progress wip 3 / Done; 6 cards). The client cannot import it, so the demo needs its own client-owned fixture.
- Creative brief (`docs/pocket/rule/creative-brief.md`): Info semantic tokens for a "stored only in this browser" notice. Work Sans, base 16px, radius 6px. Tokens only.
- Existing precedent for client storage: `shared/boardViewPrefs.ts` (`localStorage` with try/catch and a fallback).
- Acceptance criteria from issue #207 (no-DB, reset, persistence, SEO, post-signup import with retry) apply as constraints.

---

## Brainstorming Methods Used

Selection: default trio (Question Storming, First Principles, Six Thinking Hats) plus Reverse Brainstorming for UX/product direction.

### Question Storming — deep
Key insights:
- Visitor goal is "feel that I can use it", not "read about it".
- "Tanpa login" means no account. "No DB" describes the demo runtime. The post-signup import in #207 is a separate question.
- Which views are in the demo (board only vs board/list/calendar)? Which per-user features (AI intake, attachments, tracker, presence) are hidden vs visibly disabled?

### First Principles Thinking — creative
Key insights:
- Needed: board state mutated in the client, plus the same UI rendering it. No server required.
- The cost sits in the data boundary and the context seams, not in the UI components.
- Per-user surfaces (presence, focus, activity, AI, attachments) cannot be real without identity. They are cut or stubbed.

### Six Thinking Hats — structured
Key insights:
- White: board is `BoardPageSurface` + `BoardProvider`; seed fixture is server-only.
- Red: the team fears a demo that drifts from the real board. Visitors fear losing work that lives only in one browser.
- Black: leaky abstraction (SSE, uploads, AI calls still firing). Two implementations diverge. Client-side re-implementation of server rules (fractional positions, WIP, versions) drifts.
- Green: one `BoardDataSource` interface with an API-backed and a memory-backed implementation.
- Blue: boundary + tests first, then fixture + route, then copy and SEO.

### Reverse Brainstorming — creative (UX)
Key insights:
- Failure: refresh loses work. Mitigation: `localStorage` persistence and a visible "stored only in this browser" notice (already #207 criteria).
- Failure: visitor believes the board is live and shared. Mitigation: explicit "demo, not synced" label.
- Failure: a disabled AI or attachment control throws a network error. Mitigation: hide or show a static sample.
- Failure: `/demo` indexed as an empty app shell. Mitigation: static explanatory copy and its own meta.
- Failure: reset deletes work with no confirmation. Mitigation: confirm step.

---

## Advisor Synthesis
Kept: the data boundary is the cost center. Every per-user surface must be cut or stubbed, which is a design decision. The drift between demo and real board is the core tension. Discarded: multi-tab sync and "conversion goes up" (noise for v1), plus most UX items that duplicate #207 acceptance criteria. Blind spots surfaced and verified in the spike: the router split and the wider context coupling, client-side reimplementation of server semantics, and the feature-module/300-line guardrails.
**Curation source:** advisor tool

---

## Spike Results

**Question:** Can the board surfaces render under a substitute data source and stub contexts, without forking the UI? Can `/demo` work without hard-coded `/board` navigation?

**Finding (verified by code scan):**
1. Context seams throw outside providers (`useWorkspace`, `usePresence`, `useTaskMetadataCatalogs`, `useShowToast`, `useBoard`). A demo must supply each one, or the surfaces that call them must stop calling them.
2. `WorkspaceContext` carries the whole authenticated session model (`user`, `activeWorkspaceId`, `workspaces`, `boardViewMode`, `switchWorkspace`, `signOutLocally`, `refreshSettings`, …). Stubbing it fully is brittle. Board code only needs a narrow subset.
3. Navigation to `/board` and `/board/card/:id` is hard-coded in 6 sites. A `/demo` mount breaks them without relative links or a base-path context.
4. `configureRequestBoundaryForTests` is test-only. Using it in production means a fetch interceptor (Direction C), which is a hack.
5. `BoardProvider.tsx` is 288 lines. Adding a data-source seam crosses 300, so extraction is required in the same PR.
6. `App.tsx` is 204 lines. Adding a pre-auth `/demo` branch is cheap.

**Implication:** Every direction must (a) narrow board's dependency on `useWorkspace` to explicit props, (b) make board navigation base-path aware, and (c) add a pre-auth `/demo` branch. A seam at the data source alone is not enough. Unresolved for grinding: the exact prop surface that replaces `useWorkspace` inside board components, and whether `useBoardEventStream` can be a no-op or must be bypassed.

---

## Approach Directions

### Direction A: Parallel demo provider
A `DemoBoardProvider` supplies the same `BoardContext` value, backed by in-memory state plus `localStorage`. Stub `WorkspaceContext`, `PresenceContext`, `TaskMetadataCatalog`, and `ToastContext` wrap the reused presentational components. The authenticated `BoardProvider` is untouched.
+ No change to the authenticated board path, so lowest regression risk.
− Stub `WorkspaceContext` must mimic a large session model. Demo can drift from real board behavior since logic is duplicated.

### Direction B: Data-source injection (recommended)
Extract a `BoardDataSource` interface (the 15 board API methods used). `BoardProvider` takes a data source and explicit props (`workspaceId`, `user`, optional features) in place of `useWorkspace()`. Two implementations: API-backed (existing behavior) and memory-backed (`features/demo/`). Board components get base-path-aware links.
+ One board implementation and one logic path. Matches #207's "small data/mutation boundary" guidance. No drift.
− Refactors `BoardProvider` and 5 hook files on the authenticated path. Requires the 300-line extraction. Needs the existing `BoardContext.*` test suite as the regression net.

### Direction C: Fake the request layer in the browser
Intercept `fetch` for `/api/workspaces/*/board` and friends. Serve fixture responses from an in-memory handler. No component edits.
+ Fastest to a visible demo. Components run unchanged.
− Reimplements server semantics (positions, WIP, versions, 409s) inside the fake, so it drifts. Still needs a stub `WorkspaceContext`. Ships a fake backend to production. Uses `configureRequestBoundaryForTests` in prod, which is a hack.

---

## Open Questions for pocket-grinding
- [ ] **Scope (asked to user):** Is save-after-signup + import (#207 "Save this board") in v1, or a later phase? **Assumed:** later phase. The client-only demo is the core. Reason: "tanpa signup" and "tidak perlu di store ke db".
- [ ] Which views ship in the demo: board only, or board + list + calendar? **Assumed:** board only for v1.
- [ ] Per-user surfaces (AI intake, attachments, tracker vocab, presence, focus): hidden, or visibly disabled with a notice? **Assumed:** hidden.
- [ ] Can logged-in users open `/demo` (show demo) or be redirected to `/board`? **Assumed:** shown.
- [ ] Exact prop surface that replaces `useWorkspace()` inside board components. Which fields does board actually read?
- [ ] Does `useBoardEventStream` become a no-op in demo, or does the data source own subscriptions?
- [ ] Client-owned fixture: copy of `server/src/db/seed.ts` (4 columns, 6 cards) or a new sample set?
- [ ] Storage versioning: `localStorage` key format, behavior when storage is unavailable (private window), and a corrupt payload fallback.
- [ ] Mutation routing: does a memory-backed data source need to pass `check:mutation-routing`? Confirm it is covered by the `BoardContext.tsx` exception or needs an allowlist update.
- [ ] Sitemap: add `/demo` with its own title/description and static copy, or keep it out? (#207 allows either with copy.)

---

## Recommended Direction
Direction B. It is the only option with one board implementation and no drift, and #207 already prescribes a data-source boundary. The regression risk on the authenticated path is covered by the existing `BoardContext.*` tests. A and C each duplicate logic and drift.

---

## Handoff Context (for pocket-grinding)
When pocket-grinding reads this doc:
- Start with this problem statement (Phase 1 context).
- Use Direction B as the working hypothesis for Phase 5 design proposals.
- Treat Open Questions as Phase 3 discovery targets. Import-after-signup is explicitly out of v1 unless the user says otherwise.
- Required pre-auth `/demo` branch in `App.tsx`, before the `authChecked` / `user` gates.
- Required feature-module registration (`scripts/feature-modules/map.mjs`) for `features/demo/`.
- Do NOT treat Approach Directions as final architecture. Validate through GWT first.
