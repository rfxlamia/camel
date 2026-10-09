# Task T9 — Relocate board wave-1 (no ContextPanel)

**Phase:** 3
**Depends:** T8 + Hotfix #2 (shared agent workspace-reset helper)
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 9: Relocate board wave-1 (no ContextPanel) [depends: T8 + Hotfix #2]

## OBJECTIVE
`git mv` leftover board product files **except `ContextPanel`** into `client/src/features/board/` and `server/src/modules/board/` with public `index.ts`. `BoardPage.tsx` stays in pages/. `cards.ts` moves as-is; do not close #115. Update mutation-routing allowlist when BoardContext moves. Leave `ContextPanel.tsx` (+ its tests) leftover until T11 — it still imports leftover `FocusEntryButton`. This task is blocked until Hotfix #2 has extracted the small workspace-reset helper that lets the new BoardContext avoid importing `client/src/lib/agentStream` or the agent barrel.

Files:
- Create: `client/src/features/board/index.ts` and bodies from AddCard cluster (`AddCard.tsx`, `AddCardForm.tsx`, `AddCardImageChips.tsx`, `addCardImageStaging.ts`, `useAddCardImageStaging.ts`, `useAddCardSubmit.ts` + tests), views (`CalendarView.tsx`, `CalendarDayModal.tsx`, `CalendarConflictNotice.tsx`, `CardView.tsx`, `ColumnView.tsx`, `ListView.tsx`, `UnscheduledTray.tsx`, `ViewSwitcher.tsx`, `TemplatePicker.tsx`, `TrashZone.tsx`, `CardAttachments.tsx`, `BoardCardTaxonomyFields.tsx`, `AssigneePicker.tsx` + tests — **not** `ContextPanel.tsx`), `BoardContext.tsx` + BoardContext tests, `client/src/lib/boardColumnMoves.ts`, `boardViewPrefs.ts`, `calendarGrid.ts`, `cardAttachments.ts`, `cardPanel.ts`, `columnColors.ts`, `columnColorUtils.ts`, `columnStyleResolver.ts`, `templates.ts` + tests
  `server/src/modules/board/index.ts` and bodies from `server/src/routes/board.ts`, `cards.ts`, `card-*.ts` (except files already in lib from T2), `columns.ts`, `column-is-done-remap.ts`, `columns-is-done-remap*.ts` tests/support/scenarios, `attachment*.ts`, `metrics.ts` + colocated tests
- Modify: `client/src/App.tsx` (BoardProvider via board index; **keep** leftover `components/ContextPanel` import), `client/src/pages/BoardPage.tsx` (specifier only), leftover `client/src/components/ContextPanel.tsx` (useBoard and moved siblings via board index; keep leftover `FocusEntryButton` relative import), leftover `client/src/components/ContextPanel.test.tsx` and `ContextPanel.attachments.test.tsx` (`vi.mock` BoardContext via board index), leftover `client/src/context/FocusSessionContext.tsx` (useBoard via board index), leftover `client/src/context/FocusSessionContext.test.tsx` and `FocusSessionContext.guards.test.tsx` (`vi.mock` BoardContext via board index), leftover `client/src/components/AgentCardDetail.tsx`, leftover `client/src/hooks/useAgentBoard.ts`, leftover pages that import BoardContext (FocusPage, AgentPage, Tracker*, Dashboard, ActivityPage, myWork harness), `client/src/shared/` ticket-intake files that import useBoard, leftover `server/src/agent/routes.ts` (`card-attachment-cleanup` via board index; leftover → module is allowed), leftover `server/src/routes/workspaces.ts` and `workspaces.delete.test.ts` (`card-attachment-cleanup` via board index), `scripts/check-work-item-mutation-routing.mjs`, `server/src/routes.ts`, `scripts/feature-modules/git-diff.test.mjs`, `scripts/feature-modules/imports.test.mjs`
- Test: `scripts/feature-modules/git-diff.test.mjs`

Steps:
1. Write failing test for: BoardContext consumers use the board index
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit

   Test intent:
   Given BoardContext and board routes still live under type-folders
   When Cycle Map is evaluated
   Then:
   - `client/src/features/board/index.ts` and `server/src/modules/board/index.ts` exist
   - leftover `client/src/context/BoardContext.tsx` is gone
   - leftover `server/src/routes/cards.ts` and `server/src/routes/board.ts` are gone
   - leftover `client/src/components/ContextPanel.tsx` **still exists** (imports leftover FocusEntryButton)
   - `client/src/pages/BoardPage.tsx` still exists
   - tracker stubs still exist
   - `LINE_BUDGET_MAX` is still 300

   Exercise through:
   - Cycle Map `existsSync` assertions

   Test doubles:
   - mock/fake: none
   - do NOT mock: Cycle Map

   Expected RED:
   - `client/src/features/board/index.ts` does not exist today

2. Run test — verify FAIL:
   `npm run test:feature-modules`
   Expected failure: missing `client/src/features/board/index.ts`

3. Implement minimal code to satisfy the test:
   File: paths in OBJECTIVE
   Implement: `git mv` board files except ContextPanel, including `column-is-done-remap.ts` (not only `columns*.ts`); index barrels; leftover importers (including leftover ContextPanel, leftover ContextPanel tests/`vi.mock` of BoardContext, FocusSessionContext tests, AgentCardDetail, useAgentBoard, shared ticket-intake, leftover `server/src/agent/routes.ts`, leftover `server/src/routes/workspaces.ts` / `workspaces.delete.test.ts` for `card-attachment-cleanup`) use board index only; leftover ContextPanel keeps leftover FocusEntryButton; BoardContext inside the new module imports the shared workspace-reset helper from Hotfix #2, not `client/src/lib/agentStream` and not the agent barrel; BoardContext 492 lines specifier-only; cards.ts 999 lines specifier-only; update ALLOWLIST path in `scripts/check-work-item-mutation-routing.mjs`; App.tsx BoardProvider from board index, ContextPanel import stays leftover

4. Run test — verify PASS:
   `npm run test:feature-modules`
   Expected: PASS
   Also run: `npm run check:feature-modules` and `npm run check:mutation-routing` and `npm run test --workspace=client -- src/features/board` and `npm run test --workspace=server -- src/modules/board`

5. Refactor while green (bounded):
   - If biome reorders imports on BoardContext/cards.ts/ColumnView and FM-RULE-3 fires, revert those hunks; do not split. Do not move ContextPanel.
   - Re-run: `npm run test:feature-modules` and `npm run check:feature-modules`

6. Commit:
   `git commit -m "refactor(board): relocate board into feature modules"`
   PR: `refs #131` — do not close #115 or #131

## REFERENCES LOADED
docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md — rules: Public index; Path-only; cards.ts moves without closing #115
scripts/check-work-item-mutation-routing.mjs — ALLOWLIST currently `client/src/context/BoardContext.tsx`
docs/pocket/adr/2026-09-board-tracker-dual-table.md — do not change write routing

## WHY THIS APPROACH
Justification: Largest product leftover; BoardContext must become a module file with index-only external imports.
Complexity: deep

## SANDWICH CONTEXT
[CRITICAL: Hotfix #2 must be complete before T9; do not import `client/src/lib/agentStream` or the agent barrel from the new BoardContext; do not split cards.ts/BoardContext; do not move ContextPanel; do not close #115 or #131; leftover importers must use features/board index only]
You are implementing T9 board wave-1 relocate for #131 relocation close.
Spec: docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
Design decision: Option A plus two-wave; ContextPanel deferred to T11
Files in scope: listed in OBJECTIVE
Test framework: node:test + Vitest workspace-scoped
Available after: T8 + Hotfix #2
Architecture rule: one-way wall; the new BoardContext may import the shared workspace-reset helper but not `client/src/lib/agentStream` or `features/agent`; mutation allowlist path must match BoardContext’s new path; leftover ContextPanel may import leftover FocusEntryButton
[RESTATE: Do not split cards.ts/BoardContext; do not move ContextPanel; do not close #115 or #131; leftover importers must use features/board index only]

## DELIVERABLE
Given BoardContext git-mvs to features/board, When leftover pages, App.tsx, and layout specifiers are updated, Then they import from features/board index only and the mutation-routing allowlist path is updated in the same PR

[must-not] Given a failing test, When someone edits logic or matchers to go green, Then that change is rejected; revert the packet if path-only cannot fix

All tests PASS. Commit exists with message matching `refactor(board): relocate board into feature modules`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Cycle Map board homes + leftover BoardContext/cards absences
  - leftover ContextPanel still exists
  - Mutation allowlist updated
  - BoardPage stays in pages/
  - Test file count not reduced
  - PR `refs #131`

Must-not-have:
  - Moving ContextPanel into features/board (T11)
  - Closing #115 or #121 or #131
  - God-file splits
  - Second FEATURES name
  - Dual-table behavior change
  - Deep imports into features/board/BoardContext from outside the module

Open question risks:
  - If BoardContext still imports leftover agent/chat hooks after T1 ticket-intake extract, report NEEDS_CONTEXT (insert kernel extract; do not add agent files here)

Rollback note:
  - Revert the whole board packet

## STOP CONDITIONS
Done when: Hotfix #2 is recorded complete, Cycle Map, mutation-routing, check:feature-modules, and board tests pass
Uncertain when: one-way requires moving agent or chat files
Blocked when: Hotfix #2 is not complete or the new BoardContext would import `client/src/lib/agentStream`
Escalate when: FM-RULE-3 cannot be satisfied without splitting a fat file
