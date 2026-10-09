# Task T11 — Relocate board wave-2 (ContextPanel)

**Phase:** 4
**Depends:** T10
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
