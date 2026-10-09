# Task T1 — Extract client kernel chrome and cross-cutting files

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
