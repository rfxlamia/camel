# Task T3 — Move auth screens into pages

**Phase:** 1
**Depends:** T2
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
