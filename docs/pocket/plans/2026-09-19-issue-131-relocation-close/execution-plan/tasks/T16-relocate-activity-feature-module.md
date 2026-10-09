# Task T16 — Relocate activity feature module

**Phase:** 5
**Depends:** T15
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
