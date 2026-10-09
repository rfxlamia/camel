# EXECUTION PLAN — Issue #131 folder relocation close

**Date:** 2026-09-19
**Spec:** docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
**Status:** draft
**Total tasks:** 17
**GitHub:** #131 (reuse existing issue; do not open a duplicate)
**Phases:** A = T1–T3 (foundation) · B = T4–T11 (my-work through board wave-2 / ContextPanel) · C = T12–T17 (agent wave-2 including llm.ts, remaining FEATURES + close)

---

## Execution Overview

### Recommended Order
```
T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11 → T12 → T13 → T14 → T15 → T16 → T17
```

> After my-work: **focus wave-1 → client chat → repaired agent wave-1 closed slice → server chat → Hotfix #2 shared workspace-reset helper → board wave-1 → focus wave-2 → board wave-2 → agent wave-2 (BoardContext consumers, stream/sync, + llm.ts)**. T7 deliberately leaves `agentStream*` and `agentBoardSync*` in `client/src/lib/`; T9 is blocked until Hotfix #2 lets the new BoardContext use a shared helper instead of a legacy agent import. T12 owns the later stream/sync move with the BoardContext consumers. `FocusEntryButton` imports leftover `FocusSessionContext`, so it stays leftover until focus wave-2 (with that context). `ContextPanel` imports leftover `FocusEntryButton`, so it stays leftover until board wave-2 (after the button lives in `features/focus`). Sequential on purpose: every packet edits `scripts/feature-modules/git-diff.test.mjs` (Cycle Map) and often `App.tsx` / `server/src/routes.ts`. Do not run packets in parallel. Each task is one branch + one PR from updated `origin/main`. Merge only after that packet’s audit (tests + `check:feature-modules` + `make check`). Review comments on an open PR stay on the same branch; post-merge fixes get a new branch/PR still `refs #131`.

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| none | — | Cycle Map and composition roots are shared; no parallel group |

### Constraints Reminder
**Architecture:** `git mv` + specifier/mock paths + Cycle Map locks. Pages under `client/src/pages/` stay (except T3 which *creates* page orchestrators from `components/`). Tracker stubs stay. `LINE_BUDGET_MAX` stays 300. Fat files: specifier-only; revert biome import-order on files already >300; never split god files. Modules import `index.ts` only from outside. Server NodeNext `.js`. `KERNEL_IN_WAITING` stays `[]`. `shared/index.ts` stays `export {}`. No `features/work-items/`. No HTTP/schema/dual-table/`workItemMutations` behavior change. PRs T1–T16: `refs #131`. T17 may `closes #131` only if the close bar is met.
**Out-of-scope:** god-file splits; raising line budget to 500; deleting tracker stubs; moving existing `pages/` files into `features/`; Dashboard as a new FEATURES name; big-bang multi-feature PR; UI redesign.
**Assumptions at risk:** ticket-intake **client** files belong in T1 (`shared/`) because BoardContext + layout import them; ticket-intake **server** (except ticket-intake/llm.ts) stays with T7 agent; ticket-intake/llm.ts moves with the llm cluster in agent wave-2. `agentStream*` and `agentBoardSync*` intentionally remain legacy wave-2 leftovers after T7. Hotfix #2 must extract the small workspace-reset helper into `client/src/shared/` before T9 moves BoardContext; T12 then moves stream/sync with its consumers. `lib/agentQueue.ts` belongs in T1 (`shared/`) because chat `useChatStream` and agent `useAgentChat` / `AgentChatPanel` both import it (Rule 10). `types/myWork.ts` and Workspace* go to `shared/` in T1. `server/src/routes/presence.ts` stays realtime kernel unless it is clearly product. `api.ts` hub stays; `client/src/api/myWork.ts` moves in T4.
**Sequencing:** `[depends: TN]` is a hard lock here — the next packet must rebase onto the previous merge.
**Feature packet inventory:** Before every FEATURES `git mv` (T4–T17), run `git ls-files -- <leftover dirs>` and move only the listed product files. Plan globs (`*`, `** except`) are hints, not the live inventory after rebase.
**Close-bar indexes:** `workspaces` and `activity` may be server-module-only. Cycle Map must require `server/src/modules/<name>/index.ts` and must **not** fail when `client/src/features/workspaces/index.ts` or `client/src/features/activity/index.ts` is absent (pages stay leftover orchestrators; T1 already took WorkspaceContext to shared/).

### File Structure Map

```
Rule: Kernel/shared first for true cross-cutting
  Create: client/src/shared/PageHeader.tsx
          client/src/shared/EmptyState.tsx
          client/src/shared/LoadingCamel.tsx
          client/src/shared/Toast.tsx
          client/src/shared/Toast.test.tsx
          client/src/shared/PresenceBar.tsx
          client/src/shared/SuccessAnimation.tsx
          client/src/shared/ToolTrace.tsx
          client/src/shared/ToolTrace.test.tsx
          client/src/shared/ToastContext.tsx
          client/src/shared/ToastContext.test.tsx
          client/src/shared/PresenceContext.tsx
          client/src/shared/PresenceContext.test.tsx
          client/src/shared/title.ts
          client/src/shared/title.test.ts
          client/src/shared/toolTrace.ts
          client/src/shared/toolTrace.test.ts
          client/src/shared/myWorkTypes.ts
          client/src/shared/WorkspaceContext.tsx
          client/src/shared/WorkspaceContext.test.tsx
          client/src/shared/workspaceSelection.ts
          client/src/shared/workspaceSelection.test.ts
          client/src/shared/workspaceSwitcher.ts
          client/src/shared/workspaceSwitcher.test.ts
          client/src/shared/FloatingChatButton.tsx
          client/src/shared/TicketIntakeChatOverlay.tsx
          client/src/shared/PreviewScreen.tsx
          client/src/shared/inputClass.ts
          client/src/shared/AutoErrorListener.tsx
          client/src/shared/TicketIntakeChatPanel.tsx
          client/src/shared/useTicketIntakeChat.ts
          client/src/shared/ticketIntakeBus.ts
          client/src/shared/ticketIntakeBus.test.ts
          client/src/shared/agentQueue.ts
          client/src/shared/agentQueue.test.ts
          (plus colocated ticket-intake tests git-mv’d next to those homes)
          server/src/lib/card-assignees.ts
          server/src/lib/card-response.ts
          (plus colocated card-assignees/card-response tests)
  Modify: client/src/App.tsx
          client/src/layout/AppLayout.tsx
          client/src/types.ts
          client/src/shared/workItemMutations.ts
          leftover importers of old chrome/ticket-intake/workspace paths including client/src/api.ts and client/src/api.test.ts
          server/src/lib/work-item-response.ts
          server/src/core/board-card-status-change.ts
          leftover server/src/routes/my-work*.ts specifiers to lib/
          scripts/feature-modules/git-diff.test.mjs
          scripts/feature-modules/imports.test.mjs
  Test:   scripts/feature-modules/git-diff.test.mjs
          npm run test:feature-modules
          colocated tests that moved with chrome

Rule: Auth screens and chat legacy tree (auth screens)
  Create: client/src/pages/AuthPage.tsx
          client/src/pages/AuthPage.test.tsx
          client/src/pages/EmailGatePage.tsx
          client/src/pages/EmailGatePage.test.tsx
          client/src/pages/PickUsernamePage.tsx
          client/src/pages/PickUsernamePage.test.tsx
  Modify: client/src/App.tsx
          scripts/feature-modules/git-diff.test.mjs
  Test:   client/src/pages/AuthPage.test.tsx
          client/src/pages/EmailGatePage.test.tsx
          client/src/pages/PickUsernamePage.test.tsx
          scripts/feature-modules/git-diff.test.mjs

Rule: One FEATURES name per PR; pages stay — my-work
  Create: client/src/features/my-work/index.ts
          client/src/features/my-work/<all files from components/my-work and lib/myWork* and api/myWork.ts>
          server/src/modules/my-work/index.ts
          server/src/modules/my-work/<all my-work* route files except kernel work-item tests>
  Modify: client/src/pages/MyWorkPage.tsx (specifier only)
          client/src/api.ts (import feature index)
          server/src/routes.ts
          scripts/feature-modules/git-diff.test.mjs
  Test:   colocated my-work tests under features/my-work and modules/my-work
          client/src/pages/MyWorkPage.test.tsx (stays; specifier only)

Rule: Public index and one-way wall — board
  Create: client/src/features/board/index.ts
          client/src/features/board/<AddCard cluster, views except ContextPanel, BoardContext, board/card/column/calendar/templates libs>
          server/src/modules/board/index.ts
          server/src/modules/board/<board.ts, cards.ts, card-*, columns*, attachment*, metrics.ts + tests>
  Modify: client/src/App.tsx (BoardProvider via board index; ContextPanel stays leftover until board wave-2)
          client/src/pages/BoardPage.tsx (specifier only; file stays)
          leftover pages/layout importing BoardContext → features/board index
          scripts/check-work-item-mutation-routing.mjs (BoardContext allowlist path)
          server/src/routes.ts
          scripts/feature-modules/git-diff.test.mjs
  Test:   scripts/feature-modules/git-diff.test.mjs
          colocated board tests
          npm run check:mutation-routing

Rule: Wave-2 leftovers after public indexes exist
  Create: client/src/features/focus/FocusSessionContext.tsx
          client/src/features/focus/FocusEntryButton.tsx
          client/src/features/board/ContextPanel.tsx
          client/src/features/agent/AgentCardDetail.tsx
          client/src/features/agent/useAgentBoard.ts
  Modify: client/src/App.tsx
          leftover ContextPanel (until board wave-2) / TrackerDetailPage / FocusIndicator specifiers
          scripts/feature-modules/git-diff.test.mjs
  Test:   scripts/feature-modules/git-diff.test.mjs
          colocated tests that move with those files

Rule: Path-only; no logic; fat files not split
  Modify: any oversized file touched in a packet (BoardContext, cards.ts, agent/service.ts, ContextPanel, ColumnView, …)
  Test:   scripts/feature-modules/git-diff.test.mjs (FM-RULE-3)
          npm run check:feature-modules

Rule: Auth screens and chat legacy tree — chat
  Create: client/src/features/chat/index.ts
          client/src/features/chat/<client/src/chat/* + components/chat/* + useChatStream + chatToolTrace>
          server/src/modules/chat/index.ts
          server/src/modules/chat/<server/src/chat/*>
  Modify: client/src/pages/ChatPage.tsx (specifier only; stays)
          server/src/index.ts / routes.ts chat mount
          scripts/feature-modules/git-diff.test.mjs
  Test:   colocated chat tests; ChatPage.test.tsx stays in pages/

Rule: Stubs and 300 ceiling
  Modify: none required to delete stubs
  Test:   scripts/feature-modules/line-budget.mjs still LINE_BUDGET_MAX 300
          existsSync leftover components/tracker stubs (Cycle Map must NOT require stubs gone)

Rule: Close #131 only when complete
  Modify: T17 PR body only (closes vs refs)
  Test:   Cycle Map for remaining FEATURES homes; npm run test; make check
```

Note: `(created by: TN)` destinations do not exist until that task’s `git mv`. RED Cycle Map assertions target the destination path so they fail today.

---

## Pocket Packets

---

### Task 1: Extract client kernel chrome and cross-cutting files [prereq]

## OBJECTIVE
Move true cross-cutting client chrome and helpers into `client/src/shared/` so later feature modules do not import leftover type-folders. Do not move BoardContext. Do not move pages. Do not delete tracker stubs.

Files:
- Create: `client/src/shared/PageHeader.tsx`, `client/src/shared/EmptyState.tsx`, `client/src/shared/LoadingCamel.tsx`, `client/src/shared/Toast.tsx`, `client/src/shared/Toast.test.tsx`, `client/src/shared/PresenceBar.tsx`, `client/src/shared/SuccessAnimation.tsx`, `client/src/shared/ToolTrace.tsx`, `client/src/shared/ToolTrace.test.tsx`, `client/src/shared/ToastContext.tsx`, `client/src/shared/ToastContext.test.tsx`, `client/src/shared/PresenceContext.tsx`, `client/src/shared/PresenceContext.test.tsx`, `client/src/shared/title.ts`, `client/src/shared/title.test.ts`, `client/src/shared/toolTrace.ts`, `client/src/shared/toolTrace.test.ts`, `client/src/shared/myWorkTypes.ts`, `client/src/shared/WorkspaceContext.tsx`, `client/src/shared/WorkspaceContext.test.tsx`, `client/src/shared/workspaceSelection.ts`, `client/src/shared/workspaceSelection.test.ts`, `client/src/shared/workspaceSwitcher.ts`, `client/src/shared/workspaceSwitcher.test.ts`, `client/src/shared/FloatingChatButton.tsx`, `client/src/shared/TicketIntakeChatOverlay.tsx`, `client/src/shared/PreviewScreen.tsx`, `client/src/shared/inputClass.ts`, `client/src/shared/AutoErrorListener.tsx`, `client/src/shared/TicketIntakeChatPanel.tsx`, `client/src/shared/useTicketIntakeChat.ts`, `client/src/shared/ticketIntakeBus.ts`, `client/src/shared/ticketIntakeBus.test.ts`, `client/src/shared/agentQueue.ts`, `client/src/shared/agentQueue.test.ts` plus colocated ticket-intake tests currently under `client/src/components/ticketIntake/` and `client/src/hooks/useTicketIntakeChat.ts`, `client/src/hooks/useTicketIntakeChat.test.ts`, `client/src/hooks/useTicketIntakeChat.integration.test.tsx`
- Modify: `client/src/App.tsx`, `client/src/layout/AppLayout.tsx`, `client/src/types.ts`, `client/src/api.ts`, `client/src/api.test.ts`, `client/src/shared/workItemMutations.ts`, `client/src/shared/workItemMutations.test.ts`, leftover importers of the old chrome/ticket-intake/workspace/`agentQueue` paths including leftover `client/src/hooks/useChatStream.ts`, leftover `client/src/hooks/useAgentChat.ts`, leftover `client/src/components/agent/AgentChatPanel.tsx`, `scripts/feature-modules/git-diff.test.mjs`, `scripts/feature-modules/imports.test.mjs`
- Test: `scripts/feature-modules/git-diff.test.mjs`

Steps:
1. Write failing test for: Chrome extract retargets every importer
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit

   Test intent:
   Given chrome files still live under `components/`, `context/`, `lib/`, `components/ticketIntake/`, and `hooks/useTicketIntakeChat.ts`
   When Cycle Map is evaluated
   Then:
   - `client/src/shared/<each chrome home>` exists
   - the leftover type-folder paths listed in OBJECTIVE no longer exist
   - leftover `client/src/lib/agentQueue.ts` is gone
   - `client/src/context/BoardContext.tsx` still exists (not dumped to shared)
   - `LINE_BUDGET_MAX` is still 300
   - tracker stub files under `client/src/components/tracker/` still exist

   Exercise through:
   - Cycle Map `existsSync` assertions in `scripts/feature-modules/git-diff.test.mjs`

   Test doubles:
   - mock/fake: none
   - do NOT mock: filesystem / Cycle Map

   Expected RED:
   - `existsSync` for `client/src/shared/PageHeader.tsx` (and sibling chrome homes) is false today

2. Run test — verify FAIL:
   `npm run test:feature-modules`
   Expected failure: Cycle Map assertion that a new shared chrome home exists

3. Implement minimal code to satisfy the test:
   File: paths in OBJECTIVE
   Implement: `git mv` identical-content into `client/src/shared/`; retarget every specifier and `vi.mock` / `typeof import`; keep `shared/index.ts` as `export {}`; do not move BoardContext; do not biome-reorder imports on files already >300 lines

4. Run test — verify PASS:
   `npm run test:feature-modules`
   Expected: PASS
   Also run: `npm run check:feature-modules` and `npm run check:mutation-routing` and `npm run test --workspace=client -- src/shared/title.test.ts src/shared/ToastContext.test.tsx src/shared/PresenceContext.test.tsx src/shared/ToolTrace.test.tsx src/shared/toolTrace.test.ts src/shared/workspaceSelection.test.ts src/shared/workspaceSwitcher.test.ts src/shared/workItemMutations.test.ts`

5. Refactor while green (bounded):
   - Do **not** split files already >300 lines
   - If FM-RULE-3 fires from import-order hunks on a fat file, revert those hunks
   - Re-run: `npm run test:feature-modules` — must stay PASS

6. Commit:
   Stage every path this packet moves or retargets (shared homes, leftover importers, `client/src/api.ts`, `client/src/api.test.ts`, `client/src/shared/workItemMutations.ts`, Cycle Map).
   `git commit -m "refactor(architecture): extract shared chrome into client kernel"`
   PR: `refs #131` (not closes)

## REFERENCES LOADED
docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md — rule: Kernel/shared first; GWT Chrome extract retargets every importer; BoardContext is not dumped into shared
scripts/feature-modules/git-diff.test.mjs — Cycle Map existsSync home/absence pattern from PR #132–#155
client/src/features/tracker/index.ts — public API pattern (do not use for chrome; shared/index.ts stays empty)

## WHY THIS APPROACH
Justification: Unblocks one-way for every later feature packet; chrome is required before close anyway.
Complexity: deep

## SANDWICH CONTEXT
[CRITICAL: Do not move BoardContext into shared/; do not split fat files; do not delete tracker stubs; LINE_BUDGET_MAX stays 300]
You are implementing T1 client kernel extract for #131 relocation close.
Spec: docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
Design decision: Option A — kernel-first ladder, then one FEATURES name per PR
Files in scope: listed in OBJECTIVE — no other product FEATURES trees
Test framework: node:test via `npm run test:feature-modules`; Vitest via `npm run test --workspace=client -- <rel path>`
Available after: none (prereq)
Architecture rule: modules must not import leftover type-folders; leftover pages may import `shared/` deeply; `shared/index.ts` stays `export {}`
[RESTATE: Do not move BoardContext into shared/; do not split fat files; do not delete tracker stubs; LINE_BUDGET_MAX stays 300]

## DELIVERABLE
Verification — task is DONE when all pass:

Given PageHeader lives under client/src/components/ and layout plus many pages import it, When chrome is git-mv'd to client/src/shared/, Then every specifier is updated in that PR and colocated chrome tests live under shared/ and pages remain under pages/

[must-not] Given BoardContext is board-owned, When kernel extract PRs run, Then BoardContext is not moved to shared/

All tests PASS. Commit exists with message matching `refactor(architecture): extract shared chrome into client kernel`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Cycle Map locks new shared homes and leftover absences
  - All importers retargeted (layout, App.tsx, pages, tests)
  - Tests written/updated BEFORE the git mv is treated as done (TDD Cycle Map first)
  - Ticket-intake **client** files land in shared/ in this task
  - `types/myWork.ts` consumers (including `workItemMutations`) retarget to shared
  - `npm run check:mutation-routing` green (ADR #103; T1 touches `shared/workItemMutations.ts`)
  - Conventional commit

Must-not-have:
  - BoardContext in shared/
  - God-file splits
  - Deleting tracker stubs
  - Moving files already in `pages/`
  - HTTP/schema/dual-table behavior changes
  - `features/work-items/`
  - `closes #131` on this PR
  - Filling `shared/index.ts`

Open question risks:
  - Ticket-intake client assumed kernel because BoardContext + layout import it → if wrong, report NEEDS_CONTEXT (do not put it in features/agent yet)
  - WorkspaceContext assumed kernel because layout + many FEATURES import it → if wrong, report NEEDS_CONTEXT

Rollback note:
  - Revert this PR; do not leave half-moved chrome

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, Cycle Map green, check:feature-modules green, check:mutation-routing green, commit created
Uncertain when: a file thought to be chrome is actually a single-feature product (especially WorkspaceContext or ticket-intake)
Escalate when: FM-RULE-3 forces a split, or BoardContext is the only way to make one-way pass

---

### Task 2: Extract server kernel card-assignees and card-response [depends: T1]

## OBJECTIVE
Move `card-assignees.ts` and `card-response.ts` (and colocated tests) into `server/src/lib/` so later `modules/my-work` and `modules/board` import kernel lib instead of leftover `routes/`.

Files:
- Create: `server/src/lib/card-assignees.ts`, `server/src/lib/card-response.ts`, plus colocated tests currently beside them under `server/src/routes/`
- Modify: `server/src/lib/work-item-response.ts`, `server/src/core/board-card-status-change.ts`, `server/src/core/board-card-status-change.test.ts`, leftover `server/src/routes/my-work*.ts` and `server/src/routes/cards.ts` / `board.ts` / `card-create.ts` specifiers only, `scripts/feature-modules/git-diff.test.mjs`, `scripts/feature-modules/imports.test.mjs`
- Test: `scripts/feature-modules/git-diff.test.mjs`

Steps:
1. Write failing test for: Module must not import leftover card-assignees
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit

   Test intent:
   Given card-assignees and card-response still live under `server/src/routes/`
   When Cycle Map is evaluated
   Then:
   - `server/src/lib/card-assignees.ts` and `server/src/lib/card-response.ts` exist
   - leftover `server/src/routes/card-assignees.ts` and `server/src/routes/card-response.ts` are gone
   - my-work and board product routers are still under `server/src/routes/` (not moved in this task)

   Exercise through:
   - Cycle Map `existsSync` assertions

   Test doubles:
   - mock/fake: none
   - do NOT mock: Cycle Map / filesystem

   Expected RED:
   - `server/src/lib/card-assignees.ts` does not exist today

2. Run test — verify FAIL:
   `npm run test:feature-modules`
   Expected failure: missing `server/src/lib/card-assignees.ts` (or card-response)

3. Implement minimal code to satisfy the test:
   File: paths in OBJECTIVE
   Implement: `git mv` to `server/src/lib/` with NodeNext `.js` specifier retargets; do not create `modules/board` or `modules/my-work` yet

4. Run test — verify PASS:
   `npm run test:feature-modules`
   Expected: PASS
   Also run: `npm run check:feature-modules` and `npm run test --workspace=server -- src/lib/card-response.test.ts src/lib/card-response.integration.test.ts src/core/board-card-status-change.test.ts`

5. Refactor while green (bounded):
   - Do not split files already >300 lines; revert biome import-order on fat files
   - Re-run: `npm run test:feature-modules`

6. Commit:
   Stage every path this packet moves or retargets.
   `git commit -m "refactor(architecture): extract card-assignees into server kernel"`
   PR: `refs #131`

## REFERENCES LOADED
docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md — rule: Kernel/shared first; GWT Module must not import leftover card-assignees
server/src/lib/work-item-response.ts — kernel already imports leftover card-assignees
server/src/modules/tracker/index.ts — `.js` re-export pattern (not used until feature packets)

## WHY THIS APPROACH
Justification: Kernel + my-work + board share these files; extracting first prevents FM-RULE-4 in T4/T5.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Do not open modules/board or modules/my-work in this task; do not split fat files]
You are implementing T2 server kernel extract for #131 relocation close.
Spec: docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
Design decision: Option A — kernel-first ladder
Files in scope: listed in OBJECTIVE
Test framework: node:test `npm run test:feature-modules`; Vitest `npm run test --workspace=server -- <rel path>`
Available after: T1
Architecture rule: leftover routes may import `server/src/lib/`; future modules must not import leftover routes
[RESTATE: Do not open modules/board or modules/my-work in this task; do not split fat files]

## DELIVERABLE
Given card-assignees.ts is still under routes/ and kernel work-item-response imports it, When a later my-work or board module packet would need those helpers, Then card-assignees already lives under server/src/lib/ from this extract

All tests PASS. Commit exists with message matching `refactor(architecture): extract card-assignees into server kernel`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Cycle Map locks lib homes and routes/ absences for these two files
  - Specifier-only retarget of kernel and leftover consumers
  - Conventional commit; PR `refs #131`

Must-not-have:
  - Moving my-work or board routers in this PR
  - God-file splits
  - `closes #131`
  - Dual-table / HTTP behavior changes

Open question risks:
  - If additional `card-*.ts` files are also imported by kernel + two features, report NEEDS_CONTEXT before expanding scope

Rollback note:
  - Revert this PR

## STOP CONDITIONS
Done when: Cycle Map green, check:feature-modules green, commit created
Uncertain when: another shared card-* file is required for one-way
Escalate when: extracting these files requires editing production logic

---

### Task 3: Move auth screens into pages [depends: T2]

## OBJECTIVE
`git mv` `AuthPage`, `EmailGatePage`, and `PickUsernamePage` (and colocated tests) from `client/src/components/` to `client/src/pages/`. They stay leftover orchestrators. Do not create `features/auth/` yet.

Files:
- Create: `client/src/pages/AuthPage.tsx`, `client/src/pages/AuthPage.test.tsx`, `client/src/pages/EmailGatePage.tsx`, `client/src/pages/EmailGatePage.test.tsx`, `client/src/pages/PickUsernamePage.tsx`, `client/src/pages/PickUsernamePage.test.tsx`
- Modify: `client/src/App.tsx`, leftover `client/src/pages/MyWorkPage.test.tsx` (`AuthPage` import path), `scripts/feature-modules/git-diff.test.mjs`
- Test: `client/src/pages/AuthPage.test.tsx`, `scripts/feature-modules/git-diff.test.mjs`

Steps:
1. Write failing test for: Auth screens become page orchestrators
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit

   Test intent:
   Given AuthPage.tsx lives under client/src/components/
   When Cycle Map is evaluated
   Then:
   - `client/src/pages/AuthPage.tsx`, `EmailGatePage.tsx`, and `PickUsernamePage.tsx` exist
   - leftover `client/src/components/AuthPage.tsx` (and the other two + tests) are gone
   - `client/src/features/auth/` does not exist yet

   Exercise through:
   - Cycle Map `existsSync` assertions

   Test doubles:
   - mock/fake: none
   - do NOT mock: Cycle Map

   Expected RED:
   - `client/src/pages/AuthPage.tsx` does not exist today

2. Run test — verify FAIL:
   `npm run test:feature-modules`
   Expected failure: missing `client/src/pages/AuthPage.tsx`

3. Implement minimal code to satisfy the test:
   File: paths in OBJECTIVE
   Implement: `git mv` the six files; specifier-only retarget `App.tsx` and leftover `MyWorkPage.test.tsx`; AuthPage is 396 lines — specifier-only, no import-order rewrite

4. Run test — verify PASS:
   `npm run test:feature-modules`
   Expected: PASS
   Also run: `npm run check:feature-modules` and `npm run test --workspace=client -- src/pages/AuthPage.test.tsx src/pages/EmailGatePage.test.tsx src/pages/PickUsernamePage.test.tsx`

5. Refactor while green (bounded):
   - Do not split AuthPage; revert biome import-order if FM-RULE-3 fires
   - Re-run: `npm run test:feature-modules`

6. Commit:
   `git commit -m "refactor(auth): move auth screens into pages"`
   PR: `refs #131`

## REFERENCES LOADED
docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md — rule: Auth screens; GWT Auth screens become page orchestrators
client/src/App.tsx — current imports from `./components/AuthPage`

## WHY THIS APPROACH
Justification: Close bar requires leftover product gone from `components/`; these files are page orchestrators, not `features/auth` yet.
Complexity: lightweight

## SANDWICH CONTEXT
[CRITICAL: Do not create features/auth/ in this task; do not split AuthPage]
You are implementing T3 auth screens → pages for #131 relocation close.
Spec: docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
Design decision: Option A
Files in scope: listed in OBJECTIVE
Test framework: node:test + Vitest workspace-scoped
Available after: T2
Architecture rule: pages stay leftover orchestrators after this move
[RESTATE: Do not create features/auth/ in this task; do not split AuthPage]

## DELIVERABLE
Given AuthPage.tsx lives under client/src/components/, When the auth-pages packet runs, Then AuthPage.tsx, EmailGatePage.tsx, and PickUsernamePage.tsx live under client/src/pages/ and App.tsx imports the pages/ paths and they are not placed under features/auth/

All tests PASS. Commit exists with message matching `refactor(auth): move auth screens into pages`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Cycle Map locks pages/ homes and components/ absences
  - App.tsx specifier-only
  - Test file count not reduced
  - PR `refs #131`

Must-not-have:
  - `features/auth/` in this PR
  - Logic/assertion changes in AuthPage tests except import paths
  - `closes #131`

Rollback note:
  - Revert this PR

## STOP CONDITIONS
Done when: Cycle Map and Auth page tests pass, commit created
Uncertain when: AuthPage cannot move without a binding change that trips FM-RULE-3 and cannot be reverted
Escalate when: implementer is asked to put these files in features/auth/

---

### Task 4: Relocate my-work feature module [depends: T3]

## OBJECTIVE
`git mv` leftover my-work **product** files (not `MyWorkPage.tsx`) into `client/src/features/my-work/` and `server/src/modules/my-work/` with public `index.ts`. Page stays. One FEATURES name only.

Files:
- Create: `client/src/features/my-work/index.ts` and bodies from `client/src/components/my-work/*`, `client/src/lib/myWork*.ts`, `client/src/api/myWork.ts` (tests colocate)
  `server/src/modules/my-work/index.ts` and bodies from `server/src/routes/my-work*.ts` (not kernel work-item tests)
- Modify: `client/src/pages/MyWorkPage.tsx` (specifier only), `client/src/pages/MyWorkPage.test.tsx` (specifier only), `client/src/pages/MyWorkPage.integration.test.tsx` (specifier only), `client/src/pages/myWorkPage.integration.harness.tsx` (specifier only), `client/src/api.ts`, `client/src/api.my-work.test.ts`, `server/src/routes.ts`, `scripts/feature-modules/git-diff.test.mjs`, `scripts/feature-modules/imports.test.mjs`
- Create (page-colocated test, not the feature module): `client/src/pages/MyWorkDetailSheet.test.tsx` via `git mv` from `client/src/components/my-work/MyWorkDetailSheet.test.tsx` (it imports leftover `BoardContext` + `MyWorkPage`; must not land under `features/my-work`)
- Test: `scripts/feature-modules/git-diff.test.mjs`, colocated my-work tests under the new trees

Steps:
1. Write failing test for: Happy path one feature packet without moving the page
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit

   Test intent:
   Given leftover my-work components and server my-work routes exist under type-folders and MyWorkPage.tsx lives under client/src/pages/
   When Cycle Map is evaluated
   Then:
   - `client/src/features/my-work/index.ts` and `server/src/modules/my-work/index.ts` exist
   - leftover `client/src/components/my-work/` production files and `client/src/lib/myWork*.ts` and `client/src/api/myWork.ts` are gone
   - leftover `server/src/routes/my-work.ts` / `my-work-router.ts` (and other my-work product routers) are gone
   - `client/src/pages/MyWorkPage.tsx` still exists
   - `client/src/features/chat/` still does not exist (second FEATURES name not added)

   Exercise through:
   - Cycle Map `existsSync` assertions

   Test doubles:
   - mock/fake: none
   - do NOT mock: Cycle Map

   Expected RED:
   - `client/src/features/my-work/index.ts` does not exist today

2. Run test — verify FAIL:
   `npm run test:feature-modules`
   Expected failure: missing `client/src/features/my-work/index.ts`

3. Implement minimal code to satisfy the test:
   File: paths in OBJECTIVE
   Implement: Before `git mv`, enumerate live leftovers: `git ls-files -- client/src/components/my-work client/src/lib client/src/api/myWork.ts server/src/routes`. Move only the my-work **product** files from that list (plus the listed test exceptions). Do not treat the OBJECTIVE glob as the inventory after rebase. Then `git mv` those files; add index barrels (client no extensions, server `.js`); retarget page/hubs to index only; colocate tests **except** `MyWorkDetailSheet.test.tsx` which `git mv`s to `client/src/pages/` beside MyWorkPage; do not move MyWorkPage; do not move chat/board files; fat files specifier-only

4. Run test — verify PASS:
   `npm run test:feature-modules`
   Expected: PASS
   Also run: `npm run check:feature-modules` and `npm run test --workspace=client -- src/features/my-work src/pages/MyWorkPage.test.tsx src/pages/MyWorkPage.integration.test.tsx src/api.my-work.test.ts` and `npm run test --workspace=server -- src/modules/my-work`

5. Refactor while green (bounded):
   - Do not split files already >300; revert biome import-order on fat files
   - Re-run: `npm run test:feature-modules`

6. Commit:
   `git commit -m "refactor(my-work): relocate my-work into feature modules"`
   PR: `refs #131`

## REFERENCES LOADED
docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md — rule: One FEATURES name per PR; pages stay
client/src/features/tracker/index.ts — named public API pattern
server/src/modules/tracker/index.ts — `.js` re-exports
client/src/api/myWork.ts — moves with my-work; hub api.ts stays

## WHY THIS APPROACH
Justification: First FEATURES packet after kernel; proves page-stay + index-only + client+server together.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Do not move MyWorkPage out of pages/; do not relocate a second FEATURES name; do not split fat files]
You are implementing T4 my-work relocate for #131 relocation close.
Spec: docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
Design decision: Option A
Files in scope: listed in OBJECTIVE
Test framework: node:test + Vitest workspace-scoped
Available after: T3
Architecture rule: leftover pages import `features/my-work` index only; module must not import leftover type-folder feature files
[RESTATE: Do not move MyWorkPage out of pages/; do not relocate a second FEATURES name; do not split fat files]

## DELIVERABLE
Given leftover my-work product files and MyWorkPage in pages/, When that packet git-mvs product files into features/my-work and modules/my-work, Then guards and full tests pass, test file count is not down, and MyWorkPage path is unchanged

[must-not] Given a branch that also moves chat product files, When reviewed, Then it is not merged as one packet

All tests PASS. Commit exists with message matching `refactor(my-work): relocate my-work into feature modules`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Public index.ts both sides
  - Test file count not reduced
  - PR `refs #131` not closes
  - Path-only (plus light format on files that stay ≤300)

Must-not-have:
  - Chat/board/agent files in this PR
  - Logic/matcher edits to go green
  - New type-folder stubs
  - `closes #131`

Open question risks:
  - `api/myWork.ts` must move; if hub wiring cannot use the feature index without logic change, report NEEDS_CONTEXT

Rollback note:
  - Revert the whole packet; no half-moved features/my-work

## STOP CONDITIONS
Done when: Cycle Map + my-work tests pass, check:feature-modules green, commit created
Uncertain when: a my-work production file still imports leftover board/workspace paths that T1/T2 did not extract
Escalate when: one-way fails unless a second FEATURES name is moved in this PR

---

### Task 5: Relocate focus wave-1 (no leftover context importers) [depends: T4]

## OBJECTIVE
`git mv` focus files that do **not** import leftover `BoardContext` **and** do **not** import leftover `FocusSessionContext` into `client/src/features/focus/` and `server/src/modules/focus/` with public `index.ts`. Leave `FocusSessionContext.tsx` (+ its tests) and `FocusEntryButton.tsx` (+ its test) leftover until T10. `FocusPage.tsx` stays in pages/. Leftover `ContextPanel` keeps importing leftover `FocusEntryButton` (do not retarget it in this packet).

Files:
- Create: `client/src/features/focus/index.ts`, `client/src/features/focus/FocusTimer.tsx`, `client/src/features/focus/FocusTimer.test.tsx`, `client/src/features/focus/focusDuration.ts`, `client/src/features/focus/focusDuration.test.ts`, `client/src/features/focus/focusGuards.ts`, `client/src/features/focus/focusGuards.test.ts`
  `server/src/modules/focus/index.ts` and bodies from `server/src/routes/focus-session.ts`, `focus-session-repo.ts`, `focus-session-inputs.ts`, `focus-session-membership.ts`, `focus-config.ts` + tests
- Modify: `client/src/pages/FocusPage.tsx` (specifier only for timer/helpers — not FocusSessionContext and not FocusEntryButton), leftover `client/src/context/FocusSessionContext.tsx` (`focusGuards` via focus index; leftover → module is allowed), leftover FocusSessionContext tests if they pin `../lib/focusGuards`, `server/src/routes.ts`, `scripts/feature-modules/git-diff.test.mjs`
- Test: `scripts/feature-modules/git-diff.test.mjs`

Steps:
1. Write failing test for: [derived] focus product leftovers relocate while FocusPage stays
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit

   Test intent:
   Given focus leftovers live under components/context/lib and server routes/focus-*
   When Cycle Map is evaluated
   Then:
   - `client/src/features/focus/index.ts` and `server/src/modules/focus/index.ts` exist
   - leftover `client/src/components/FocusTimer.tsx` is gone
   - leftover `server/src/routes/focus-session.ts` is gone
   - leftover `client/src/components/FocusEntryButton.tsx` **still exists** (imports leftover FocusSessionContext)
   - leftover `client/src/context/FocusSessionContext.tsx` **still exists** (wave-2)
   - `client/src/pages/FocusPage.tsx` still exists

   Exercise through:
   - Cycle Map `existsSync` assertions

   Test doubles:
   - mock/fake: none
   - do NOT mock: Cycle Map

   Expected RED:
   - `client/src/features/focus/index.ts` does not exist today

2. Run test — verify FAIL:
   `npm run test:feature-modules`
   Expected failure: missing `client/src/features/focus/index.ts`

3. Implement minimal code to satisfy the test:
   File: paths in OBJECTIVE
   Implement: `git mv` wave-1 files only (timer + duration + guards + server focus); index barrels; specifier-only; leftover FocusSessionContext imports `focusGuards` from the focus index (do not move the context file); do **not** move FocusEntryButton or FocusSessionContext; do **not** retarget leftover ContextPanel or TrackerDetailPage; do **not** retarget App.tsx FocusSessionProvider yet

4. Run test — verify PASS:
   `npm run test:feature-modules`
   Expected: PASS
   Also run: `npm run check:feature-modules` and `npm run test --workspace=client -- src/features/focus src/pages/FocusPage.test.tsx` and `npm run test --workspace=server -- src/modules/focus`

5. Refactor while green (bounded):
   - Do not split files already >300; do not move FocusSessionContext or FocusEntryButton
   - Re-run: `npm run test:feature-modules`

6. Commit:
   `git commit -m "refactor(focus): relocate focus into feature modules"`
   PR: `refs #131`

## REFERENCES LOADED
docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md — rule: One FEATURES name per PR; pages stay
client/src/features/tracker/index.ts — public API pattern

## WHY THIS APPROACH
Justification: Same relocate packet as my-work/board for the focus FEATURES name.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Do not move FocusSessionContext or FocusEntryButton in this task; FocusPage stays in pages/; do not split fat files; PR refs #131 only]
You are implementing T5 focus wave-1 relocate for #131 relocation close.
Spec: docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
Design decision: Option A plus two-wave focus/agent and board ContextPanel deferral
Files in scope: listed in OBJECTIVE
Test framework: node:test + Vitest workspace-scoped
Available after: T4
Architecture rule: module files must not import leftover FocusSessionContext; leftover ContextPanel keeps leftover FocusEntryButton
[RESTATE: Do not move FocusSessionContext or FocusEntryButton in this task; FocusPage stays in pages/; do not split fat files; PR refs #131 only]

## DELIVERABLE
[derived — no GWT in spec for focus by name] Given leftover focus product files and FocusPage in pages/, When they git-mv into features/focus and modules/focus, Then guards pass, test file count is not down, and FocusPage path is unchanged

All tests PASS. Commit exists with message matching `refactor(focus): relocate focus into feature modules`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Cycle Map focus homes
  - Test file count not reduced
  - Path-only; PR `refs #131`

Must-not-have:
  - Moving FocusPage into features/
  - Moving FocusEntryButton or FocusSessionContext
  - `closes #131`
  - God-file splits

Rollback note:
  - Revert the whole focus packet

## STOP CONDITIONS
Done when: Cycle Map and focus tests pass
Uncertain when: focus module imports leftover board/workspace type-folders
Escalate when: one-way requires a second FEATURES name

---

### Task 6: Relocate client chat [depends: T5]

## OBJECTIVE
`git mv` leftover **client** chat product files including `client/src/chat/` into `client/src/features/chat/` with public `index.ts`. Leave `server/src/chat/` leftover until T8 (those files import leftover agent tools). `ChatPage.tsx` stays in pages/. Do not retarget leftover `llm.ts` yet (server chat index does not exist).

Files:
- Create: `client/src/features/chat/index.ts` and bodies from `client/src/chat/*`, `client/src/components/chat/*` if present, `client/src/hooks/useChatStream.ts`, `client/src/lib/chatToolTrace.ts` + tests
- Modify: `client/src/pages/ChatPage.tsx` (specifier only), `scripts/feature-modules/git-diff.test.mjs`
- Test: `scripts/feature-modules/git-diff.test.mjs`

Steps:
1. Write failing test for: client/src/chat/ moves with client chat
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit

   Test intent:
   Given ChatRuntimeProvider and adapters live under client/src/chat/
   When Cycle Map is evaluated
   Then:
   - `client/src/features/chat/index.ts` exists
   - leftover `client/src/chat/ChatRuntimeProvider.tsx` is gone
   - leftover `server/src/chat/routes.ts` **still exists** (server chat is T8)
   - `client/src/pages/ChatPage.tsx` still exists

   Exercise through:
   - Cycle Map `existsSync` assertions

   Test doubles:
   - mock/fake: none
   - do NOT mock: Cycle Map

   Expected RED:
   - `client/src/features/chat/index.ts` does not exist today

2. Run test — verify FAIL:
   `npm run test:feature-modules`
   Expected failure: missing `client/src/features/chat/index.ts`

3. Implement minimal code to satisfy the test:
   File: paths in OBJECTIVE
   Implement: `git mv` client chat only; index barrels; ChatPage specifier-only; `useChatStream` imports `shared/agentQueue` (T1), not leftover `lib/agentQueue`; do **not** move `server/src/chat/`; do not retarget leftover `llm.ts`; leftover `client/src/context/BoardContext.tsx` still may import leftover `lib/agentStream` until T7; do not move Inbox/Dashboard pages

4. Run test — verify PASS:
   `npm run test:feature-modules`
   Expected: PASS
   Also run: `npm run check:feature-modules` and `npm run test --workspace=client -- src/features/chat src/pages/ChatPage.test.tsx`

5. Refactor while green (bounded):
   - Do not split useChatStream if >300; revert format hunks
   - Re-run: `npm run test:feature-modules`

6. Commit:
   `git commit -m "refactor(chat): relocate client chat into feature module"`
   PR: `refs #131`

## REFERENCES LOADED
docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md — rule: Auth screens and chat legacy tree
client/src/chat/ChatRuntimeProvider.tsx — leftover runtime tree
server/src/chat/run-chat-turn.ts — imports leftover agent tools; cannot move until agent index exists

## WHY THIS APPROACH
Justification: Client chat does not import leftover agent. Server chat does — it waits for T7 then moves in T8.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: ChatPage stays in pages/; do not move server/src/chat/; do not add a second FEATURES name; do not split fat chat hooks]
You are implementing T6 client chat relocate for #131 relocation close.
Spec: docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
Design decision: Option A plus chat/agent wave split
Files in scope: listed in OBJECTIVE
Test framework: node:test + Vitest workspace-scoped
Available after: T5
Architecture rule: client chat module must not import leftover agentQueue (already shared) or leftover agent type-folders
[RESTATE: ChatPage stays in pages/; do not move server/src/chat/; do not add a second FEATURES name; do not split fat chat hooks]

## DELIVERABLE
Given ChatRuntimeProvider and adapters live under client/src/chat/, When the client chat packet runs, Then those files live under features/chat/ with index.ts, ChatPage.tsx stays under pages/, and server/src/chat/ still exists

All tests PASS. Commit exists with message matching `refactor(chat): relocate client chat into feature module`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Cycle Map client chat home and `client/src/chat/` absence
  - leftover server chat still present
  - Test file count not reduced
  - PR `refs #131`

Must-not-have:
  - Moving ChatPage into features/
  - Moving `server/src/chat/` (that is T8)
  - `closes #131` (more FEATURES remain)
  - Logic changes in stream/LLM chat code

Open question risks:
  - `lib/chatToolTrace.ts` assumed client chat packet; if ToolTrace chrome already needed it in T1, skip duplicate move

Rollback note:
  - Revert the whole client chat packet

## STOP CONDITIONS
Done when: Cycle Map and client chat tests pass
Uncertain when: client chat module imports leftover agent type-folders
Escalate when: one-way requires moving server chat or agent files in this PR

---
### Task 7: Relocate agent wave-1 (closed dependency slice) [depends: T6]

## OBJECTIVE
Relocate the closed agent wave-1 slice into `client/src/features/agent/` and `server/src/modules/agent/` with public indexes. Leave `agentStream*`, `agentBoardSync*`, `BoardContext.tsx`, `AgentCardDetail.tsx`, and `useAgentBoard.ts` byte-for-byte compatible with `main` for the later agent wave-2. Leave the LLM cluster until agent wave-2. Agent/History pages stay in `pages/`; `agent/service.ts` moves as-is; do not close #121.

Files:
- Create: the closed client slice (`AgentBoardHeader`, `AgentBoardVisual`, `AgentChatPanel`, `AgentComposer`, `ArtifactCard` + test, `agentColumnState` + test, `agentFollowUp`, `useAgentChat`) under `client/src/features/agent/` with `index.ts`; keep `agentStream*` and `agentBoardSync*` in `client/src/lib/` (`agentQueue` already lives in `shared/` from T1 — do not move it)
  `server/src/modules/agent/index.ts` and bodies from `server/src/agent/**` **except the llm cluster listed above**, plus `server/src/routes/ticket-intake.ts` and its non-LLM tests
- Modify: `client/src/pages/AgentPage.tsx` (specifier only for the five public exports), `client/src/pages/AgentPage.test.tsx` (path-only `vi.mock` of moved `ArtifactCard`), moved-slice internal imports, leftover `server/src/chat/**`, the leftover LLM cluster's imports of moved server helpers, `server/src/routes/ticket-intake.ts` plus its tests, `server/src/__tests__/prompt-sanitizer.test.ts`, `server/src/index.ts`, and `scripts/feature-modules/git-diff.test.mjs`; do not modify `BoardContext.tsx`, `AgentCardDetail.tsx`, `useAgentBoard.ts`, or stream/sync files
- Test: `scripts/feature-modules/git-diff.test.mjs`

Steps:
1. Write failing test for: Logic change not allowed (relocate proof)
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit

   Test intent:
   Given agent leftovers live under `client/src/components/agent/` and `server/src/agent/`
   When Cycle Map is evaluated
   Then:
   - `client/src/features/agent/index.ts` and `server/src/modules/agent/index.ts` exist
   - leftover `server/src/agent/service.ts` is gone (now under modules/agent)
   - leftover `server/src/routes/ticket-intake.ts` **still exists** (imports leftover ticket-intake/llm.ts)
   - leftover `server/src/agent/llm.ts` and `server/src/agent/routes.ts` **still exist** (llm cluster)
   - leftover `client/src/components/AgentCardDetail.tsx` and `client/src/hooks/useAgentBoard.ts` **still exist** (wave-2)
   - leftover `client/src/components/ArtifactCard.tsx` is gone
   - `client/src/pages/AgentPage.tsx` and `HistoryPage.tsx` still exist

   Exercise through:
   - Cycle Map `existsSync` assertions

   Test doubles:
   - mock/fake: none
   - do NOT mock: Cycle Map

   Expected RED:
   - `server/src/modules/agent/index.ts` does not exist today

2. Run test — verify FAIL:
   `npm run test:feature-modules`
   Expected failure: missing `server/src/modules/agent/index.ts`

3. Implement minimal code to satisfy the test:
   File: paths in OBJECTIVE
   Implement: enumerate live leftovers with `git ls-files`; move only the closed client slice and the server wave-1 files; do not move stream/sync, their consumers, the LLM cluster, or `agentQueue`. ArtifactCard moves with AgentChatPanel and the page test retargets its path-only mock. Use a narrow client barrel containing only AgentPage's five public imports. On the server, use `.js` index exports for the moved helpers and retarget leftover consumers; `ticket-intake.test.ts` uses an explicit runtime mock and mocks leftover `ticket-intake/llm.ts` directly. Moved modules must not import leftover chat; do not edit service.ts logic or close #121.

4. Run test — verify PASS:
   `npm run test:feature-modules`
   Expected: PASS
   Also run: `npm run check:feature-modules` and `npm run test --workspace=client -- src/features/agent src/pages/AgentPage.test.tsx` and `npm run test --workspace=server -- src/modules/agent`

5. Refactor while green (bounded):
   - service.ts is 1261 lines — specifier-only; revert format that trips FM-RULE-3; do not split
   - Re-run: `npm run test:feature-modules`

6. Commit:
   `git commit -m "refactor(agent): relocate agent into feature modules"`
   PR: `refs #131` — do not close #121

## REFERENCES LOADED
docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md — rule: Path-only; #121 stays open
server/src/agent/service.ts — oversized god file, move as-is

## WHY THIS APPROACH
Justification: Agent leftover tree is a closed type-folder; new files already forbidden there.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: This is a closed slice: do not touch BoardContext, AgentCardDetail, useAgentBoard, agentStream*, or agentBoardSync*; do not split agent/service.ts; do not close #121 or #131; do not change LLM/runtime behavior]
You are implementing T7 agent wave-1 relocate for #131 relocation close.
Spec: docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
Design decision: Option A
Files in scope: listed in OBJECTIVE
Test framework: node:test + Vitest workspace-scoped
Available after: T6
Architecture rule: module files must not import leftover server/src/chat/; leftover server chat may import the server agent index; external client consumers use the narrow agent index only
[RESTATE: Closed client slice only. Do not touch BoardContext/AgentCardDetail/useAgentBoard/agentStream*/agentBoardSync*, do not split agent/service.ts, do not close #121 or #131, and do not change LLM/runtime behavior]

## DELIVERABLE
Given leftover agent files under server/src/agent/, When they git-mv into modules/agent with specifier-only hunks, Then index is public, pages stay, and issue #121 stays open

[must-not] Given a test fails, When someone edits a matcher or service branch to go green, Then that change is rejected

All tests PASS. Commit exists with message matching `refactor(agent): relocate agent into feature modules`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Cycle Map agent homes
  - Test file count not reduced
  - PR `refs #131`

Must-not-have:
  - Logic changes in service.ts / llm.ts
  - Closing #121 or #131
  - Moving ChatPage or client/src/chat/ (that is T6)
  - Moving server/src/chat/ (that is T8)
  - Moving the llm cluster (agent wave-2)

Rollback note:
  - Revert the whole agent packet

## STOP CONDITIONS
Done when: Cycle Map and agent tests pass
Uncertain when: agent module would import leftover chat files
Escalate when: one-way requires adding chat to this PR

---

### Task 8: Relocate server chat [depends: T7]

## OBJECTIVE
`git mv` leftover `server/src/chat/**` into `server/src/modules/chat/` with public `index.ts`. Those files import `modules/agent` index only (tools, prompt-sanitizer, artifact, rate-limits — not leftover `server/src/agent/`). Leftover `llm.ts` retargets `runChatTurn` to the chat index (leftover → module is allowed). Do not move `llm.ts`. Client chat already lives under `features/chat/` from T6; extend or add `modules/chat/index.ts` as the server public API. `ChatPage.tsx` stays in pages/.

Files:
- Create: `server/src/modules/chat/index.ts` and bodies from `server/src/chat/**`
- Modify: leftover `server/src/agent/llm.ts` (`runChatTurn` via modules/chat index), `server/src/index.ts` (chat router mount), `scripts/feature-modules/git-diff.test.mjs`
- Test: `scripts/feature-modules/git-diff.test.mjs`

Steps:
1. Write failing test for: [derived] server chat relocates after agent index exists
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit

   Test intent:
   Given leftover `server/src/chat/routes.ts` still exists and `server/src/modules/agent/index.ts` exists
   When Cycle Map is evaluated
   Then:
   - `server/src/modules/chat/index.ts` exists
   - leftover `server/src/chat/routes.ts` is gone
   - leftover `server/src/agent/llm.ts` **still exists**

   Exercise through:
   - Cycle Map `existsSync` assertions

   Test doubles:
   - mock/fake: none
   - do NOT mock: Cycle Map

   Expected RED:
   - `server/src/modules/chat/index.ts` does not exist until this packet

2. Run test — verify FAIL:
   `npm run test:feature-modules`
   Expected failure: missing `server/src/modules/chat/index.ts`

3. Implement minimal code to satisfy the test:
   File: paths in OBJECTIVE
   Implement: `git mv` server chat; index with `.js`; module files import `modules/agent` index only (not leftover `server/src/agent/`); leftover `llm.ts` imports chat index; do not move llm.ts, routes.ts (agent), or a second FEATURES name; specifier-only

4. Run test — verify PASS:
   `npm run test:feature-modules`
   Expected: PASS
   Also run: `npm run check:feature-modules` and `npm run test --workspace=server -- src/modules/chat`

5. Refactor while green (bounded):
   - Do not split fat files; revert format hunks
   - Re-run: `npm run test:feature-modules`

6. Commit:
   `git commit -m "refactor(chat): relocate server chat after agent tools"`
   PR: `refs #131`

## REFERENCES LOADED
docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md — one FEATURES name per PR; one-way wall
server/src/chat/run-chat-turn.ts — imports agent tools/prompt-sanitizer; cannot move until agent index exists
server/src/agent/llm.ts — imports runChatTurn; stays leftover until agent wave-2

## WHY THIS APPROACH
Justification: Same chat FEATURES name as T6, second PR. Unblocks leftover llm.ts without combining chat+agent names.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Import modules/agent index only; do not import leftover server/src/agent/; do not move llm.ts]
You are implementing T8 server chat relocate for #131 relocation close.
Spec: docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
Design decision: Option A plus chat/agent wave split
Files in scope: listed in OBJECTIVE
Test framework: node:test + Vitest workspace-scoped
Available after: T7
Architecture rule: module → other module index only; leftover llm.ts may import the chat index
[RESTATE: Import modules/agent index only; do not import leftover server/src/agent/; do not move llm.ts]

## DELIVERABLE
[derived] Given leftover server chat imports leftover agent tools, When the agent index already exists and this packet git-mvs server chat into modules/chat, Then check:feature-modules passes, leftover llm.ts imports the chat index, and ChatPage stays in pages/

All tests PASS. Commit exists with message matching `refactor(chat): relocate server chat after agent tools`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Cycle Map server chat home
  - leftover llm.ts still present
  - One-way wall green
  - PR `refs #131`

Must-not-have:
  - Moving llm.ts or agent routes
  - A second FEATURES name
  - `closes #131`
  - Logic changes in run-chat-turn

Rollback note:
  - Revert this PR

## STOP CONDITIONS
Done when: Cycle Map and server chat tests pass
Uncertain when: a server chat file still needs a leftover agent import after specifier retarget
Escalate when: one-way fails unless agent llm.ts is moved in this PR

---

### Task 9: Relocate board wave-1 (no ContextPanel) [depends: T8 + Hotfix #2]

## OBJECTIVE
`git mv` leftover board product files **except `ContextPanel`** into `client/src/features/board/` and `server/src/modules/board/` with public `index.ts`. `BoardPage.tsx` stays in pages/. `cards.ts` moves as-is; do not close #115. Update mutation-routing allowlist when BoardContext moves. Leave `ContextPanel.tsx` (+ its tests) leftover until T11 — it still imports leftover `FocusEntryButton`. This task is blocked until Hotfix #2 extracts the small workspace-reset helper that lets the new BoardContext avoid importing `client/src/lib/agentStream` or the agent barrel.

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

---

### Task 10: Relocate focus wave-2 (BoardContext consumers) [depends: T9]

## OBJECTIVE
`git mv` remaining focus files that import leftover `BoardContext` **or leftover `FocusSessionContext`** into `client/src/features/focus/` and extend the public index. They import `features/board` index only for `useBoard`. `FocusPage.tsx` stays in pages/. `App.tsx` FocusSessionProvider retargets to the focus index. Leftover `ContextPanel` and `TrackerDetailPage` retarget `FocusEntryButton` to the focus index (leftover → module is allowed). Do not move `ContextPanel`.

Files:
- Create: `client/src/features/focus/FocusSessionContext.tsx`, `client/src/features/focus/FocusSessionContext.test.tsx`, `client/src/features/focus/FocusSessionContext.guards.test.tsx`, `client/src/features/focus/FocusEntryButton.tsx`, `client/src/features/focus/FocusEntryButton.test.tsx`
- Modify: `client/src/features/focus/index.ts`, `client/src/App.tsx`, `client/src/pages/FocusPage.tsx` (specifier only), leftover `client/src/components/ContextPanel.tsx` (FocusEntryButton via focus index), leftover `client/src/pages/TrackerDetailPage.tsx`, leftover `client/src/layout/FocusIndicator.tsx` (`useFocusSession` via focus index), `scripts/feature-modules/git-diff.test.mjs`
- Test: `scripts/feature-modules/git-diff.test.mjs`

Steps:
1. Write failing test for: [derived] FocusSessionContext relocates after board index exists
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit

   Test intent:
   Given leftover `client/src/context/FocusSessionContext.tsx` and leftover `client/src/components/FocusEntryButton.tsx` still exist and `client/src/features/board/index.ts` exists
   When Cycle Map is evaluated
   Then:
   - `client/src/features/focus/FocusSessionContext.tsx` and `client/src/features/focus/FocusEntryButton.tsx` exist
   - leftover `client/src/context/FocusSessionContext.tsx` is gone
   - leftover `client/src/components/FocusEntryButton.tsx` is gone
   - leftover `client/src/components/ContextPanel.tsx` **still exists**

   Exercise through:
   - Cycle Map `existsSync` assertions

   Test doubles:
   - mock/fake: none
   - do NOT mock: Cycle Map

   Expected RED:
   - `client/src/features/focus/FocusSessionContext.tsx` does not exist until this packet (wave-1 left it behind)

2. Run test — verify FAIL:
   `npm run test:feature-modules`
   Expected failure: missing `client/src/features/focus/FocusSessionContext.tsx` or `FocusEntryButton.tsx`

3. Implement minimal code to satisfy the test:
   File: paths in OBJECTIVE
   Implement: `git mv` FocusSessionContext + FocusEntryButton (+ tests); specifier-only import of `features/board` index (not leftover context/BoardContext); FocusEntryButton imports FocusSessionContext inside the focus module (not leftover context/); extend focus index; App.tsx FocusSessionProvider from focus index; leftover ContextPanel/TrackerDetailPage import FocusEntryButton from focus index; leftover FocusIndicator imports `useFocusSession` from focus index; do not move ContextPanel; do not split the 360-line context file

4. Run test — verify PASS:
   `npm run test:feature-modules`
   Expected: PASS
   Also run: `npm run check:feature-modules` and `npm run test --workspace=client -- src/features/focus src/pages/FocusPage.test.tsx`

5. Refactor while green (bounded):
   - Do not split FocusSessionContext; revert fat-file format hunks
   - Re-run: `npm run test:feature-modules`

6. Commit:
   Stage every path this packet moves or retargets.
   `git commit -m "refactor(focus): relocate FocusSessionContext and FocusEntryButton after board"`
   PR: `refs #131`

## REFERENCES LOADED
docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md — one FEATURES name per PR; one-way wall
client/src/context/FocusSessionContext.tsx — imports useBoard; cannot move until board index exists

## WHY THIS APPROACH
Justification: Wave-2 unblocks FM-RULE-4 after T8 without combining FEATURES names.
Complexity: lightweight

## SANDWICH CONTEXT
[CRITICAL: Import features/board index only; do not import leftover BoardContext; do not move ContextPanel; do not split FocusSessionContext]
You are implementing T10 focus wave-2 relocate for #131 relocation close.
Spec: docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
Design decision: Option A plus two-wave focus/agent
Files in scope: listed in OBJECTIVE
Test framework: node:test + Vitest workspace-scoped
Available after: T9
Architecture rule: module → other module index only; leftover ContextPanel may import the focus index
[RESTATE: Import features/board index only; do not import leftover BoardContext; do not move ContextPanel; do not split FocusSessionContext]

## DELIVERABLE
[derived] Given leftover FocusSessionContext imports leftover BoardContext and leftover FocusEntryButton imports leftover FocusSessionContext, When board index already exists and this packet git-mvs both into features/focus, Then check:feature-modules passes, leftover ContextPanel imports the focus index, and FocusPage stays in pages/

All tests PASS. Commit exists with message matching `refactor(focus): relocate FocusSessionContext and FocusEntryButton after board`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Cycle Map FocusSessionContext and FocusEntryButton homes
  - One-way wall green
  - PR `refs #131`

Must-not-have:
  - Moving a second FEATURES name
  - Moving ContextPanel
  - `closes #131`
  - Logic changes in FocusSessionContext

Rollback note:
  - Revert this PR

## STOP CONDITIONS
Done when: Cycle Map and focus tests pass
Uncertain when: FocusSessionContext still needs a leftover type-folder import after specifier retarget
Escalate when: one-way fails unless agent files are moved in this PR

---

### Task 11: Relocate board wave-2 (ContextPanel) [depends: T10]

## OBJECTIVE
`git mv` leftover `ContextPanel.tsx` (+ tests) into `client/src/features/board/` and extend the public index. It imports `FocusEntryButton` from `features/focus` index only (not leftover components/). `App.tsx` retargets ContextPanel to the board index. Do not split ContextPanel. Do not move a second FEATURES name.

Files:
- Create: `client/src/features/board/ContextPanel.tsx`, `client/src/features/board/ContextPanel.test.tsx`, `client/src/features/board/ContextPanel.attachments.test.tsx`
- Modify: `client/src/features/board/index.ts`, `client/src/App.tsx`, `scripts/feature-modules/git-diff.test.mjs`
- Test: `scripts/feature-modules/git-diff.test.mjs`

Steps:
1. Write failing test for: [derived] ContextPanel relocates after FocusEntryButton lives in features/focus
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit

   Test intent:
   Given leftover `client/src/components/ContextPanel.tsx` still exists and `client/src/features/focus/FocusEntryButton.tsx` exists
   When Cycle Map is evaluated
   Then:
   - `client/src/features/board/ContextPanel.tsx` exists
   - leftover `client/src/components/ContextPanel.tsx` is gone

   Exercise through:
   - Cycle Map `existsSync` assertions

   Test doubles:
   - mock/fake: none
   - do NOT mock: Cycle Map

   Expected RED:
   - `client/src/features/board/ContextPanel.tsx` does not exist until this packet (wave-1 left it behind)

2. Run test — verify FAIL:
   `npm run test:feature-modules`
   Expected failure: missing `client/src/features/board/ContextPanel.tsx`

3. Implement minimal code to satisfy the test:
   File: paths in OBJECTIVE
   Implement: `git mv` ContextPanel + tests; specifier-only import of `features/focus` index for FocusEntryButton; sibling board files via in-module paths or board index; App.tsx ContextPanel from board index; do not split ContextPanel — revert format hunks

4. Run test — verify PASS:
   `npm run test:feature-modules`
   Expected: PASS
   Also run: `npm run check:feature-modules` and `npm run test --workspace=client -- src/features/board`

5. Refactor while green (bounded):
   - Do not split ContextPanel; revert fat-file format hunks
   - Re-run: `npm run test:feature-modules`

6. Commit:
   Stage every path this packet moves or retargets.
   `git commit -m "refactor(board): relocate ContextPanel after focus entry button"`
   PR: `refs #131`

## REFERENCES LOADED
docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md — one FEATURES name per PR; one-way wall
client/src/components/ContextPanel.tsx — imports FocusEntryButton; cannot move until the button is a focus-module export

## WHY THIS APPROACH
Justification: Board wave-2 after T9; still board-only. Avoids FM-RULE-4 (module → leftover FocusEntryButton).
Complexity: lightweight

## SANDWICH CONTEXT
[CRITICAL: Import features/focus index only for FocusEntryButton; do not import leftover components/; do not split ContextPanel]
You are implementing T11 board wave-2 relocate for #131 relocation close.
Spec: docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
Design decision: Option A plus two-wave; ContextPanel deferred after focus wave-2
Files in scope: listed in OBJECTIVE
Test framework: node:test + Vitest workspace-scoped
Available after: T10
Architecture rule: module → other module index only
[RESTATE: Import features/focus index only for FocusEntryButton; do not import leftover components/; do not split ContextPanel]

## DELIVERABLE
[derived] Given leftover ContextPanel imports leftover FocusEntryButton, When focus index already exports FocusEntryButton and this packet git-mvs ContextPanel into features/board, Then check:feature-modules passes and App.tsx imports ContextPanel from the board index

All tests PASS. Commit exists with message matching `refactor(board): relocate ContextPanel after focus entry button`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Cycle Map ContextPanel home
  - One-way wall green
  - PR `refs #131`

Must-not-have:
  - Moving a second FEATURES name
  - `closes #131`
  - Logic changes in ContextPanel
  - Splitting ContextPanel

Rollback note:
  - Revert this PR

## STOP CONDITIONS
Done when: Cycle Map and board tests pass
Uncertain when: ContextPanel still needs a leftover type-folder import after specifier retarget
Escalate when: one-way fails unless a second FEATURES name is moved

---

### Task 12: Relocate agent wave-2 (BoardContext consumers, stream/sync + llm cluster) [depends: T11 + Hotfix #2]

## OBJECTIVE
`git mv` remaining agent files that import leftover `BoardContext`, the deferred stream/sync helpers, **and** the leftover llm cluster into `client/src/features/agent/` / `server/src/modules/agent/` and extend the public indexes. Client files import `features/board` index only. `llm.ts` imports `modules/chat` index only (not leftover `server/src/chat/`). Do not close #121. Hotfix #2 must be complete before this task; Agent/History pages stay in pages/.

Files:
- Create: `client/src/features/agent/AgentCardDetail.tsx`, `client/src/features/agent/AgentCardDetail.test.tsx`, `client/src/features/agent/useAgentBoard.ts`, `client/src/features/agent/agentStream.ts`, `client/src/features/agent/agentStream.test.ts`, `client/src/features/agent/agentBoardSync.ts`, `client/src/features/agent/agentBoardSync.test.ts`, `server/src/modules/agent/llm.ts`, `server/src/modules/agent/llm.test.ts`, `server/src/modules/agent/routes.ts`, `server/src/modules/agent/routes.test.ts`, `server/src/modules/agent/ticket-intake/llm.ts`, `server/src/modules/agent/ticket-intake/llm.test.ts`, `server/src/modules/agent/pipeline.integration.test.ts`, `server/src/modules/agent/` body from leftover `server/src/routes/ticket-intake.ts` + its tests
- Modify: `client/src/features/agent/index.ts`, `server/src/modules/agent/index.ts`, leftover `client/src/pages/AgentPage.tsx` (specifier only), leftover `server/src/routes/cards-identity.integration.test.ts` (`createAgentRouter` via agent index), `server/src/index.ts` (agent router mount if still leftover), `scripts/feature-modules/git-diff.test.mjs`
- Test: `scripts/feature-modules/git-diff.test.mjs`

Steps:
1. Write failing test for: [derived] AgentCardDetail, useAgentBoard, and llm cluster relocate after board and chat indexes exist
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit

   Test intent:
   Given leftover `client/src/components/AgentCardDetail.tsx`, leftover `client/src/hooks/useAgentBoard.ts`, leftover `server/src/agent/llm.ts` still exist and `client/src/features/board/index.ts` plus `server/src/modules/chat/index.ts` exist
   When Cycle Map is evaluated
   Then:
   - `client/src/features/agent/AgentCardDetail.tsx`, `useAgentBoard.ts`, `agentStream.ts`, and `agentBoardSync.ts` exist
   - `server/src/modules/agent/llm.ts` exists
   - leftover `server/src/agent/llm.ts` and leftover `server/src/routes/ticket-intake.ts` are gone

   Exercise through:
   - Cycle Map `existsSync` assertions

   Test doubles:
   - mock/fake: none
   - do NOT mock: Cycle Map

   Expected RED:
   - `client/src/features/agent/AgentCardDetail.tsx` and the deferred stream/sync homes do not exist until this packet

2. Run test — verify FAIL:
   `npm run test:feature-modules`
   Expected failure: missing `client/src/features/agent/AgentCardDetail.tsx` or `server/src/modules/agent/llm.ts`

3. Implement minimal code to satisfy the test:
   File: paths in OBJECTIVE
   Implement: `git mv` AgentCardDetail, useAgentBoard, agentStream, agentBoardSync, and the llm cluster; specifier-only import of `features/board` index for client leftovers; use relative imports inside the agent module; `llm.ts` imports `modules/chat` index only (not leftover `server/src/chat/`); extend agent indexes; do not split AgentCardDetail (500 lines) or llm.ts — revert format hunks; do not close #121

4. Run test — verify PASS:
   `npm run test:feature-modules`
   Expected: PASS
   Also run: `npm run check:feature-modules` and `npm run test --workspace=client -- src/features/agent` and `npm run test --workspace=server -- src/modules/agent`

5. Refactor while green (bounded):
   - Do not split AgentCardDetail or llm.ts; revert fat-file format hunks
   - Re-run: `npm run test:feature-modules`

6. Commit:
   Stage every path this packet moves or retargets.
   `git commit -m "refactor(agent): relocate BoardContext consumers and llm cluster"`
   PR: `refs #131` — do not close #121

## REFERENCES LOADED
docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md — one FEATURES name per PR; one-way wall
client/src/components/AgentCardDetail.tsx — imports useBoard
client/src/hooks/useAgentBoard.ts — imports useBoard
server/src/agent/llm.ts — imports runChatTurn; cannot move until chat index exists

## WHY THIS APPROACH
Justification: Wave-2 after T11; still agent-only. llm.ts waited for T8 server chat.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Hotfix #2 must be complete; import features/board index and modules/chat index only; move stream/sync with their consumers using relative module imports; do not import leftover BoardContext or leftover server/src/chat/; do not split AgentCardDetail or llm.ts; do not close #121]
You are implementing T12 agent wave-2 relocate for #131 relocation close.
Spec: docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
Design decision: Option A plus two-wave focus/agent and chat/agent llm split
Files in scope: listed in OBJECTIVE
Test framework: node:test + Vitest workspace-scoped
Available after: T11 + Hotfix #2
Architecture rule: module → other module index only; stream/sync are internal agent-module files after this task
[RESTATE: Import features/board index and modules/chat index only; do not import leftover BoardContext or leftover server/src/chat/; do not split AgentCardDetail or llm.ts; do not close #121]

## DELIVERABLE
[derived] Given leftover AgentCardDetail/useAgentBoard import leftover BoardContext and leftover llm.ts imports leftover chat, When board and chat indexes already exist and this packet git-mvs them into the agent module, Then check:feature-modules passes, AgentPage stays in pages/, and #121 stays open

All tests PASS. Commit exists with message matching `refactor(agent): relocate BoardContext consumers and llm cluster`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Cycle Map AgentCardDetail/useAgentBoard and llm.ts homes
  - leftover `server/src/agent/` llm cluster gone
  - One-way wall green
  - PR `refs #131`

Must-not-have:
  - Closing #121 or #131
  - Logic changes
  - A second FEATURES name

Rollback note:
  - Revert this PR

## STOP CONDITIONS
Done when: Hotfix #2 is recorded complete, Cycle Map and agent tests pass, and stream/sync no longer live under client/src/lib/
Uncertain when: another agent production file still imports leftover BoardContext
Blocked when: Hotfix #2 is incomplete or stream/sync cannot move without a second FEATURES name
Escalate when: one-way fails unless a second FEATURES name is moved

---

### Task 13: Relocate settings feature module [depends: T12]

## OBJECTIVE
`git mv` leftover settings product files into `client/src/features/settings/` and `server/src/modules/settings/` with public `index.ts`. `SettingsPage.tsx` stays in pages/.

Files:
- Create: `client/src/features/settings/index.ts` and bodies from `client/src/components/LogoCropper.tsx`, `client/src/components/settings/ManageMembersSection.tsx`, `client/src/lib/settingsValidation.ts` + tests
  `server/src/modules/settings/index.ts` and body from `server/src/routes/settings.ts` + `settings.test.ts`
- Modify: `client/src/pages/SettingsPage.tsx` (specifier only), leftover `server/src/routes/workspaces.ts` (`checkCanEditSettings` via modules/settings index; leftover → module is allowed), `server/src/routes.ts`, `server/src/index.ts` if it imports `UPLOADS_DIR` from settings, `scripts/feature-modules/git-diff.test.mjs`
- Test: `scripts/feature-modules/git-diff.test.mjs`

Steps:
1. Write failing test for: [derived] settings product leftovers relocate while SettingsPage stays
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit

   Test intent:
   Given settings leftovers live under components/settings and routes/settings.ts
   When Cycle Map is evaluated
   Then:
   - `client/src/features/settings/index.ts` and `server/src/modules/settings/index.ts` exist
   - leftover `server/src/routes/settings.ts` is gone
   - `client/src/pages/SettingsPage.tsx` still exists

   Exercise through:
   - Cycle Map `existsSync` assertions

   Test doubles:
   - mock/fake: none
   - do NOT mock: Cycle Map

   Expected RED:
   - `client/src/features/settings/index.ts` does not exist today

2. Run test — verify FAIL:
   `npm run test:feature-modules`
   Expected failure: missing `client/src/features/settings/index.ts`

3. Implement minimal code to satisfy the test:
   File: paths in OBJECTIVE
   Implement: `git mv`; index barrels; SettingsPage 784 lines specifier-only; settings.ts 643 lines specifier-only

4. Run test — verify PASS:
   `npm run test:feature-modules`
   Expected: PASS
   Also run: `npm run check:feature-modules` and `npm run test --workspace=client -- src/features/settings` and `npm run test --workspace=server -- src/modules/settings`

5. Refactor while green (bounded):
   - Do not split SettingsPage or settings.ts; revert fat-file format hunks
   - Re-run: `npm run test:feature-modules`

6. Commit:
   `git commit -m "refactor(settings): relocate settings into feature modules"`
   PR: `refs #131`

## REFERENCES LOADED
docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md — rule: One FEATURES name per PR; pages stay
server/src/index.ts — may import UPLOADS_DIR from settings

## WHY THIS APPROACH
Justification: Same relocate packet shape for the settings FEATURES name.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: SettingsPage stays in pages/; do not split SettingsPage or routes/settings.ts; refs #131 only]
You are implementing T13 settings relocate for #131 relocation close.
Spec: docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
Design decision: Option A
Files in scope: listed in OBJECTIVE
Test framework: node:test + Vitest workspace-scoped
Available after: T12
Architecture rule: hubs import modules/settings index only
[RESTATE: SettingsPage stays in pages/; do not split SettingsPage or routes/settings.ts; refs #131 only]

## DELIVERABLE
[derived — no GWT in spec for settings by name] Given leftover settings product files and SettingsPage in pages/, When they git-mv into features/settings and modules/settings, Then guards pass, test file count is not down, and SettingsPage path is unchanged

All tests PASS. Commit exists with message matching `refactor(settings): relocate settings into feature modules`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Cycle Map settings homes
  - Test file count not reduced
  - PR `refs #131`

Must-not-have:
  - Moving SettingsPage into features/
  - `closes #131`
  - God-file splits

Rollback note:
  - Revert the whole settings packet

## STOP CONDITIONS
Done when: Cycle Map and settings tests pass
Uncertain when: UPLOADS_DIR wiring cannot use the module index without logic change
Escalate when: one-way requires a second FEATURES name

---

### Task 14: Relocate workspaces feature module [depends: T13]

## OBJECTIVE
`git mv` leftover workspaces **product** files that did not already go to shared/ in T1 into `client/src/features/workspaces/` (if any remain) and `server/src/modules/workspaces/` with public `index.ts`. WorkspaceContext already lives in shared/ from T1.

Files:
- Create: `server/src/modules/workspaces/index.ts` and bodies from `server/src/routes/workspaces.ts`, `members.ts`, `invites.ts` + tests
  `client/src/features/workspaces/index.ts` only if leftover client product files remain after T1; if none remain, skip creating an empty client feature tree
- Modify: `server/src/routes.ts`, `scripts/feature-modules/git-diff.test.mjs`
- Test: `scripts/feature-modules/git-diff.test.mjs`

Steps:
1. Write failing test for: [derived] workspaces server leftovers relocate
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit

   Test intent:
   Given leftover workspaces/members/invites routers live under server/src/routes/
   When Cycle Map is evaluated
   Then:
   - `server/src/modules/workspaces/index.ts` exists
   - leftover `server/src/routes/workspaces.ts`, `members.ts`, and `invites.ts` are gone
   - `client/src/shared/WorkspaceContext.tsx` still exists (from T1)
   - `client/src/features/workspaces/index.ts` is **not** required (no leftover client product after T1; Cycle Map must not fail on its absence)
   - `server/src/routes/presence.ts` still exists unless it is clearly product (assumed stay)

   Exercise through:
   - Cycle Map `existsSync` assertions

   Test doubles:
   - mock/fake: none
   - do NOT mock: Cycle Map

   Expected RED:
   - `server/src/modules/workspaces/index.ts` does not exist today

2. Run test — verify FAIL:
   `npm run test:feature-modules`
   Expected failure: missing `server/src/modules/workspaces/index.ts`

3. Implement minimal code to satisfy the test:
   File: paths in OBJECTIVE
   Implement: Before `git mv`, enumerate: `git ls-files -- 'server/src/routes/workspaces*' 'server/src/routes/members*' 'server/src/routes/invites*'`. Then `git mv` those server workspaces/members/invites files **and colocated tests**; index with `.js`; specifier-only; do not move presence.ts unless it is product; do **not** create an empty `client/src/features/workspaces/` tree

4. Run test — verify PASS:
   `npm run test:feature-modules`
   Expected: PASS
   Also run: `npm run check:feature-modules` and `npm run test --workspace=server -- src/modules/workspaces`

5. Refactor while green (bounded):
   - Do not split fat files; revert format hunks
   - Re-run: `npm run test:feature-modules`

6. Commit:
   `git commit -m "refactor(workspaces): relocate workspaces into server module"`
   PR: `refs #131`

## REFERENCES LOADED
docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md — assumption: presence.ts stays realtime kernel; WorkspaceContext already in shared from T1
server/src/routes.ts — mounts workspaces/members/invites

## WHY THIS APPROACH
Justification: Client workspace chrome is kernel; server routers are the remaining workspaces product.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Do not move WorkspaceContext out of shared/; do not move presence.ts unless it is clearly product; refs #131 only]
You are implementing T14 workspaces relocate for #131 relocation close.
Spec: docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
Design decision: Option A
Files in scope: listed in OBJECTIVE
Test framework: node:test + Vitest workspace-scoped
Available after: T13
Architecture rule: routes.ts imports modules/workspaces index only
[RESTATE: Do not move WorkspaceContext out of shared/; do not move presence.ts unless it is clearly product; refs #131 only]

## DELIVERABLE
[derived] Given leftover workspaces/members/invites routers, When they git-mv into modules/workspaces, Then guards pass, test file count is not down, and WorkspaceContext remains in shared/

All tests PASS. Commit exists with message matching `refactor(workspaces): relocate workspaces into server module`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Cycle Map modules/workspaces homes
  - PR `refs #131`
  - Test file count not reduced

Must-not-have:
  - Re-homing WorkspaceContext
  - `closes #131`
  - Empty `features/workspaces/` created without production files (index-only empty tree)

Open question risks:
  - presence.ts assumed kernel facade → if product, move it in this packet and report DONE_WITH_CONCERNS

Rollback note:
  - Revert the whole workspaces packet

## STOP CONDITIONS
Done when: Cycle Map and workspaces tests pass
Uncertain when: presence.ts ownership is unclear
Escalate when: client leftover workspace files still sit in type-folders after T1

---

### Task 15: Relocate notifications feature module [depends: T14]

## OBJECTIVE
`git mv` leftover notifications product files into `client/src/features/notifications/` and `server/src/modules/notifications/` with public `index.ts`. `InboxPage.tsx` stays in pages/.

Files:
- Create: `client/src/features/notifications/index.ts` and bodies from `client/src/hooks/useNotifications.ts`, `client/src/context/NotificationsContext.tsx` + tests
  `server/src/modules/notifications/index.ts` and bodies from `server/src/notifications/**`
- Modify: `client/src/pages/InboxPage.tsx` (specifier only), leftover `client/src/layout/AppLayout.tsx` (`NotificationsProvider` via notifications index), leftover `client/src/layout/sidebar/Sidebar.tsx` (`useNotificationsContext` via notifications index), leftover InboxPage/AppLayout tests if they `vi.mock` NotificationsContext, `server/src/routes.ts`, `server/src/index.ts` (notifications init/scheduler), `scripts/feature-modules/git-diff.test.mjs`
- Test: `scripts/feature-modules/git-diff.test.mjs`

Steps:
1. Write failing test for: [derived] notifications leftovers relocate while InboxPage stays
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit

   Test intent:
   Given leftover notifications live under hooks/context and server/src/notifications/
   When Cycle Map is evaluated
   Then:
   - `client/src/features/notifications/index.ts` and `server/src/modules/notifications/index.ts` exist
   - leftover `server/src/notifications/router.ts` is gone
   - leftover `client/src/hooks/useNotifications.ts` is gone
   - `client/src/pages/InboxPage.tsx` still exists

   Exercise through:
   - Cycle Map `existsSync` assertions

   Test doubles:
   - mock/fake: none
   - do NOT mock: Cycle Map

   Expected RED:
   - `server/src/modules/notifications/index.ts` does not exist today

2. Run test — verify FAIL:
   `npm run test:feature-modules`
   Expected failure: missing `server/src/modules/notifications/index.ts`

3. Implement minimal code to satisfy the test:
   File: paths in OBJECTIVE
   Implement: `git mv`; index barrels; InboxPage specifier-only; leftover AppLayout and Sidebar import the notifications index (`NotificationsProvider` / `useNotificationsContext`); leftover tests that `vi.mock` NotificationsContext retarget; 383-line InboxPage not moved

4. Run test — verify PASS:
   `npm run test:feature-modules`
   Expected: PASS
   Also run: `npm run check:feature-modules` and `npm run test --workspace=client -- src/features/notifications src/pages/InboxPage.test.tsx` and `npm run test --workspace=server -- src/modules/notifications`

5. Refactor while green (bounded):
   - Do not split fat files; revert format hunks
   - Re-run: `npm run test:feature-modules`

6. Commit:
   `git commit -m "refactor(notifications): relocate notifications into feature modules"`
   PR: `refs #131`

## REFERENCES LOADED
docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md — rule: One FEATURES name per PR; pages stay
server/src/notifications/router.ts — leftover legacy tree

## WHY THIS APPROACH
Justification: Same relocate packet shape; InboxPage is a leftover orchestrator.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: InboxPage stays in pages/; do not close #131; one FEATURES name only]
You are implementing T15 notifications relocate for #131 relocation close.
Spec: docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
Design decision: Option A
Files in scope: listed in OBJECTIVE
Test framework: node:test + Vitest workspace-scoped
Available after: T14
Architecture rule: hubs import modules/notifications index only
[RESTATE: InboxPage stays in pages/; do not close #131; one FEATURES name only]

## DELIVERABLE
[derived] Given leftover notifications product files and InboxPage in pages/, When they git-mv into features/notifications and modules/notifications, Then guards pass, test file count is not down, and InboxPage path is unchanged

All tests PASS. Commit exists with message matching `refactor(notifications): relocate notifications into feature modules`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Cycle Map notifications homes
  - Test file count not reduced
  - PR `refs #131`

Must-not-have:
  - Moving InboxPage into features/
  - `closes #131`
  - Runtime notification behavior changes

Rollback note:
  - Revert the whole notifications packet

## STOP CONDITIONS
Done when: Cycle Map and notifications tests pass
Uncertain when: scheduler/init cannot mount via index without logic change
Escalate when: one-way requires a second FEATURES name

---

### Task 16: Relocate activity feature module [depends: T15]

## OBJECTIVE
`git mv` leftover activity product files into `client/src/features/activity/` (if any non-page files exist) and `server/src/modules/activity/` with public `index.ts`. `ActivityPage.tsx` stays in pages/.

Files:
- Create: `server/src/modules/activity/index.ts` and bodies from `server/src/routes/activity.ts` + `activity.*.test.ts`
  `client/src/features/activity/index.ts` only if non-page client activity product files exist; do not move ActivityPage
- Modify: `client/src/pages/ActivityPage.tsx` (specifier only if it imported leftover activity helpers), `server/src/routes.ts`, `scripts/feature-modules/git-diff.test.mjs`
- Test: `scripts/feature-modules/git-diff.test.mjs`

Steps:
1. Write failing test for: [derived] activity server leftovers relocate while ActivityPage stays
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit

   Test intent:
   Given leftover activity router lives under server/src/routes/activity.ts
   When Cycle Map is evaluated
   Then:
   - `server/src/modules/activity/index.ts` exists
   - leftover `server/src/routes/activity.ts` is gone
   - `client/src/pages/ActivityPage.tsx` still exists
   - `client/src/pages/DashboardPage.tsx` still exists (unmapped)
   - `client/src/features/activity/index.ts` is **not** required (ActivityPage stays in pages/; Cycle Map must not fail on its absence)

   Exercise through:
   - Cycle Map `existsSync` assertions

   Test doubles:
   - mock/fake: none
   - do NOT mock: Cycle Map

   Expected RED:
   - `server/src/modules/activity/index.ts` does not exist today

2. Run test — verify FAIL:
   `npm run test:feature-modules`
   Expected failure: missing `server/src/modules/activity/index.ts`

3. Implement minimal code to satisfy the test:
   File: paths in OBJECTIVE
   Implement: Before `git mv`, enumerate: `git ls-files -- server/src/routes/activity.ts server/src/routes`. Then `git mv` activity router + tests; index with `.js`; do not move DashboardPage; do not add dashboard to FEATURES; do **not** create an empty `client/src/features/activity/` tree

4. Run test — verify PASS:
   `npm run test:feature-modules`
   Expected: PASS
   Also run: `npm run check:feature-modules` and `npm run test --workspace=server -- src/modules/activity` and `npm run test --workspace=client -- src/pages/ActivityPage.test.tsx`

5. Refactor while green (bounded):
   - Do not split fat files; revert format hunks
   - Re-run: `npm run test:feature-modules`

6. Commit:
   `git commit -m "refactor(activity): relocate activity into server module"`
   PR: `refs #131`

## REFERENCES LOADED
docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md — Dashboard stays in pages/; activity is a FEATURES name
server/src/routes/activity.ts — leftover product router

## WHY THIS APPROACH
Justification: Activity client surface is the page orchestrator; server router is the product leftover.
Complexity: lightweight

## SANDWICH CONTEXT
[CRITICAL: Do not move ActivityPage or DashboardPage into features/; do not add dashboard to FEATURES; refs #131 only]
You are implementing T16 activity relocate for #131 relocation close.
Spec: docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
Design decision: Option A
Files in scope: listed in OBJECTIVE
Test framework: node:test + Vitest workspace-scoped
Available after: T15
Architecture rule: routes.ts imports modules/activity index only
[RESTATE: Do not move ActivityPage or DashboardPage into features/; do not add dashboard to FEATURES; refs #131 only]

## DELIVERABLE
[derived] Given leftover activity router and ActivityPage in pages/, When the router git-mvs into modules/activity, Then guards pass, test file count is not down, and DashboardPage remains under pages/

All tests PASS. Commit exists with message matching `refactor(activity): relocate activity into server module`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Cycle Map modules/activity home
  - Dashboard still in pages/
  - PR `refs #131`

Must-not-have:
  - New FEATURES name `dashboard`
  - `closes #131` (auth packet remains)
  - Empty client features/activity tree without production files

Rollback note:
  - Revert the whole activity packet

## STOP CONDITIONS
Done when: Cycle Map and activity tests pass
Uncertain when: ActivityPage imports leftover helpers that belong in features/activity
Escalate when: implementer is asked to relocate DashboardPage

---

### Task 17: Relocate auth module and close #131 [depends: T16]

## OBJECTIVE
`git mv` leftover auth **product** files (`oauth-bridge.ts`, `routes/oauth.ts` + tests) into `server/src/modules/auth/` with public `index.ts`. Server `auth.ts` stays kernel. Auth pages already live under `pages/` from T3. After close bar is met on this branch vs `main`, this PR may `closes #131`. Do not close #115 or #121. Tracker stubs remain. `LINE_BUDGET_MAX` stays 300.

Files:
- Create: `server/src/modules/auth/index.ts`, `server/src/modules/auth/oauth-bridge.ts`, `server/src/modules/auth/oauth.ts` + colocated oauth tests
- Modify: `server/src/index.ts`, `scripts/feature-modules/git-diff.test.mjs`
- Test: `scripts/feature-modules/git-diff.test.mjs`

Steps:
1. Write failing test for: Final close
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit

   Test intent:
   Given oauth leftovers live under `server/src/oauth-bridge.ts` and `server/src/routes/oauth.ts` and prior FEATURES packets are already on this branch’s ancestry
   When Cycle Map is evaluated
   Then:
   - `server/src/modules/auth/index.ts` exists
   - leftover `server/src/oauth-bridge.ts` and `server/src/routes/oauth.ts` are gone
   - `server/src/auth.ts` still exists (kernel entry)
   - `client/src/pages/DashboardPage.tsx` still exists
   - tracker stub paths under `client/src/components/tracker/` still exist
   - `LINE_BUDGET_MAX` is still 300
   - every FEATURES name has `modules/<name>/index.ts` and/or `features/<name>/index.ts` as applicable: tracker already; workspaces and activity are **server-module-only** (client indexes must not be required); others from T4–T16

   Exercise through:
   - Cycle Map `existsSync` assertions

   Test doubles:
   - mock/fake: none
   - do NOT mock: Cycle Map

   Expected RED:
   - `server/src/modules/auth/index.ts` does not exist today (and/or remaining FEATURES homes missing until this branch contains T4–T16 ancestry)

2. Run test — verify FAIL:
   `npm run test:feature-modules`
   Expected failure: missing `server/src/modules/auth/index.ts`

3. Implement minimal code to satisfy the test:
   File: paths in OBJECTIVE
   Implement: `git mv` oauth leftovers; index with `.js`; `index.ts` hub imports modules/auth index; comment #131 with remaining documented orchestrators (pages, tracker stubs, kernel work-item tests under routes/, Dashboard)

4. Run test — verify PASS:
   `npm run test:feature-modules`
   Expected: PASS
   Also run: `make db-up` (or confirm Postgres is already up). If `DATABASE_URL` is empty, export the local value from `server/.env.example` (`postgres://camel:camel@localhost:55432/camel_kanban`) so `make check` runs `check:key-collisions` instead of skipping it (`make db-up` does not export `DATABASE_URL`). Then `npm run check:feature-modules` and `make check` and `npm run test` from repo root
   Confirm test **file** count is not lower than `origin/main`:
   `git ls-tree -r --name-only origin/main | grep -E '\.(test|spec)\.(ts|tsx|mjs|js)$' | wc -l`
   `git ls-files | grep -E '\.(test|spec)\.(ts|tsx|mjs|js)$' | wc -l`
   HEAD count must be greater than or equal to the `origin/main` count

5. Refactor while green (bounded):
   - Do not split fat files; revert format hunks
   - Re-run: `npm run test:feature-modules`

6. Commit:
   `git commit -m "refactor(auth): relocate oauth into auth module"`
   PR: `closes #131` only if the close bar in the spec is met on this branch; never `closes #115` or `closes #121`

## REFERENCES LOADED
docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md — rules: Close #131 only when complete; Stubs and 300 ceiling; Final close GWT
server/src/auth.ts — kernel auth entry must stay
server/src/oauth-bridge.ts — product leftover

## WHY THIS APPROACH
Justification: Last FEATURES name; only this packet may close #131, and only after chrome + all other names are already on the branch ancestry.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: closes #131 only if every FEATURES name and chrome/cross-cutting extracts are already on this branch; never split god files; never delete tracker stubs; LINE_BUDGET_MAX stays 300]
You are implementing T17 auth relocate + close for #131 relocation close.
Spec: docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
Design decision: Option A
Files in scope: listed in OBJECTIVE
Test framework: node:test + Vitest + `make check`
Available after: T16
Architecture rule: `auth.ts` kernel entry stays; oauth product moves to modules/auth
[RESTATE: closes #131 only if every FEATURES name and chrome/cross-cutting extracts are already on this branch; never split god files; never delete tracker stubs; LINE_BUDGET_MAX stays 300]

## DELIVERABLE
Given chrome and cross-cutting files are in kernel dirs and every FEATURES name has been relocated on main and pages and tracker stubs remain as documented orchestrators, When the last remaining FEATURES packet is merged, Then that PR may use closes #131 and test file count is not reduced and DashboardPage.tsx still lives under client/src/pages/

[must-not] Given only a subset of FEATURES relocated, When a PR uses closes #131, Then that is invalid

All tests PASS. Commit exists with message matching `refactor(auth): relocate oauth into auth module`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Cycle Map auth module home + oauth leftover absences
  - Full `npm run test` green
  - `make check` green with `DATABASE_URL` set (key-collision actually ran, not skipped)
  - Test file count not reduced vs origin/main (exact `git ls-tree` / `git ls-files` commands in Step 4)
  - Tracker stubs still present
  - LINE_BUDGET_MAX still 300
  - Issue comment listing documented leftovers: pages/, tracker stubs, Dashboard, kernel work-item tests under routes/, presence.ts if still kernel

Must-not-have:
  - `closes #115` or `closes #121`
  - Deleting tracker stubs
  - Moving Dashboard into features/
  - Raising 300 to 500
  - God-file splits

Open question risks:
  - If close bar is not actually met (a FEATURES leftover remains), use `refs #131` and report NEEDS_CONTEXT instead of closes

Rollback note:
  - Revert this PR; issue #131 stays open if close bar was not met

## STOP CONDITIONS
Done when: close bar met, full test suite green, PR uses closes #131
Uncertain when: any mapped product leftover still sits in a forbidden type-folder
Escalate when: someone asks to close #131 with remaining FEATURES leftovers

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|------------------|
| T1 | Extract client kernel chrome | prereq | deep | Cycle Map shared chrome homes; BoardContext stays |
| T2 | Extract server card-assignees/response | T1 | standard | Cycle Map lib homes |
| T3 | Move auth screens into pages | T2 | lightweight | Cycle Map pages/AuthPage |
| T4 | Relocate my-work | T3 | standard | features/my-work + modules/my-work; page stays |
| T5 | Relocate focus wave-1 | T4 | standard | Timer/duration/guards + modules/focus; FocusEntryButton + FocusSessionContext stay leftover |
| T6 | Relocate client chat | T5 | standard | client/src/chat/ gone; server chat leftover; ChatPage stays |
| T7 | Relocate agent wave-1 | T6 | standard | modules/agent tools/service; llm cluster leftover; leftover server chat retargets agent index |
| T8 | Relocate server chat | T7 | standard | modules/chat; leftover llm.ts retargets chat index |
| T9 | Relocate board wave-1 | T8 | deep | board indexes; mutation allowlist; leftover ContextPanel still exists |
| T10 | Relocate focus wave-2 | T9 | lightweight | FocusSessionContext + FocusEntryButton into features/focus |
| T11 | Relocate board wave-2 | T10 | lightweight | ContextPanel into features/board |
| T12 | Relocate agent wave-2 | T11 | standard | AgentCardDetail + useAgentBoard + llm cluster |
| T13 | Relocate settings | T12 | standard | features/settings + modules/settings |
| T14 | Relocate workspaces | T13 | standard | modules/workspaces; WorkspaceContext stays shared |
| T15 | Relocate notifications | T14 | standard | modules/notifications; InboxPage stays |
| T16 | Relocate activity | T15 | lightweight | modules/activity; Dashboard stays |
| T17 | Relocate auth + close #131 | T16 | standard | modules/auth; closes #131 only if close bar met |

Phase A audit after T3. Phase B audit after T11 (board complete). Phase C audit after T17 (issue close).
