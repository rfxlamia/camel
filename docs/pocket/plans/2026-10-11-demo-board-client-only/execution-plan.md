# EXECUTION PLAN — Demo Board (client-only)

**Date:** 2026-10-11  
**Spec:** `docs/pocket/spec/2026-10-11-demo-board-client-only/demo-board-spec.md`  
**Status:** draft  
**Total tasks:** 16

---

## Preflight Summary

**Codebase scanned:** `client/src/main.tsx`, `client/src/App.tsx`, relevant board provider/event-stream/drag/actions/panel/column/add-card modules, shared workspace/toast/task-catalog/view-preference modules, feature map and mutation-routing guard, `LandingPage.tsx`, server fixture/position/input-length references, and feature-module ADR. Recent history and test locations were checked for affected areas.

**Test framework:** Client uses Vitest + Testing Library; tests are colocated and declare jsdom where needed. Individual tests use `npm run test --workspace=client -- <workspace-relative-path>` from repo root. Full suite: `npm run test`.

**File conventions:** Client imports omit extensions. Cross-feature imports use public `index.ts`. New production `.ts/.tsx` files ≤300 lines; non-trivially touched oversized files must be extracted to ≤300 lines. Existing board tests stay unmodified and their API mocks remain valid.

**Existing helpers:** `boardColumnMoves.ts`, `boardPageUtils.ts`, `cardPanel.ts` (`parseCardId`, `getMissingCardRedirect`), `TaskMetadataCatalogProvider`, and `boardViewPrefs.ts`. No client fractional-position helper exists; create a named demo helper. Server parity references: `POSITION_GAP = 1024`, `MIN_SPACING = 1e-9`; title/description/column caps are 255/10000/50.

**Library docs checked:** Installed React Router `7.18.2`; Context7 documentation available through `7.9.4`/current docs, not installed version. Exact-version route behavior remains unverified; test against installed dependency. Installed `@dnd-kit/core@6.3.1`/`@dnd-kit/sortable@10.0.0`; newer Context7 APIs were for different packages. Retain repo usage; no DnD API change proposed.

**Key findings:** `App.tsx` creates its router at module evaluation, then runs `useBuildReload()` and `api.me()`. Demo must branch before importing/evaluating App. `useBoardEventStream` currently performs initial refresh and opens EventSource; gate only the stream, not initial refresh. Oversized touched sources require extraction: `BoardProvider.tsx` (289 lines), `useContextPanelEditor.ts` (301), `ColumnView.tsx` (412), `BoardCardTaxonomyFields.tsx` (395), `LandingPage.tsx` (647). User approved adding/registering `features/landing/`. Synthetic workspace id `-1` is local-only and must never reach an API.

**Planning calls:** Landing CTA labels are “Try the live demo” and “Sign up”. No sitemap, robots or indexing-policy changes. Signup import is later phase.

**Unverified:** React Router `7.18.2`-specific behavior and exact-version DnD documentation; retain risks in relevant packets.

---

## Execution Overview

### Recommended Order

```text
T1 → T2, T3 (parallel) → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11 → T12 → T13 → T14 → T15, T16 (parallel)
```

> Dependencies are recommended; Pocket execution enforces actual sequencing.

### Phases

| Phase | Tasks | Purpose |
|---|---|---|
| A. Shared seams | T1–T3 | Runtime contracts, API adapter and module bootstrap |
| B. Local model | T4–T11 | Fixture validation, CRUD, moves and persistence safety |
| C. Reused board UI | T12–T13 | Capability gates, base paths and deletion |
| D. Demo runtime | T14–T15 | Client-only composition, routes and reset |
| E. Public launch | T16 | Main entry isolation and landing feature extraction |

### Parallelizable Groups

| Group | Tasks | Unblocked After |
|---|---|---|
| Group A | T2, T3 | T1 completes |
| Group B | T15, T16 | T14 completes |

### Constraints Reminder

**Architecture:** Client-only; no `server/*` or DB changes. Preserve authenticated `/board`, existing `useWorkspace()` calls, API call timing/mocks and default API datasource. Demo uses shared board, memory source, typed synthetic WorkspaceContext and BoardEnv; never fork UI or mount/evaluate App. Keep initial refresh active when SSE is disabled. Register `demo` and `landing`; feature cross-imports use public indexes. All new/touched oversized sources ≤300 lines.

**Out of scope:** Signup import/save; demo List/Calendar views; AI intake; attachments/image staging; presence; taxonomy/tracker fields; focus; activity feed; assignees; due dates; column deletion; templates; cross-tab sync; analytics; SEO/sitemap/indexing changes; server and DB changes.

**Assumptions at risk:** Reset preserves `max(stored nextId, 7)`; payload cap is 512 KB; cross-tab is last-write-wins; signup import is later phase. Fixed by approved spec.

### File Structure Map

```text
Rule: Shared board runtime contracts (T1)
  Create: client/src/features/board/boardDataSource.ts
  Create: client/src/features/board/BoardDataSourceContext.tsx
  Create: client/src/features/board/BoardEnvContext.tsx
  Modify: client/src/features/board/index.ts
  Modify: client/src/shared/WorkspaceContext.tsx
  Modify: client/src/shared/workspaceContextTypes.ts
  Test:   client/src/features/board/BoardEnvContext.test.tsx
  Test:   client/src/shared/WorkspaceContext.demoProvider.test.tsx

Rule: Existing API-backed board and realtime behavior (T2; Rules 1.1, 6.1–6.3)
  Create: client/src/features/board/apiBoardDataSource.ts
  Create: client/src/features/board/useBoardRefreshController.ts
  Modify: client/src/features/board/BoardProvider.tsx
  Modify: client/src/features/board/useBoardEventStream.ts
  Modify: client/src/features/board/useBoardPageActions.ts
  Modify: client/src/features/board/useBoardDragInteractions.ts
  Modify: scripts/check-work-item-mutation-routing.mjs
  Test:   client/src/features/board/apiBoardDataSource.test.ts
  Test:   client/src/features/board/BoardDataSourceColumnSettings.test.tsx
  Test:   client/src/features/board/BoardContext.realtimeFlag.test.tsx
  Test (unchanged): client/src/features/board/BoardContext.focusGuard.test.tsx
  Test (unchanged): client/src/features/board/BoardContext.focusSeams.test.tsx
  Test (unchanged): client/src/features/board/BoardContext.attachments.test.tsx
  Test (unchanged): client/src/features/board/BoardContext.focusFlag.test.tsx
  Test (unchanged): client/src/features/board/BoardContext.viewMode.test.tsx
  Test (unchanged): client/src/features/board/BoardCardTaxonomyFields.test.tsx
  Test (unchanged): client/src/features/board/ContextPanel.test.tsx
  Test (unchanged): client/src/features/board/AddCard.test.tsx
  Test (unchanged): client/src/features/board/useAddCardImageStaging.test.tsx
  Test (unchanged): client/src/features/board/CardView.integration.test.tsx
  Test (unchanged): client/src/features/board/ColumnView.test.tsx
  Test (unchanged): client/src/features/board/CardAttachments.integration.test.tsx

Rule: Feature-module bootstrap (T3)
  Modify: scripts/feature-modules/map.mjs
  Create: scripts/feature-modules/map.test.mjs
  Create: client/src/features/demo/index.ts
  Create: client/src/features/landing/index.ts

Rule: Fixture/schema/load parsing (T4; Rules 1.2, 4.1–4.2)
  Create: client/src/features/demo/demoBoardFixture.ts
  Create: client/src/features/demo/demoBoardTypes.ts
  Create: client/src/features/demo/demoBoardPayloadValidation.ts
  Create: client/src/features/demo/demoBoardStore.ts
  Test:   client/src/features/demo/demoBoardStore.test.ts

Rule: Stored reference/identity validation (T5; Rule 4.2)
  Modify: client/src/features/demo/demoBoardPayloadValidation.ts
  Modify: client/src/features/demo/demoBoardStore.ts
  Test:   client/src/features/demo/demoBoardStore.test.ts

Rule: Stored card text limits (T6; Rule 4.2)
  Modify: client/src/features/demo/demoBoardPayloadValidation.ts
  Modify: client/src/features/demo/demoBoardStore.ts
  Test:   client/src/features/demo/demoBoardStore.test.ts

Rule: Stored column/WIP/size limits (T6; Rule 4.2)
  Modify: client/src/features/demo/demoBoardPayloadValidation.ts
  Modify: client/src/features/demo/demoBoardStore.ts
  Test:   client/src/features/demo/demoBoardStore.test.ts

Rule: Card CRUD/version/IDs (T7; Rules 2.1, 2.4–2.7)
  Create: client/src/features/demo/memoryBoardDataSource.ts
  Create: client/src/features/demo/demoBoardCardMutations.ts
  Modify: client/src/features/demo/index.ts
  Test:   client/src/features/demo/memoryBoardDataSource.test.ts

Rule: Card mutation text validation (T8; Rule 2.6)
  Modify: client/src/features/demo/demoBoardCardMutations.ts
  Modify: client/src/features/demo/memoryBoardDataSource.ts
  Test:   client/src/features/demo/memoryBoardDataSource.test.ts

Rule: Column CRUD/WIP (T9; Rules 2.1–2.2, 2.6)
  Create: client/src/features/demo/demoBoardColumnMutations.ts
  Modify: client/src/features/demo/memoryBoardDataSource.ts
  Test:   client/src/features/demo/memoryBoardDataSource.test.ts

Rule: Move/WIP/fractional position (T10; Rules 2.2–2.4)
  Create: client/src/features/demo/demoBoardPosition.ts
  Modify: client/src/features/demo/memoryBoardDataSource.ts
  Test:   client/src/features/demo/memoryBoardDataSource.test.ts
  Test:   client/src/features/demo/DemoBoardDrag.integration.test.tsx

Rule: Atomic size cap and storage failures (T11; Rules 2.6, 4.1, 4.3–4.4)
  Modify: client/src/features/demo/demoBoardStore.ts
  Modify: client/src/features/demo/memoryBoardDataSource.ts
  Test:   client/src/features/demo/demoBoardStore.test.ts
  Test:   client/src/features/demo/memoryBoardDataSource.test.ts

Rule: Demo board controls/editor (T12; Rules 2.1–2.7, 5.1, 6.2)
  Create: client/src/features/board/ColumnSettings.tsx
  Create: client/src/features/board/BoardCardTaxonomyFieldsView.tsx
  Create: client/src/features/board/useContextPanelAttachments.ts
  Modify: client/src/features/board/BoardPageSurface.tsx
  Modify: client/src/features/board/ColumnView.tsx
  Modify: client/src/features/board/ContextPanelSections.tsx
  Modify: client/src/features/board/ContextPanelEditorView.tsx
  Modify: client/src/features/board/useContextPanelEditor.ts
  Modify: client/src/features/board/BoardCardTaxonomyFields.tsx
  Modify: client/src/features/board/AddCard.tsx
  Modify: client/src/features/board/AddCardForm.tsx
  Modify: client/src/features/board/useAddCardSubmit.ts
  Test:   client/src/features/demo/DemoBoardControls.test.tsx
  Test:   client/src/features/demo/DemoBoardPanel.integration.test.tsx

Rule: Board paths/deletion (T13; Rule 5.2)
  Modify: client/src/features/board/ContextPanelSurface.tsx
  Modify: client/src/features/board/cardPanel.ts
  Modify: client/src/features/board/ContextPanelEditorView.tsx
  Modify: client/src/features/board/useContextPanelEditor.ts
  Test:   client/src/features/demo/DemoBoardNavigation.integration.test.tsx

Rule: Client-only demo shell/notices (T14; Rules 1.1–1.4, 4.3–4.5)
  Create: client/src/features/demo/DemoApp.tsx
  Create: client/src/features/demo/DemoBoardPage.tsx
  Create: client/src/features/demo/DemoStorageNotice.tsx
  Modify: client/src/features/demo/index.ts
  Modify: client/src/shared/TaskMetadataCatalogProvider.tsx
  Test:   client/src/features/demo/DemoApp.integration.test.tsx
  Test:   client/src/features/demo/DemoBoardPage.test.tsx

Rule: Demo routes/reset (T15; Rules 3.1–3.2, 5.2)
  Create: client/src/features/demo/DemoResetControl.tsx
  Modify: client/src/features/demo/DemoApp.tsx
  Modify: client/src/features/demo/DemoBoardPage.tsx
  Test:   client/src/features/demo/DemoApp.integration.test.tsx
  Test:   client/src/features/demo/DemoBoardPage.test.tsx

Rule: Public entry/landing (T16; Rules 1.1, 1.3, 5.2)
  Create: client/src/features/landing/LandingPage.tsx
  Create: client/src/features/landing/LandingHeader.tsx
  Create: client/src/features/landing/LandingHero.tsx
  Create: client/src/features/landing/landingContent.ts
  Create: client/src/features/landing/LandingFeaturePreview.tsx
  Create: client/src/features/landing/LandingFeatureSection.tsx
  Create: client/src/features/landing/LandingPracticesSection.tsx
  Create: client/src/features/landing/LandingFinalCta.tsx
  Create: client/src/features/landing/LandingFooter.tsx
  Modify: client/src/features/landing/index.ts
  Modify: client/src/main.tsx
  Modify: client/src/pages/LandingPage.tsx
  Test:   client/src/features/demo/mainEntry.integration.test.tsx
  Test:   client/src/features/landing/LandingPage.test.tsx
```

---

## Pocket Packets

---

### Task 1: Define shared board runtime contracts [prereq]

## OBJECTIVE
Define the BoardDataSource contract, safe BoardEnv defaults and a typed synthetic WorkspaceContext provider. Preserve existing `useWorkspace()` call sites and BoardProvider props.

Steps:
1. Write a failing test for: BoardEnv defaults preserve the authenticated environment.
   Test file: `client/src/features/board/BoardEnvContext.test.tsx`
   Level: unit
   Test intent: Given no BoardEnv provider, When a board consumer reads it, Then basePath is `/board`, authenticated flags are enabled and realtime is enabled.
   Exercise through: exported BoardEnv hook/default.
   Test doubles: none; do not mock context under test.
   Expected RED: BoardEnv context/defaults do not exist.
2. Run test — verify FAIL: `npm run test --workspace=client -- src/features/board/BoardEnvContext.test.tsx`
3. Implement typed defaults; run test to PASS, refactor while green and commit as `feat(board): define board runtime environment`.
4. Write a failing test for: demo WorkspaceContext ignores stored calendar preference.
   Test file: `client/src/shared/WorkspaceContext.demoProvider.test.tsx`
   Level: unit
   Test intent: Given `localStorage.setItem("boardViewModeByWorkspace", JSON.stringify({ "-1": "calendar" }))`, When demo provider supplies `useWorkspace()`, Then consumers receive complete synthetic value with workspace id `-1`, boardViewMode `board`, disabled flags/no-op setters; serialized value stays unchanged and `-1` is never sent to API.
   Exercise through: demo WorkspaceContext provider and unchanged `useWorkspace()` hook.
   Test doubles: seed/read localStorage and spy on fetch; do not mock provider/hook.
   Expected RED: demo provider is absent and hook throws outside WorkspaceProvider.
5. Run test — verify FAIL: `npm run test --workspace=client -- src/shared/WorkspaceContext.demoProvider.test.tsx`
6. Add typed synthetic provider and BoardDataSource/BoardEnv contracts; export through board index. Run both tests to PASS, refactor while green and commit as `feat(board): add demo runtime contracts`.

## REFERENCES LOADED
- Spec Design Decision amendment; Rules 1.3, 4.5, 5.1.
- `client/src/shared/WorkspaceContext.tsx`, `workspaceContextTypes.ts`, `boardViewPrefs.ts`, `client/src/features/board/index.ts`.

## WHY THIS APPROACH
Complexity: standard. Typed contracts catch context drift without changing existing hook mocks.

## SANDWICH CONTEXT
[CRITICAL: Do not change existing `useWorkspace()` call sites or add required BoardProvider props.]  
Spec: `docs/pocket/spec/2026-10-11-demo-board-client-only/demo-board-spec.md`  
Files in scope: `client/src/features/board/boardDataSource.ts`, `client/src/features/board/BoardDataSourceContext.tsx`, `client/src/features/board/BoardEnvContext.tsx`, `client/src/features/board/index.ts`, `client/src/shared/WorkspaceContext.tsx`, `client/src/shared/workspaceContextTypes.ts`, and two listed tests.  
Available after: none.  
[RESTATE: Existing board tests/API mocks remain valid; synthetic workspace sentinel never reaches an API.]

## DELIVERABLE
Given no BoardEnv provider, When the board reads it, Then authenticated defaults apply. Given demo provider plus stored calendar preference, When `useWorkspace()` is read, Then board mode is forced to board and preference is unchanged.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have: full WorkspaceContextValue synthetic value; context/source exports through board index; every new source ≤300 lines.  
Must-not-have: authenticated behavior/API contract changes.  
Rollback note: remove new contexts/contracts/provider export.  
Red flags: required provider prop or changed hook mock → STOP.

## STOP CONDITIONS
Done when both tests pass and `/board` defaults remain unchanged. Escalate if synthetic value requires changing authenticated behavior.

---

### Task 2: Preserve the API-backed board through the data-source seam [depends: T1]

## OBJECTIVE
Implement the API BoardDataSource and route board reads/mutations through it. Separate initial refresh from SSE setup and keep touched files ≤300 lines.

Steps:
1. Write a failing test for: API adapter delegates methods to `api.*` at invocation time.
   Test file: `client/src/features/board/apiBoardDataSource.test.ts`
   Level: unit
   Test intent: Given mocked API methods, When adapter loads board data and performs card/column mutations, Then same methods receive same arguments and preserve values/errors.
   Exercise through: exported API source methods.
   Test doubles: mock only `../../api`; do not mock adapter.
   Expected RED: adapter does not exist.
2. Run test — verify FAIL: `npm run test --workspace=client -- src/features/board/apiBoardDataSource.test.ts`
3. Implement adapter, route BoardProvider load/save/delete through it, extract refresh coordination and extend mutation allowlist only for API datasource. Leave page-action/drag rewiring for next RED cycle. Run test to PASS, refactor while green and commit as `refactor(board): add API board datasource`.
4. Write a failing test for: invalid WIP form input reaches the injected source as null.
   Test file: `client/src/features/board/BoardDataSourceColumnSettings.test.tsx`
   Level: integration
   Test intent: Given column WIP 3 and a recording DataSource, When the existing inline ColumnSettings form saves 0 or 1.5, Then updateColumn receives `wipLimit: null` and `api.updateColumn` is not called.
   Exercise through: real BoardPageSurface/ColumnView/inline ColumnSettings and `useBoardPageActions` under BoardDataSourceContext; test runs before T12 extracts ColumnSettings.tsx.
   Test doubles: recording DataSource and mock only external API; do not mock form/action/component.
   Expected RED: `useBoardPageActions` still calls `api.updateColumn` directly.
5. Run test — verify FAIL: `npm run test --workspace=client -- src/features/board/BoardDataSourceColumnSettings.test.tsx`
6. Route page actions/drag mutations through DataSource; run test to PASS, refactor while green and commit as `refactor(board): route actions through source`.
7. Write a failing test for: realtime-off preserves initial refresh without EventSource.
   Test file: `client/src/features/board/BoardContext.realtimeFlag.test.tsx`
   Level: integration
   Test intent: Given realtime disabled, When BoardProvider mounts, Then it loads once through source and constructs no EventSource; default environment still opens existing stream.
   Exercise through: BoardProvider and `useBoard()` consumer.
   Test doubles: API module and EventSource boundary only; do not mock provider/source/context.
   Expected RED: `useBoardEventStream` currently couples initial refresh with EventSource construction.
8. Run test — verify FAIL: `npm run test --workspace=client -- src/features/board/BoardContext.realtimeFlag.test.tsx`
9. Move initial refresh into controller and gate only SSE; run new/existing board tests to PASS, refactor while green and commit as `fix(board): keep initial load without realtime`.

## REFERENCES LOADED
- Spec Rules 1.1, 2.1, 6.1–6.3; design amendment.
- `BoardProvider.tsx`, `boardContextDefinition.ts`, `useBoardEventStream.ts`, `useBoardPageActions.ts`, `useBoardDragInteractions.ts`, mutation-routing guard.
- Existing tests are unchanged.

## WHY THIS APPROACH
Complexity: standard. Existing API mocks are the regression boundary for a behavior-neutral refactor.

## SANDWICH CONTEXT
[CRITICAL: Adapter methods call `api.*` inside their bodies so current mocks intercept.]  
Spec: `docs/pocket/spec/2026-10-11-demo-board-client-only/demo-board-spec.md`  
Files in scope: API adapter, refresh controller, provider/event-stream/page-action/drag hooks, mutation guard and listed tests.  
Available after: T1.  
[RESTATE: Realtime off never disables initial refresh; no API behavior changes.]

## DELIVERABLE
API-backed operations remain behavior-identical; realtime-off still loads initial data without EventSource.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have: default API source; `api.*` calls mockable; BoardProvider/controller ≤300 lines; existing tests unmodified.  
Must-not-have: API/server contract change or demo API calls.  
Rollback note: restore direct API source and prior refresh wiring.  
Red flags: existing mocks need changes or SSE-off blocks initial load → STOP.

## STOP CONDITIONS
Done when adapter, form-to-source, realtime and existing regression tests pass.

---

### Task 3: Register demo and landing feature boundaries [depends: T1]

## OBJECTIVE
Add approved feature names to the working-tree map and create public indexes before feature code.

Steps:
1. Write a failing test for: feature map registers demo and landing as client modules.
   Test file: `scripts/feature-modules/map.test.mjs`
   Level: unit
   Test intent: Given current `FEATURES`, When the feature-map contract loads, Then both names are present exactly once.
   Exercise through: imported `FEATURES` from map.mjs.
   Test doubles: none; do not mock map module.
   Expected RED: map contains neither approved feature.
2. Run test — verify FAIL: `npm run test:feature-modules`
3. Add feature names, create valid demo/landing indexes, run test and feature-module guard to PASS, refactor while green and commit as `chore(features): register demo and landing modules`.

## REFERENCES LOADED
- Spec architecture constraints and user-approved landing module addition; feature ADR/map/guard.

## WHY THIS APPROACH
Complexity: lightweight. Test-first map contract ensures module placement is valid before source files are added.

## SANDWICH CONTEXT
[CRITICAL: New source belongs only under a registered feature and imports through public index.]  
Files in scope: `scripts/feature-modules/map.mjs`, `scripts/feature-modules/map.test.mjs`, `client/src/features/demo/index.ts`, `client/src/features/landing/index.ts`.  
Available after: T1.  
[RESTATE: Register modules before writing product code.]

## DELIVERABLE
Map and guard recognize demo/landing with public indexes.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Every new source ≤300 lines. No product behavior or extra module.  
Rollback note: remove entries/index files.  
Red flags: guard rejects placement → STOP.

## STOP CONDITIONS
Done when test and feature guard pass.

---

### Task 4: Create the fixture and validate stored payloads [depends: T3]

## OBJECTIVE
Implement canonical fixture, v1 schema and load-time parsing/recovery. Stored values are untrusted; write failure/quota semantics are T8.

Steps:
1. Write a failing test for: empty storage creates exact fixture.
   Test file: `client/src/features/demo/demoBoardStore.test.ts`
   Level: unit
   Test intent: Given empty localStorage, When load runs, Then columns IDs 1–4 are Backlog, To Do WIP5, In Progress WIP3, Done; cards IDs 1–6/keys DEMO-1..6 are distributed 2/2/1/1; nextId is 7 and valid v1 JSON is stored under `camel.demoBoard.v1`.
   Exercise through: public store load/read API and serialized storage.
   Test doubles: localStorage only; do not mock fixture/store.
   Expected RED: fixture and store do not exist.
2. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/demoBoardStore.test.ts`
3. Implement fixture/schema/initial write; run test to PASS, refactor while green and commit as `feat(demo): add canonical fixture`.
4. Write a failing test for: malformed JSON and wrong-shape payload recover.
   Test file: `client/src/features/demo/demoBoardStore.test.ts`
   Level: unit
   Test intent: Given `"{not json"`, `null` or an array, When load runs, Then fixture replaces bad storage with v1 payload.
   Exercise through: public store load API.
   Test doubles: localStorage only; do not mock parser.
   Expected RED: parser/recovery is absent.
5. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/demoBoardStore.test.ts`
6. Add malformed-shape recovery; run test to PASS, refactor while green and commit as `fix(demo): recover malformed payloads`.
7. Write a failing test for: old schema version is rejected.
   Test file: `client/src/features/demo/demoBoardStore.test.ts`
   Level: unit
   Test intent: Given version 0, When load runs, Then fixture replaces it with v1 payload.
   Exercise through: public store load API.
   Test doubles: localStorage only; do not mock version validator.
   Expected RED: strict schema check is absent.
8. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/demoBoardStore.test.ts`
9. Add version recovery; run test to PASS, refactor while green and commit as `fix(demo): reject stale schema`.

## REFERENCES LOADED
- Spec Rules 1.2, 4.1–4.2; fixture precedent `server/src/db/seed.ts`.

## WHY THIS APPROACH
Complexity: lightweight. This packet only creates fixture/schema/read path; detailed validation follows separately.

## SANDWICH CONTEXT
[CRITICAL: Never expose unparsed localStorage payloads to board consumers.]  
Files in scope: `client/src/features/demo/demoBoardFixture.ts`, `client/src/features/demo/demoBoardTypes.ts`, `client/src/features/demo/demoBoardPayloadValidation.ts`, `client/src/features/demo/demoBoardStore.ts`, and `client/src/features/demo/demoBoardStore.test.ts`.  
Available after: T3.  
[RESTATE: Empty/corrupt/old storage always produces current canonical v1 board.]

## DELIVERABLE
Initial fixture is exact; malformed and stale schemas recover safely.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
All new sources ≤300 lines; no API/server imports; schema and key version match.  
Rollback note: orphaned local key is harmless.  
Red flags: invalid JSON reaches board UI → STOP.

## STOP CONDITIONS
Done when all fixture/schema tests pass.

---

### Task 5: Validate stored references and identity invariants [depends: T4]

## OBJECTIVE
Validate IDs and structural references in persisted v1 payload before state is returned.

Steps:
1. Write a failing test for: every card column reference exists.
   Test file: `client/src/features/demo/demoBoardStore.test.ts`
   Level: unit
   Test intent: Given a card referencing missing column, When load runs, Then fixture replaces payload.
   Exercise through: public store load API.
   Test doubles: localStorage only; do not mock validator.
   Expected RED: referential validation is absent.
2. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/demoBoardStore.test.ts`
3. Validate column references; run test to PASS, refactor while green and commit as `fix(demo): validate card references`.
4. Write a failing test for: nextId exceeds max card ID.
   Test file: `client/src/features/demo/demoBoardStore.test.ts`
   Level: unit
   Test intent: Given nextId ≤ max id, When load runs, Then fixture replaces and nextId is at least 7.
   Exercise through: public load API.
   Test doubles: localStorage only; do not mock nextId check.
   Expected RED: monotonic ID validation is absent.
5. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/demoBoardStore.test.ts`
6. Validate nextId; run test to PASS, refactor while green and commit as `fix(demo): reject tampered nextId`.
7. Write a failing test for: duplicate stored IDs are rejected.
   Test file: `client/src/features/demo/demoBoardStore.test.ts`
   Level: unit
   Test intent: Given duplicate card IDs or column IDs, When load runs, Then fixture replaces invalid payload.
   Exercise through: public store load API.
   Test doubles: localStorage only; do not mock validator.
   Expected RED: uniqueness validation is absent.
8. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/demoBoardStore.test.ts`
9. Enforce unique IDs; run test to PASS, refactor while green and commit as `fix(demo): reject duplicate IDs`.
10. Write a failing test for: non-finite positions are rejected on load.
    Test file: `client/src/features/demo/demoBoardStore.test.ts`
    Level: unit
    Test intent: Given a v1 card position is NaN or Infinity, When load runs, Then fixture replaces payload.
    Exercise through: public store load API.
    Test doubles: localStorage only; do not mock numeric validation.
    Expected RED: finite-position validation is absent.
11. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/demoBoardStore.test.ts`
12. Validate finite positions; run test to PASS, refactor while green and commit as `fix(demo): reject non-finite positions`.

## REFERENCES LOADED
- Spec Rule 4.2; `demoBoardTypes.ts` and `demoBoardPayloadValidation.ts`.

## WHY THIS APPROACH
Complexity: lightweight/standard. Structural data integrity is independent of field limits and mutations.

## SANDWICH CONTEXT
[CRITICAL: Invalid references/IDs/positions are rejected before stored data reaches the board.]  
Files in scope: `demoBoardPayloadValidation.ts`, `demoBoardStore.ts` and store tests.  
Available after: T4.  
[RESTATE: Never repair malformed payload piecemeal; recover to fixture.]

## DELIVERABLE
Dangling references, invalid nextId, duplicate IDs and non-finite positions recover to fixture.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
All new/modified source stays ≤300 lines; test one invalid invariant per test case. No server import/API.  
Rollback note: restore v1 local fixture.  
Red flags: malformed structural values partially survive load → STOP.

## STOP CONDITIONS
Done when every structural-invariant test passes.

---

### Task 6: Validate persisted WIP, text caps and payload size [depends: T5]

## OBJECTIVE
Validate every scalar/load-time limit from Rule 4.2 with independent tests.

Steps:
1. Write a failing test for: stored WIP must be null or positive integer.
   Test file: `client/src/features/demo/demoBoardStore.test.ts`
   Level: unit
   Test intent: Given stored WIP 0 or 1.5, When load runs, Then fixture replaces the invalid payload.
   Exercise through: public store load API.
   Test doubles: localStorage only; do not mock validator.
   Expected RED: WIP load validation is absent.
2. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/demoBoardStore.test.ts`
3. Enforce stored WIP invariant; run test to PASS, refactor while green and commit as `fix(demo): validate stored WIP`.
4. Write a failing test for: stored card title cap is enforced.
   Test file: `client/src/features/demo/demoBoardStore.test.ts`
   Level: unit
   Test intent: Given title length 256, When load runs, Then invalid payload recovers to fixture.
   Exercise through: public store load API.
   Test doubles: localStorage only; do not mock validator.
   Expected RED: card-title load cap is absent.
5. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/demoBoardStore.test.ts`
6. Enforce title cap 255; run test to PASS, refactor while green and commit as `fix(demo): validate stored title cap`.
7. Write a failing test for: stored description cap is enforced.
   Test file: `client/src/features/demo/demoBoardStore.test.ts`
   Level: unit
   Test intent: Given description length 10001, When load runs, Then invalid payload recovers to fixture.
   Exercise through: public store load API.
   Test doubles: localStorage only; do not mock validator.
   Expected RED: description load cap is absent.
8. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/demoBoardStore.test.ts`
9. Enforce description cap 10000; run test to PASS, refactor while green and commit as `fix(demo): validate stored description cap`.
10. Write a failing test for: stored column name cap is enforced.
    Test file: `client/src/features/demo/demoBoardStore.test.ts`
    Level: unit
    Test intent: Given a column name longer than 50 characters, When load runs, Then invalid payload recovers to fixture.
    Exercise through: public store load API.
    Test doubles: localStorage only; do not mock validator.
    Expected RED: column-name load cap is absent.
11. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/demoBoardStore.test.ts`
12. Enforce column name cap 50; run test to PASS, refactor while green and commit as `fix(demo): validate stored column cap`.
13. Write a failing test for: stored JSON larger than 512 KB is rejected on load.
    Test file: `client/src/features/demo/demoBoardStore.test.ts`
    Level: unit
    Test intent: Given serialized UTF-8 payload exceeds 512 KB, When load runs, Then fixture replaces it.
    Exercise through: public store load API and byte calculation.
    Test doubles: localStorage only; do not mock validator/size helper.
    Expected RED: load-time byte cap is absent.
14. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/demoBoardStore.test.ts`
15. Reject over-cap stored payloads; run test to PASS, refactor while green and commit as `fix(demo): validate stored payload size`.

## REFERENCES LOADED
- Spec Rule 4.2; title/description/column caps and UTF-8 byte limit.

## WHY THIS APPROACH
Complexity: standard. Each independent persisted-value rule gets its own RED command and failure signal.

## SANDWICH CONTEXT
[CRITICAL: Stored WIP, text and byte limits are validated before the payload is exposed.]  
Files in scope: `demoBoardPayloadValidation.ts`, `demoBoardStore.ts` and `demoBoardStore.test.ts`.  
Available after: T5 structural validation.  
[RESTATE: Invalid scalar/size payloads recover to canonical fixture.]

## DELIVERABLE
Stored WIP, card title, description, column name and payload size meet all Rule 4.2 limits.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Test each distinct persisted invariant independently; production files ≤300 lines. No API/server imports.  
Rollback note: fixture recovery.  
Red flags: invalid values are exposed to UI → STOP.

## STOP CONDITIONS
Done when every scalar/size load test passes.

---

### Task 7: Implement card CRUD and versioned IDs [depends: T2, T6]

## OBJECTIVE
Implement local card add/edit/delete, length/version validation and monotonic IDs through memory source. Include a typed baseline move dispatch that appends cross-column cards without WIP checks and does not reorder within a column; T10 replaces it with the full move contract. Keep new source ≤300 lines.

Steps:
1. Write a failing test for: card add persists across fresh store.
   Test file: `client/src/features/demo/memoryBoardDataSource.test.ts`
   Level: unit
   Test intent: Given fixture, When adding “Write pitch”, Then DEMO-7 is appended and a new store restores it.
   Exercise through: public memory source and real store.
   Test doubles: localStorage only; do not mock source/store.
   Expected RED: memory source/card add do not exist.
2. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/memoryBoardDataSource.test.ts`
3. Implement persistent add plus a baseline typed move dispatch (cross-column append only; no WIP/reorder/position guarantees yet); run test to PASS, refactor while green and commit as `feat(demo): persist added cards`.
4. Write a failing test for: successful edit persists and increments version exactly once.
   Test file: `client/src/features/demo/memoryBoardDataSource.test.ts`
   Level: unit
   Test intent: Given DEMO-1 version 1, When title/description are edited, Then version becomes 2, fresh store reads edit and unrelated versions stay unchanged.
   Exercise through: public update method/fresh store.
   Test doubles: localStorage only; do not mock source/store.
   Expected RED: local updates/versioning do not exist.
5. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/memoryBoardDataSource.test.ts`
6. Implement one increment per success; run test to PASS, refactor while green and commit as `feat(demo): persist versioned card edits`.
7. Write a failing test for: stale version rejects without write.
   Test file: `client/src/features/demo/memoryBoardDataSource.test.ts`
   Level: unit
   Test intent: Given card version 3, When update expects version 2, Then conflict is returned and fields/version/storage remain unchanged.
   Exercise through: public update method.
   Test doubles: localStorage only; do not mock source.
   Expected RED: stale check is absent.
8. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/memoryBoardDataSource.test.ts`
9. Reject stale write; run test to PASS, refactor while green and commit as `fix(demo): reject stale card edits`.
10. Write a failing test for: delete persists and ID is not reused.
    Test file: `client/src/features/demo/memoryBoardDataSource.test.ts`
    Level: unit
    Test intent: Given nextId 7, When DEMO-7 is added/deleted, Then fresh store no longer contains it and next card is DEMO-8.
    Exercise through: public add/delete methods and fresh store.
    Test doubles: localStorage only; do not mock allocation/source.
    Expected RED: persistent delete/monotonic IDs are absent.
11. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/memoryBoardDataSource.test.ts`
12. Preserve nextId on delete; run test to PASS, refactor while green and commit as `fix(demo): preserve deleted card ids`.

## REFERENCES LOADED
- Spec Rules 2.1, 2.4–2.7; ApiError type from `client/src/api.ts` for compatible conflict.

## WHY THIS APPROACH
Complexity: standard. Card ID/version/data changes are a bounded domain source.

## SANDWICH CONTEXT
[CRITICAL: Demo card CRUD only touches the local memory source/store.]  
Files in scope: `demoBoardCardMutations.ts`, `memoryBoardDataSource.ts`, `demoBoardTypes.ts`, demo index and source tests.  
Available after: T2 API contract, T6 stored payload limits.  
[RESTATE: Edits increment once; stale updates reject; deleted IDs are not recycled.]

## DELIVERABLE
Card add/edit/delete obey field/version/ID/persistence rules.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Cards begin at version 1; successful edits increment once; source enforces version; new source ≤300 lines. No API calls.  
Rollback note: remove demo key.  
Red flags: ID reuse or real workspace write → STOP.

## STOP CONDITIONS
Done when CRUD/version tests pass on fresh store instances.

---

### Task 8: Validate card mutation text limits [depends: T7]

## OBJECTIVE
Enforce each card text mutation input limit with independent RED cycles.

Steps:
1. Write a failing test for: whitespace-only card title is rejected.
   Test file: `client/src/features/demo/memoryBoardDataSource.test.ts`
   Level: unit
   Test intent: Given title “Alpha”, When update title is spaces, Then reject and preserve card/storage.
   Exercise through: public update method.
   Test doubles: localStorage only; do not mock validation.
   Expected RED: whitespace trim/min-length check is absent.
2. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/memoryBoardDataSource.test.ts`
3. Reject blank title; run test to PASS, refactor while green and commit as `fix(demo): reject blank card titles`.
4. Write a failing test for: title above 255 characters is rejected.
   Test file: `client/src/features/demo/memoryBoardDataSource.test.ts`
   Level: unit
   Test intent: Given a card, When title length is 256, Then update rejects and stored title remains unchanged.
   Exercise through: public update method.
   Test doubles: localStorage only; do not mock validator.
   Expected RED: title cap is absent.
5. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/memoryBoardDataSource.test.ts`
6. Enforce title cap; run test to PASS, refactor while green and commit as `fix(demo): enforce card title cap`.
7. Write a failing test for: description above 10000 characters is rejected.
   Test file: `client/src/features/demo/memoryBoardDataSource.test.ts`
   Level: unit
   Test intent: Given a card, When description length is 10001, Then update rejects and old description/storage remain.
   Exercise through: public update method.
   Test doubles: localStorage only; do not mock validator.
   Expected RED: description cap is absent.
8. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/memoryBoardDataSource.test.ts`
9. Enforce description cap; run test to PASS, refactor while green and commit as `fix(demo): enforce card description cap`.

## REFERENCES LOADED
- Spec Rule 2.6; server card limits 255/10000.

## WHY THIS APPROACH
Complexity: lightweight/standard. Each mutation text rule gets a distinct failure and command.

## SANDWICH CONTEXT
[CRITICAL: Invalid text never changes persisted card state.]  
Files in scope: `demoBoardCardMutations.ts`, `memoryBoardDataSource.ts`, source test.  
Available after: T7 card CRUD source.  
[RESTATE: Trim and enforce each distinct field limit.]

## DELIVERABLE
Blank title, over-cap title and over-cap description reject without writes.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Each error case independently tested; sources ≤300 lines; no API calls.  
Rollback note: restore local demo fixture.  
Red flags: rejected text partially commits → STOP.

## STOP CONDITIONS
Done when each card text case passes.

---

### Task 9: Implement column mutations and WIP validation [depends: T8]

## OBJECTIVE
Implement local column add/rename/WIP persistence, positive-integer validation and column name limits.

Steps:
1. Write a failing test for: valid column add persists.
   Test file: `client/src/features/demo/memoryBoardDataSource.test.ts`
   Level: unit
   Test intent: Given fixture, When adding a column, Then it appears at board end and fresh store restores it.
   Exercise through: public addColumn and real store.
   Test doubles: localStorage only; do not mock source/store.
   Expected RED: column add method is absent.
2. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/memoryBoardDataSource.test.ts`
3. Implement add; run test to PASS, refactor while green and commit as `feat(demo): add columns locally`.
4. Write a failing test for: column rename persists.
   Test file: `client/src/features/demo/memoryBoardDataSource.test.ts`
   Level: unit
   Test intent: Given To Do, When renamed to Ready, Then fresh store restores name.
   Exercise through: public updateColumn and new store.
   Test doubles: localStorage only; do not mock source.
   Expected RED: rename is absent.
5. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/memoryBoardDataSource.test.ts`
6. Implement rename; run test to PASS, refactor while green and commit as `feat(demo): persist column rename`.
7. Write a failing test for: valid WIP update persists.
   Test file: `client/src/features/demo/memoryBoardDataSource.test.ts`
   Level: unit
   Test intent: Given To Do WIP 5, When updated to 6, Then new store restores 6.
   Exercise through: public updateColumn/fresh store.
   Test doubles: localStorage only; do not mock source.
   Expected RED: valid WIP update is absent.
8. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/memoryBoardDataSource.test.ts`
9. Write a failing test for: lowering WIP below the current card count is allowed and persists over-limit state.
   Test file: `client/src/features/demo/memoryBoardDataSource.test.ts`
   Level: unit
   Test intent: Given To Do has five cards and WIP 5, When updateColumn saves WIP 3, Then update succeeds, a fresh store retains all cards and WIP 3, and the column remains over limit.
   Exercise through: public updateColumn and fresh store.
   Test doubles: localStorage only; do not mock source/store.
   Expected RED: lower-than-count WIP persistence is not implemented.
10. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/memoryBoardDataSource.test.ts`
11. Implement valid WIP updates including lower-than-count over-limit state; run both tests to PASS, refactor while green and commit as `feat(demo): persist WIP updates`.
12. Write a failing test for: direct source rejects WIP 0 or 1.5 unchanged.
    Test file: `client/src/features/demo/memoryBoardDataSource.test.ts`
    Level: unit
    Test intent: Given WIP 3, When update receives 0 or 1.5, Then reject and preserve old value/storage.
    Exercise through: public updateColumn.
    Test doubles: localStorage only; do not mock validator.
    Expected RED: positive-integer source validation is absent.
13. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/memoryBoardDataSource.test.ts`
14. Enforce WIP null-or-positive-integer; run test to PASS, refactor while green and commit as `fix(demo): validate WIP updates`.
15. Write a failing test for: empty/over-cap column names reject unchanged.
    Test file: `client/src/features/demo/memoryBoardDataSource.test.ts`
    Level: unit
    Test intent: Given a column, When name is blank/whitespace or 51 characters, Then update rejects and preserves old value/storage.
    Exercise through: public updateColumn.
    Test doubles: localStorage only; do not mock validator.
    Expected RED: column name trim/cap check is absent.
16. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/memoryBoardDataSource.test.ts`
17. Enforce trimmed 1–50 chars; run test to PASS, refactor while green and commit as `fix(demo): validate column names`.

## REFERENCES LOADED
- Spec Rules 2.1–2.2, 2.6; server column-name cap 50.

## WHY THIS APPROACH
Complexity: standard. Column source operations form one storage aggregate, separate from card identity.

## SANDWICH CONTEXT
[CRITICAL: Source accepts only WIP null or positive integer; invalid form normalization does not weaken it.]  
Files in scope: `demoBoardColumnMutations.ts`, `memoryBoardDataSource.ts`, source tests.  
Available after: T8 card mutation source.  
[RESTATE: Valid column settings persist; invalid WIP/name preserves existing data.]

## DELIVERABLE
Column add/rename/valid WIP persist; invalid WIP/name rejects.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have: name trim/cap and WIP positive integer/null; new files ≤300 lines.  
Must-not-have: column deletion/policy/done/signable settings/server changes.  
Rollback note: remove demo local storage entry.  
Red flags: invalid WIP accepted → STOP.

## STOP CONDITIONS
Done when all column mutation tests pass.

---

### Task 10: Implement moves and fractional positions [depends: T9]

## OBJECTIVE
Implement move/reorder WIP parity, fractional insertion and rebalance with version guarantees. Compose the real memory source with the shared board before changing drag behavior.

Steps:
1. Write a failing test for: full-target WIP drop is rejected through the real board UI.
   Test file: `client/src/features/demo/DemoBoardDrag.integration.test.tsx`
   Level: integration
   Test intent: Given target WIP is full and source card exists, When visitor drags through board UI, Then card returns to source, exact toast appears, and fresh store reads unchanged serialized state.
   Exercise through: BoardProvider, BoardPageSurface, actual drag hook, memory source/store.
   Test doubles: localStorage, DnD browser event and external catalog loader boundaries only; do not mock board/provider/source/store.
   Expected RED: baseline memory move accepts full target and commits movement instead of returning WIP conflict.
2. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/DemoBoardDrag.integration.test.tsx`
3. Add WIP rejection to memory source and preserve existing API-error toast/rollback flow; run test to PASS, refactor while green and commit as `feat(demo): enforce move WIP limit`.
4. Write a failing test for: integration — successful cross-column drag uses the dropped index.
   Test file: `client/src/features/demo/DemoBoardDrag.integration.test.tsx`
   Level: integration
   Test intent: Given In Progress contains A/C and has one WIP slot, When To Do card B is dragged between them, Then order is `[A, B, C]`, B has a fractional position between A/C, B version increments once, other versions stay unchanged and a fresh store restores that order.
   Exercise through: BoardProvider, BoardPageSurface, real drag hook, memory source and store.
   Test doubles: localStorage, DnD event and external catalog boundary only; do not mock board/provider/source/store.
   Expected RED: baseline memory move only appends and cannot honor the dropped index/position.
5. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/DemoBoardDrag.integration.test.tsx`
6. Write a failing test for: unit — source-level cross-column placement updates only the moved card version.
   Test file: `client/src/features/demo/memoryBoardDataSource.test.ts`
   Level: unit
   Test intent: Given target column has room and moved card version 1, When source drops it between neighbors, Then stored order is `[A, B, C]`, moved version becomes 2 and unrelated versions stay unchanged.
   Exercise through: public source move method and fresh store.
   Test doubles: localStorage only; do not mock source/position helper.
   Expected RED: fractional placement/version behavior is incomplete.
7. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/memoryBoardDataSource.test.ts`
8. Implement dropped-index fractional insertion/version update; run both integration/unit tests to PASS, refactor while green and commit as `feat(demo): place cards fractionally`.
9. Write a failing test for: integration — same-column drag reorder succeeds at full WIP through the real board.
   Test file: `client/src/features/demo/DemoBoardDrag.integration.test.tsx`
   Level: integration
   Test intent: Given In Progress order is `[DEMO-1, DEMO-2, DEMO-3]` (3/3) and DEMO-2 is version 1, When DEMO-2 is dragged before DEMO-1, Then order changes to `[DEMO-2, DEMO-1, DEMO-3]` with no toast, DEMO-2 becomes version 2 and other versions stay unchanged; a fresh store restores that exact order/version state.
   Exercise through: BoardProvider, BoardPageSurface, real drag hook, memory source/store.
   Test doubles: localStorage, DnD event and external task-catalog boundaries only; do not mock board/provider/source/store.
   Expected RED: baseline memory move dispatch does not reorder within a column.
10. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/DemoBoardDrag.integration.test.tsx`
11. Write a failing test for: unit — memory source same-column reorder increments only the moved version.
   Test file: `client/src/features/demo/memoryBoardDataSource.test.ts`
   Level: unit
   Test intent: Given In Progress is `[DEMO-1, DEMO-2, DEMO-3]` at 3/3 and DEMO-2 is version 1, When source moves DEMO-2 to index 0 in the same column, Then a fresh store restores `[DEMO-2, DEMO-1, DEMO-3]`, DEMO-2 at version 2 exactly once and other versions unchanged.
   Exercise through: public memory source move method.
   Test doubles: localStorage only; do not mock source.
   Expected RED: same-column full-WIP branch is not implemented.
12. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/memoryBoardDataSource.test.ts`
13. Implement same-column reorder at capacity; run both integration/unit tests to PASS, refactor while green and commit as `fix(demo): allow reorder at WIP cap`.
14. Write a failing test for: rebalance with crowded neighbors preserves slot and unrelated versions.
    Test file: `client/src/features/demo/memoryBoardDataSource.test.ts`
    Level: unit
    Test intent: Given neighboring cards A/B/C with A and C positions less than 1e-9 apart and moved card B at version 1, When B is inserted between A and C, Then after rebalance the persisted order remains `[A, B, C]`, positions use 1024 gaps, B becomes version 2 and A/C versions do not change.
    Exercise through: public source move method and serialized state.
    Test doubles: localStorage only; do not mock position helper.
    Expected RED: `MIN_SPACING` rebalance is absent.
15. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/memoryBoardDataSource.test.ts`
16. Implement named position/rebalance helper; run test to PASS, refactor while green and commit as `fix(demo): rebalance crowded positions`.

## REFERENCES LOADED
- Spec Rules 2.2–2.4; server position constants and `client/src/features/board/boardColumnMoves.ts` pattern.
- Installed DnD package versions; no new DnD API or dependency.

## WHY THIS APPROACH
Complexity: standard. Shared-board drag/provider integration and source-level position invariants are both tested.

## SANDWICH CONTEXT
[CRITICAL: Rebalance changes positions only; successful move increments only moved card version.]  
Files in scope: `demoBoardPosition.ts`, `memoryBoardDataSource.ts`, `DemoBoardDrag.integration.test.tsx` and source tests.  
Available after: T9 column operations.  
[RESTATE: Same-column reorder at cap succeeds; cross-column full target rejects atomically.]

## DELIVERABLE
Full-WIP drag rollback/toast and all fractional move/version invariants pass.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Float positions; 1024 spacing; rebalance below 1e-9; unrelated versions unchanged; all new source ≤300 lines.  
Must-not-have: server import or integer-only positions.  
Rollback note: demo key is orphanable.  
Red flags: full-WIP move persists or rebalance increments unrelated versions → STOP.

## STOP CONDITIONS
Done when UI integration and movement unit tests pass. Escalate if parity requires server changes.

---

### Task 11: Make local persistence atomic and resilient [depends: T10]

## OBJECTIVE
Enforce mutation payload cap atomically and preserve memory-authoritative behavior under storage failures.

Steps:
1. Write a failing test for: payload above 512 KB rejects with exact error and no commit.
   Test file: `client/src/features/demo/memoryBoardDataSource.test.ts`
   Level: unit
   Test intent: Given state at 511 KB, When description exceeds 512 KB UTF-8 JSON, Then exact storage-full error returns and state/storage bytes stay unchanged.
   Exercise through: public source update method and real store.
   Test doubles: localStorage only; do not mock size/commit.
   Expected RED: byte cap/candidate-before-commit is absent.
2. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/memoryBoardDataSource.test.ts`
3. Check size before commit; run test to PASS, refactor while green and commit as `fix(demo): reject oversized writes`.
4. Write a failing test for: storage read failure falls back and signals once.
   Test file: `client/src/features/demo/demoBoardStore.test.ts`
   Level: unit
   Test intent: Given getItem throws, When load runs, Then fixture remains usable and session signal is set.
   Exercise through: public store load API.
   Test doubles: getItem boundary only; do not mock fallback.
   Expected RED: read failure is not handled/signaled.
5. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/demoBoardStore.test.ts`
6. Catch and signal read failure; run test to PASS, refactor while green and commit as `fix(demo): handle read failure`.
7. Write a failing test for: write failure preserves five edits and warns once.
   Test file: `client/src/features/demo/demoBoardStore.test.ts`
   Level: unit
   Test intent: Given setItem throws, When five edits occur, Then in-memory data remains and signal appears once.
   Exercise through: real store/source.
   Test doubles: setItem boundary only; do not mock store/source.
   Expected RED: write failure loses edits or fails to signal.
8. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/demoBoardStore.test.ts`
9. Preserve memory and deduplicate notice signal; run test to PASS, refactor while green and commit as `fix(demo): preserve edits after storage failure`.

## REFERENCES LOADED
- Spec Rules 2.6, 4.1, 4.3–4.4; shared board preference try/catch pattern.

## WHY THIS APPROACH
Complexity: standard. Mutation quota/write failure differs from load validation and accepted CRUD.

## SANDWICH CONTEXT
[CRITICAL: Valid edits survive failed writes in memory; size rejection never partially commits.]  
Files in scope: `demoBoardStore.ts`, `memoryBoardDataSource.ts`, and their tests.  
Available after: T10 move operations.  
[RESTATE: Catch storage APIs and distinguish quota rejection from persistence failure.]

## DELIVERABLE
Over-cap writes reject atomically; storage read/write failures preserve usable in-session board and signal once.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
UTF-8 byte cap; every storage call caught; one session warning; no cross-tab listener/new dependency.  
Rollback note: key may remain orphaned.  
Red flags: failed write discards memory or oversize mutation commits → STOP.

## STOP CONDITIONS
Done when size/read/write tests pass.

---

### Task 12: Adapt board surfaces to demo capabilities [depends: T2, T3, T8, T9, T10, T11]

## OBJECTIVE
Gate unsupported board features, keep allowed fields, suppress API-only effects, and prevent duplicate submits. Extract oversized touched sources to ≤300 lines.

Steps:
1. Write a failing test for: demo capability profile hides unsupported surfaces and keeps supported fields.
   Test file: `client/src/features/demo/DemoBoardControls.test.tsx`
   Level: integration
   Test intent: Given demo BoardEnv with one full-WIP column and a second column whose card count exceeds WIP, When real board surfaces render, Then AddCard is disabled at capacity, the second column still shows its over-limit style, ViewSwitcher/activity/focus/presence/assignee/taxonomy/attachments/AI/image/due-date controls are absent, AddCard is title-only, ColumnSettings shows name/WIP/color, and authenticated defaults remain unchanged.
   Exercise through: real BoardPageSurface, ContextPanel, ColumnView, AddCard and ColumnSettings with contexts.
   Test doubles: external catalog/member API boundaries/localStorage only; do not mock board surfaces/hooks.
   Expected RED: demo feature gates do not exist and unsupported controls remain visible.
2. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/DemoBoardControls.test.tsx`
3. Gate optional rendering/API effects; extract `ColumnSettings.tsx`, `BoardCardTaxonomyFieldsView.tsx`, `useContextPanelAttachments.ts`; keep all touched sources ≤300 lines. Run test to PASS, refactor while green and commit as `refactor(board): gate demo controls`.
4. Write a failing test for: panel edit saves through memory source without member/API side effects.
   Test file: `client/src/features/demo/DemoBoardPanel.integration.test.tsx`
   Level: integration
   Test intent: Given `/demo/card/3` open at version 1, When title/description are saved in the real panel, Then a fresh store reads the values at version 2 exactly once and no API method, fetch or network boundary is called.
   Exercise through: real panel/editor, BoardProvider, memory source/store and BoardEnv.
   Test doubles: install an API/fetch deny-and-spy boundary plus localStorage; do not mock panel/editor/provider/memory source.
   Expected RED: editor currently requests workspace members for any non-null synthetic workspace, and no assertion denies every API/network method during edit.
5. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/DemoBoardPanel.integration.test.tsx`
6. Gate member/attachment effects and keep edit on source; run test to PASS, refactor while green and commit as `fix(board): isolate demo panel edits`.
7. Write a failing test for: double-click Add creates exactly one card.
   Test file: `client/src/features/demo/DemoBoardControls.test.tsx`
   Level: integration
   Test intent: Given real AddCard and deferred source response, When submit is clicked twice before rerender, Then exactly one card and ID are created.
   Exercise through: real form/useAddCardSubmit and memory source.
   Test doubles: defer source completion only; do not mock form/guard/source.
   Expected RED: asynchronous React state allows two submits before rerender.
8. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/DemoBoardControls.test.tsx`
9. Add synchronous in-flight guard; run test to PASS, refactor while green, keep hook ≤300 lines and commit as `fix(board): prevent duplicate local adds`.

## REFERENCES LOADED
- Spec Rules 2.1–2.7, 5.1, 6.1–6.2; board consumers and feature-module ADR.

## WHY THIS APPROACH
Complexity: standard. This packet alters the shared UI capability layer while preserving authenticated defaults.

## SANDWICH CONTEXT
[CRITICAL: No hidden demo surface can issue API calls; existing WorkspaceContext reads and `/board` stay compatible.]  
Files in scope: board UI/extraction paths and demo-specific control/panel tests in File Structure Map.  
Available after: T2 source, T3 module bootstrap, T8/T9/T10/T11 local model.  
[RESTATE: Demo shows supported fields only; failed/successful edits use memory source.]

## DELIVERABLE
Only supported board controls render; panel edit is local-only/versioned; double submit makes one card.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
No attachment/AI/member/taxonomy/due-date/focus/activity API effects in demo; new sources ≤300 lines; existing tests unmodified.  
Rollback note: remove BoardEnv gates; authenticated API source stays default.  
Red flags: demo triggers API or changes `/board` → STOP.

## STOP CONDITIONS
Done when control/panel/duplicate-submit tests and unchanged board regressions pass.

---

### Task 13: Adapt board navigation and panel deletion [depends: T12]

## OBJECTIVE
Thread BoardEnv.basePath through card links, panel close/redirect and delete outcomes using real memory source/store.

Steps:
1. Write a failing test for: browser-history Back closes a card panel at the demo basePath.
   Test file: `client/src/features/demo/DemoBoardNavigation.integration.test.tsx`
   Level: integration
   Test intent: Given a real browser-history entry at `/demo` with card 3 available, When the visitor clicks card 3 and then invokes `window.history.back()`, Then the card panel opens at `/demo/card/3`, then closes and URL returns to `/demo`.
   Exercise through: real BoardPageSurface/cardPanel under BrowserRouter using jsdom's actual window history and persisted fixture.
   Test doubles: localStorage and external catalog/member API boundaries only; do not mock BrowserRouter, browser history, source or navigation.
   Expected RED: current card link is hard-coded to `/board/card/:id`, so the demo route/history journey fails.
2. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/DemoBoardNavigation.integration.test.tsx`
3. Thread basePath through card links; run test to PASS, refactor while green and commit as `feat(board): use demo card basePath`.
4. Write a failing test for: the panel close button returns `/demo`.
   Test file: `client/src/features/demo/DemoBoardNavigation.integration.test.tsx`
   Level: integration
   Test intent: Given `/demo/card/3` is open, When the visitor clicks the panel close button, Then panel closes and URL returns to `/demo`.
   Exercise through: ContextPanelSurface and MemoryRouter history.
   Test doubles: history only; do not mock close behavior.
   Expected RED: current close callback navigates to `/board`.
5. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/DemoBoardNavigation.integration.test.tsx`
6. Route close through basePath; run test to PASS, refactor while green and commit as `fix(board): close panel under demo path`.
7. Write a failing test for: invalid/non-numeric IDs replace silently to `/demo`.
   Test file: `client/src/features/demo/DemoBoardNavigation.integration.test.tsx`
   Level: integration
   Test intent: Given `/demo/card/99999` or `/demo/card/abc`, When the route resolves, Then URL replaces to `/demo`, panel closes and no toast/error appears.
   Exercise through: real cardPanel/ContextPanelSurface and MemoryRouter.
   Test doubles: none for route/parse behavior; use real fixture source.
   Expected RED: missing-card redirect still points to `/board`.
8. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/DemoBoardNavigation.integration.test.tsx`
9. Write a failing test for: panel danger-zone self-delete removes persisted card and returns to `/demo`.
   Test file: `client/src/features/demo/DemoBoardNavigation.integration.test.tsx`
   Level: integration
   Test intent: Given card 3 open, When Delete is confirmed, Then a fresh store lacks card 3, panel closes at `/demo` without deletion toast, and no `/api/*` request occurs.
   Exercise through: real panel/editor, BoardProvider, memory source/store and MemoryRouter.
   Test doubles: localStorage/history and API/network deny boundary only; do not mock panel/editor/source/store.
   Expected RED: self-delete still uses the authenticated route when the card disappears.
10. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/DemoBoardNavigation.integration.test.tsx`
11. Route missing-card and self-delete resolution through demo basePath; run both tests to PASS, refactor while green and commit as `fix(demo): redirect closed panels`.
12. Write a failing test for: TrashZone delete persists and closes the panel at `/demo`.
    Test file: `client/src/features/demo/DemoBoardNavigation.integration.test.tsx`
    Level: integration
Test intent: Given card 3 open, When dropped on TrashZone, Then fresh store lacks card 3, panel closes at `/demo` and no `/api/*` request occurs.
    Exercise through: real drag hook/TrashZone, BoardProvider, memory source/store and MemoryRouter.
    Test doubles: localStorage/history, DnD and API/network deny boundaries only; do not mock collaborators.
    Expected RED: stale-delete branch still directly navigates to `/board`.
13. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/DemoBoardNavigation.integration.test.tsx`
14. Route TrashZone close through basePath; run test to PASS, refactor while green and commit as `fix(board): close after trash delete`.

## REFERENCES LOADED
- Spec Rule 5.2; `cardPanel.ts`, `ContextPanelSurface.tsx`, `ContextPanelEditorView.tsx`, `useContextPanelEditor.ts`.

## WHY THIS APPROACH
Complexity: standard. Opening, Back, invalid IDs, danger-zone and TrashZone are distinct route/deletion outcomes.

## SANDWICH CONTEXT
[CRITICAL: All panel links and deletion redirects remain inside the supplied boardBasePath.]  
Files in scope: `client/src/features/board/ContextPanelSurface.tsx`, `cardPanel.ts`, `ContextPanelEditorView.tsx`, `useContextPanelEditor.ts` and navigation integration test.  
Available after: T12 board UI capability layer and T2–T11 source/store.  
[RESTATE: Both deletion affordances remove persisted data and close to `/demo`.]

## DELIVERABLE
Card open/Back, invalid IDs, panel danger-zone and TrashZone behavior stays within demo path and persists.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Numeric ID only; invalid routes replace silently; both deletions absent in fresh store; every touched source ≤300 lines.  
Must-not-have: change `/board` behavior or add column-delete control.  
Rollback note: revert BoardEnv path threading; no server data.  
Red flags: deleted card reappears after reload or panel stays open → STOP.

## STOP CONDITIONS
Done when navigation and deletion tests pass using real memory store/source.

---

### Task 14: Compose the client-only demo shell [depends: T3, T12, T13]

## OBJECTIVE
Mount the shared board with memory source, synthetic workspace, BoardEnv and empty no-network task catalogs; surface storage notices.

Steps:
1. Write a failing test for: `/demo` renders board view despite stored calendar preference and makes no request.
   Test file: `client/src/features/demo/DemoApp.integration.test.tsx`
   Level: integration
   Test intent: Given `localStorage.setItem("boardViewModeByWorkspace", JSON.stringify({ "-1":"calendar" }))` and a valid/empty v1 payload, When DemoApp loads `/demo`, Then fixture/board view/browser-only notice render, exact preference string remains unchanged, no `/api/*` or EventSource is created, and no task catalog loader runs.
   Exercise through: real DemoApp, BoardProvider, memory source/store, WorkspaceContext and TaskMetadataCatalogProvider.
   Test doubles: fetch/EventSource/localStorage boundaries only; do not mock app/providers/source/catalog loader.
   Expected RED: DemoApp and empty catalog provider composition do not exist.
2. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/DemoApp.integration.test.tsx`
3. Compose app/page with ToastProvider, demo WorkspaceContext, BoardEnv, memory source and `DemoTaskMetadataCatalogProvider` that returns empty catalogs without API loaders; export via demo index. Run test to PASS, refactor while green and commit as `feat(demo): compose local-only shell`.
4. Write a failing test for: storage read failure displays once-per-session non-persist notice.
   Test file: `client/src/features/demo/DemoBoardPage.test.tsx`
   Level: integration
   Test intent: Given getItem throws, When page mounts, Then fixture remains usable and “changes will not survive a reload” appears once.
   Exercise through: real page/store/notice.
   Test doubles: localStorage read boundary only; do not mock page/store/notice.
   Expected RED: store failure signal is not rendered.
5. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/DemoBoardPage.test.tsx`
6. Render read-failure notice; run test to PASS, refactor while green and commit as `fix(demo): display read failure notice`.
7. Write a failing test for: write failure preserves edits and displays notice once.
   Test file: `client/src/features/demo/DemoBoardPage.test.tsx`
   Level: integration
   Test intent: Given setItem throws, When edits are made, Then memory edits remain and notice appears once.
   Exercise through: real page/store/source/notice.
   Test doubles: localStorage write boundary only; do not mock page/store/source.
   Expected RED: failed-write signal is not displayed.
8. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/DemoBoardPage.test.tsx`
9. Render once-per-session write notice; run test to PASS, refactor while green and commit as `fix(demo): display write failure notice`.

## REFERENCES LOADED
- Spec Rules 1.1–1.4, 4.3–4.5; ToastContext, TaskMetadataCatalogProvider, actual preference JSON shape.
- React Router 7.18.2 docs gap; tests use installed dependency.

## WHY THIS APPROACH
Complexity: standard. Composition is exercised with real app/providers/source/store; only browser/API boundaries are doubled.

## SANDWICH CONTEXT
[CRITICAL: DemoApp has no auth/network/realtime providers; empty metadata provider has no API loaders.]  
Files in scope: demo app/page/notice/index, shared catalog provider and listed tests.  
Available after: T3 module boundary and T12/T13 board work.  
[RESTATE: Demo state is memory/localStorage-only; failure notices never discard memory.]

## DELIVERABLE
`/demo` shows board view/local fixture/no-network and reports storage failure once per session.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have: separate browser-only and non-persist notices; exact stored preference is untouched; no presence/focus/auth/API/EventSource; every new source file ≤300 lines.  
Must-not-have: calendar/list route or cross-tab synchronization.  
Rollback note: remove demo shell; local key may remain.  
Red flags: hidden catalog fetch or memory lost on storage error → STOP.

## STOP CONDITIONS
Done when composition/no-network/catalog/notices pass. Escalate if a board surface requires authenticated providers.

---

### Task 15: Add demo routes and reset flows [depends: T14]

## OBJECTIVE
Support deep links, silent replace redirects, confirmed reset and cancellation/teardown.

Steps:
1. Write a failing test for: browser-history Back closes a card opened from `/demo`.
   Test file: `client/src/features/demo/DemoApp.integration.test.tsx`
   Level: integration
   Test intent: Given DemoApp at `/demo` with card 3, When visitor opens its panel and invokes browser-history Back, Then panel closes and URL returns to `/demo`.
   Exercise through: real DemoApp/router, board link and history stack.
   Test doubles: localStorage only; do not mock routing/navigation.
   Expected RED: nested card route is not registered, so the open/Back flow cannot render.
2. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/DemoApp.integration.test.tsx`
3. Write a failing test for: direct card deep link opens after hard reload.
   Test file: `client/src/features/demo/DemoApp.integration.test.tsx`
   Level: integration
   Test intent: Given card 3 in stored state, When `/demo/card/3` loads directly, Then the real board and card panel render.
   Exercise through: real DemoApp/router/source.
   Test doubles: localStorage only; do not mock routes/panel/source.
   Expected RED: child route matching is absent.
4. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/DemoApp.integration.test.tsx`
5. Add nested numeric card route; run both tests to PASS, refactor while green and commit as `feat(demo): add card deep links`.
6. Write a failing test for: unknown/nonnumeric card IDs replace silently.
   Test file: `client/src/features/demo/DemoApp.integration.test.tsx`
   Level: integration
   Test intent: Given `/demo/card/99999` or `/demo/card/abc`, When resolved, Then URL replaces to `/demo`, panel closes and no toast/error appears.
   Exercise through: real router and source.
   Test doubles: none for parse/route logic.
   Expected RED: invalid ID redirect is absent.
7. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/DemoApp.integration.test.tsx`
8. Add silent missing-ID redirect; run test to PASS, refactor while green and commit as `fix(demo): redirect invalid IDs`.
9. Write a failing test for: unknown `/demo/*` route replaces to `/demo`.
   Test file: `client/src/features/demo/DemoApp.integration.test.tsx`
   Level: integration
   Test intent: Given `/demo/foo`, When opened, Then board renders at `/demo` without error/toast.
   Exercise through: real demo router.
   Test doubles: none for route matching.
   Expected RED: wildcard route is absent.
10. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/DemoApp.integration.test.tsx`
11. Add wildcard replacement; run test to PASS, refactor while green and commit as `fix(demo): redirect unknown routes`.
12. Write a failing test for: confirmed reset restores fixture and closes active UI state.
    Test file: `client/src/features/demo/DemoBoardPage.test.tsx`
    Level: integration
    Test intent: Given changes, nextId 10 and `/demo/card/3` open, When reset is confirmed, Then fixture DEMO-1..6 returns, nextId remains 10, storage is overwritten, panel/editor/drag close and URL replaces to `/demo`.
    Exercise through: reset control/page/store/router.
    Test doubles: localStorage only; do not mock reset/navigation.
    Expected RED: reset lifecycle is absent.
13. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/DemoBoardPage.test.tsx`
14. Implement reset/remount/URL replacement; run test to PASS, refactor while green and commit as `feat(demo): reset board safely`.
15. Write a failing test for: Escape cancels reset without mutation.
    Test file: `client/src/features/demo/DemoBoardPage.test.tsx`
    Level: integration
    Test intent: Given modified board and reset confirmation open, When Escape is pressed, Then dialog closes and board/storage remain unchanged.
    Exercise through: real reset dialog/page/store.
    Test doubles: localStorage only; do not mock dialog/store.
    Expected RED: Escape cancellation is absent.
16. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/DemoBoardPage.test.tsx`
17. Write a failing test for: outside click cancels reset without mutation.
    Test file: `client/src/features/demo/DemoBoardPage.test.tsx`
    Level: integration
    Test intent: Given modified board and reset confirmation open, When outside overlay is clicked, Then dialog closes and board/storage remain unchanged.
    Exercise through: real reset dialog/page/store.
    Test doubles: localStorage only; do not mock dialog/store.
    Expected RED: outside-click cancellation is absent.
18. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/DemoBoardPage.test.tsx`
19. Implement both cancel paths; run both tests to PASS, refactor while green and commit as `fix(demo): cancel reset safely`.

## REFERENCES LOADED
- Spec Rules 3.1–3.2, 5.2; Router 7.18.2 gap and board cardPanel precedent.

## WHY THIS APPROACH
Complexity: standard. Route/reset behavior spans router, storage and mounted component state.

## SANDWICH CONTEXT
[CRITICAL: Unknown paths/IDs replace to `/demo`; reset restores fixture without decreasing nextId.]  
Files in scope: DemoApp, DemoBoardPage, DemoResetControl and listed tests.  
Available after: T14.  
[RESTATE: Reset closes editor/drag/panel and returns to `/demo`.]

## DELIVERABLE
Direct links, invalid paths, reset confirmation and cancellation follow spec.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have: numeric card route, silent replace, reset keeps `max(stored,7)` and restores fixture IDs; new `DemoResetControl.tsx` ≤300 lines.  
Must-not-have: unknown-route error/toast or out-of-demo URL.  
Rollback note: remove route/reset, local key is harmless.  
Red flags: reset reuses IDs or leaves editor/drag mounted → STOP.

## STOP CONDITIONS
Done when deep-link/fallback/reset tests pass. Escalate if installed router behavior contradicts test.

---

### Task 16: Branch public entry and extract landing feature [depends: T3, T14] [parallel: T15]

## OBJECTIVE
Branch `/demo` before importing/evaluating App, dynamically load App for other paths, and extract the landing page into registered `features/landing/`.

Steps:
1. Write a failing test for: verified logged-in session does not redirect `/demo` or evaluate App.
   Test file: `client/src/features/demo/mainEntry.integration.test.tsx`
   Level: integration
   Test intent: Given a verified logged-in session and `/demo`, When actual `main.tsx` executes, Then URL stays `/demo`, DemoApp loads, App/router is not imported and no `/api/health`, `api.me()` or EventSource is called.
   Exercise through: actual Vite entry and rendered demo route.
   Test doubles: authenticated API response and EventSource boundaries only; do not mock main path branch or DemoApp.
   Expected RED: static App import performs auth/build effects before pathname selection.
2. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/mainEntry.integration.test.tsx`
3. Write a failing test for: unverified user session does not redirect `/demo`.
   Test file: `client/src/features/demo/mainEntry.integration.test.tsx`
   Level: integration
   Test intent: Given a session whose user email is unverified and `/demo`, When actual entry executes, Then URL remains `/demo`, demo renders and no auth/email-gate route or API request occurs.
   Exercise through: actual main entry and demo route.
   Test doubles: API session response/fetch boundary only; do not mock entry branch or DemoApp.
   Expected RED: static App import performs `api.me()` and can mount auth/email-gate behavior before demo branch.
4. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/mainEntry.integration.test.tsx`
5. Write a failing test for: expired session does not redirect `/demo`.
   Test file: `client/src/features/demo/mainEntry.integration.test.tsx`
   Level: integration
   Test intent: Given expired session/API 401 and `/demo`, When actual entry executes, Then demo route remains `/demo` and no global 401 handler or sign-in redirect runs.
   Exercise through: actual main entry and demo route.
   Test doubles: API 401 response/fetch boundary only; do not mock entry branch or DemoApp.
   Expected RED: App is statically imported and executes session/API handling before path selection.
6. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/mainEntry.integration.test.tsx`
7. Write a failing test for: local demo edits never reach a real workspace opened afterward.
   Test file: `client/src/features/demo/mainEntry.integration.test.tsx`
   Level: integration
   Test intent: Given a logged-in workspace and a local DEMO-7 edit at `/demo`, When the actual entry reloads `/board`, Then API board loads only for the authenticated workspace, no demo key/payload is sent to any API mutation, the real board remains unchanged, and the local demo payload remains separate.
   Exercise through: actual main entry, DemoApp/memory source followed by authenticated App/BoardProvider/API source.
   Test doubles: external API methods/EventSource only; do not mock entry, memory source or BoardProvider.
   Expected RED: static App evaluation on `/demo` enters auth/API before demo and no tested boundary proves workspace isolation.
8. Run test — verify FAIL: `npm run test --workspace=client -- src/features/demo/mainEntry.integration.test.tsx`
9. Branch exact `/demo` and `/demo/*` before dynamic DemoApp import; dynamically import App only for other paths. Run all entry tests to PASS, refactor while green and commit as `feat(demo): isolate public entry`.
10. Write a failing test for: landing content preserves full-page CTAs.
    Test file: `client/src/features/landing/LandingPage.test.tsx`
    Level: integration
    Test intent: Given public landing route, When LandingPage renders, Then existing sections remain; plain anchors are `<a href="/demo">Try the live demo</a>` and `<a href="/signup">Sign up</a>`; page adapter and every new source are ≤300 lines.
    Exercise through: landing public index and route adapter.
    Test doubles: none for rendered anchors/content; do not mock landing modules.
    Expected RED: CTA and landing feature extraction are absent.
11. Run test — verify FAIL: `npm run test --workspace=client -- src/features/landing/LandingPage.test.tsx`
12. Extract landing data, preview and sections into registered feature files (each ≤300 lines), preserve copy and add anchors; run test/feature guard to PASS, refactor while green and commit as `refactor(landing): extract feature module`.

## REFERENCES LOADED
- Spec Rules 1.1, 1.3, 5.2; approved landing feature scope.
- `main.tsx`, `App.tsx`, `LandingPage.tsx` and feature-module ADR.
- React Router exact 7.18.2 docs remain unverified; branch uses `window.location`.

## WHY THIS APPROACH
Complexity: standard. No-API guarantee includes module evaluation; landing extraction satisfies 300-on-touch.

## SANDWICH CONTEXT
[CRITICAL: Demo entry never statically imports/evaluates App or auth/router effects.]  
Files in scope: `client/src/main.tsx`, `client/src/pages/LandingPage.tsx`, every `client/src/features/landing/` source/test named in File Structure Map.  
Available after: T3 registers landing and T14 exports DemoApp.  
[RESTATE: Demo branch first; CTAs are full-page anchors.]

## DELIVERABLE
Demo path avoids App/auth; later `/board` remains isolated/API-backed; landing content and CTAs satisfy line budget.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have: exact `/demo` or `/demo/…` branch; dynamic App import for other paths; no SEO/sitemap changes.  
Must-not-have: auth redirects in demo or client-router CTA navigation.  
Rollback note: revert entry/landing feature; localStorage remains harmless.  
Red flags: test only passes by mocking path branch or a source exceeds 300 lines → STOP.

## STOP CONDITIONS
Done when entry/isolation/landing tests and module/line guards pass.

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|---|---|---|---|---|
| T1 | Define shared board runtime contracts | prereq | standard | safe BoardEnv and typed synthetic workspace |
| T2 | Preserve API-backed board via data-source seam | T1 | standard | adapter, form-to-source, initial load without SSE |
| T3 | Register demo and landing boundaries | T1 | lightweight | map test and feature guard |
| T4 | Create fixture and validate schema/load | T3 | standard | fixture/malformed/version recovery |
| T5 | Validate payload references/identity | T4 | standard | reference, nextId, uniqueness, finite positions |
| T6 | Validate stored scalar/text/size limits | T5 | standard | WIP/title/description/column/512 KB cases |
| T7 | Implement card CRUD/version/IDs | T2, T6 | standard | add/edit/stale/delete/version persistence |
| T8 | Validate card mutation text limits | T7 | standard | blank title/title cap/description cap |
| T9 | Implement column CRUD/WIP | T8 | standard | add/rename/valid/invalid WIP/name |
| T10 | Implement moves/positions | T9 | standard | WIP integration, slot, reorder, rebalance |
| T11 | Make storage atomic/resilient | T10 | standard | size/read/write failure behavior |
| T12 | Adapt board capabilities/editor | T2, T3, T8–T11 | standard | hidden controls, over-limit style, panel edits, duplicate submits |
| T13 | Adapt board navigation/deletion | T12 | standard | open/Back/invalid/danger/trash paths |
| T14 | Compose client-only demo shell | T3, T12, T13 | standard | no network, board preference, empty catalogs/notices |
| T15 | Add demo routes/reset | T14 | standard | deep links/fallback/reset/cancel |
| T16 | Branch entry/extract landing | T3, T14 | standard | auth isolation, no API, full-page CTAs |

---

## Final Verification Checklist (after T16)

This is verification only, not a behavioral task; existing tests are not modified.

- Run each existing board test unchanged from repo root:
  - `npm run test --workspace=client -- src/features/board/BoardContext.focusGuard.test.tsx`
  - `npm run test --workspace=client -- src/features/board/BoardContext.focusSeams.test.tsx`
  - `npm run test --workspace=client -- src/features/board/BoardContext.attachments.test.tsx`
  - `npm run test --workspace=client -- src/features/board/BoardContext.focusFlag.test.tsx`
  - `npm run test --workspace=client -- src/features/board/BoardContext.viewMode.test.tsx`
  - `npm run test --workspace=client -- src/features/board/BoardCardTaxonomyFields.test.tsx`
  - `npm run test --workspace=client -- src/features/board/ContextPanel.test.tsx`
  - `npm run test --workspace=client -- src/features/board/AddCard.test.tsx`
  - `npm run test --workspace=client -- src/features/board/useAddCardImageStaging.test.tsx`
  - `npm run test --workspace=client -- src/features/board/CardView.integration.test.tsx`
  - `npm run test --workspace=client -- src/features/board/ColumnView.test.tsx`
  - `npm run test --workspace=client -- src/features/board/CardAttachments.integration.test.tsx`
- Run full `npm run test` from repo root.
- Run `make check`, `npm run check:mutation-routing`, `npm run check:feature-modules`, `npm run lint`, and `npm run typecheck`.
- Record unrun/environmentally blocked checks accurately; do not claim success without evidence.

> Dry-run validity does not authorize plan handoff, structuring or implementation.
