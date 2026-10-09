# Task T14 — Relocate workspaces feature module

**Phase:** 5
**Depends:** T13
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
