# Task T5 — Relocate focus wave-1 (no leftover context importers)

**Phase:** 2
**Depends:** T4
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
