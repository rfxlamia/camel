# Task T10 — Relocate focus wave-2 (BoardContext consumers)

**Phase:** 4
**Depends:** T9
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
