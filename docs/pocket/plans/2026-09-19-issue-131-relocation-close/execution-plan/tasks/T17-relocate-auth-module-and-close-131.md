# Task T17 — Relocate auth module and close #131

**Phase:** 5
**Depends:** T16
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
