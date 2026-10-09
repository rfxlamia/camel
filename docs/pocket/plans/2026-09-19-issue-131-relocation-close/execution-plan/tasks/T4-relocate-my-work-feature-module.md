# Task T4 — Relocate my-work feature module

**Phase:** 2
**Depends:** T3
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
