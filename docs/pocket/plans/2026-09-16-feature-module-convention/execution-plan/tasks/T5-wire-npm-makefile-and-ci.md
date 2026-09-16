# Task T5 — Wire npm, Makefile, and CI

**Phase:** 1
**Depends:** T3, T4
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 5: Wire npm, Makefile, and CI [depends: T3, T4] [test-risk]

## OBJECTIVE
Expose `npm run check:feature-modules` and `npm run test:feature-modules`, run both from `make check` and CI beside mutation-routing, and confirm the live guard exits 0 on the convention-PR tree.

Files:
- Modify: `package.json`
- Modify: `Makefile`
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/check-feature-modules.mjs`
- Create: `scripts/feature-modules/wiring.test.mjs`

Steps:
1. Write failing test for: package.json declares the guard scripts
   Test file: `scripts/feature-modules/wiring.test.mjs`
   Level: unit

   Test intent:
   Given repository `package.json`
   When the wiring test reads `scripts`
   Then:
   - `check:feature-modules` equals `node scripts/check-feature-modules.mjs`
   - `test:feature-modules` runs `node --test scripts/feature-modules/*.test.mjs` (or equivalent explicit file list)
   - the root `test` script includes `test:feature-modules` after the two workspace test commands

   Exercise through:
   - reading `package.json` on disk (no HTTP)

   Test doubles:
   - none
   - do NOT mock: package.json

   Expected RED:
   - scripts keys are missing

2. Run test — verify FAIL:
   `node --test scripts/feature-modules/wiring.test.mjs`
   Expected failure: assertion on missing `check:feature-modules`

3. Implement minimal code to satisfy the test:
   File: `package.json`
   Implement: add the two scripts; append `test:feature-modules` to the existing root `test` script (`A && B && C`) so `npm test` from repo root runs them.
   Do not edit Makefile or ci.yml in this cycle.

4. Run test — verify PASS:
   `node --test scripts/feature-modules/wiring.test.mjs`
   Expected: PASS

Cycle A — live guard on current tree:
1. Test intent: Given the convention PR tree, When `node scripts/check-feature-modules.mjs` runs, Then exit code 0 AND stdout reports a non-zero scanned-file or rules-evaluated count (so a dispatcher that scans nothing cannot pass)
   Level: integration
   Exercise through: spawning the CLI (do not mock placement/imports/line-budget)
   Test doubles: none
   Expected RED: stdout has no scan count, or count is 0
2. Run test — verify FAIL:
   `node --test scripts/feature-modules/wiring.test.mjs`
   Expected failure: missing scan count
3. Implement scan-count logging on the CLI
4. Run — verify PASS:
   `node scripts/check-feature-modules.mjs` — expected exit 0 with scan count
   `node --test scripts/feature-modules/wiring.test.mjs` — expected PASS

Cycle B — Makefile and CI invoke the guard:
1. Write failing test for: check target and CI run the new script beside mutation-routing
   Test file: `scripts/feature-modules/wiring.test.mjs`
   Level: unit
   Test intent:
   Given `Makefile` and `.github/workflows/ci.yml`
   When the wiring test reads both files
   Then:
   - Makefile `check` runs `check:feature-modules` and still runs `check:mutation-routing`
   - ci.yml primary job runs `npm run check:feature-modules` and still runs `npm run check:mutation-routing`
   - the checkout step sets `fetch-depth: 0` (or an explicit fetch of origin/main) so merge-base exists on PRs
   Exercise through: reading those two files on disk
   Test doubles: none
   Expected RED: neither file mentions `check:feature-modules` yet
2. Run test — verify FAIL:
   `node --test scripts/feature-modules/wiring.test.mjs`
   Expected failure: assertion that Makefile/CI lack `check:feature-modules`
3. Implement Makefile + ci.yml edits
4. Run test — verify PASS:
   `node --test scripts/feature-modules/wiring.test.mjs`

Cycle C — CLI fail path (cross-unit):
1. Write failing test for: the dispatcher exits 1 when any rule reports a violation
   Test file: `scripts/feature-modules/wiring.test.mjs`
   Level: integration
   Test intent:
   Given injected file lists/sources such that (a) a new `server/src/routes/cards-update.ts` exists, (b) a new 301-line `server/src/modules/board/too-long.ts` exists, and (c) a file imports `../modules/board/cards-update.js` rather than index
   When `node scripts/check-feature-modules.mjs --root <fixtureDir> --base-ref <fixtureBase>` is spawned against a temp directory that was `git init`'d, base-committed, then given the violating files (real git binary; same protocol as T1 Cycle Git — do not mock the three rule modules)
   Then:
   - process exit code is 1
   - stderr contains a placement rule id and path
   - stderr contains a 300-line rule id, path, and line count
   - stderr contains a deep-import rule id, path, and specifier
   Exercise through: the CLI entry point `scripts/check-feature-modules.mjs`
   Test doubles:
   - none — real git in a temp repo; do not hit origin network
   - do NOT mock: placement.mjs, line-budget.mjs, imports.mjs, or the dispatcher
   Expected RED: dispatcher ignores rule-module return values and still exits 0, or messages omit rule ids
2. Run test — verify FAIL:
   `node --test scripts/feature-modules/wiring.test.mjs`
   Expected failure: exit 0 or missing rule ids in stderr
3. Implement dispatcher aggregation + exit 1 + message format in `scripts/check-feature-modules.mjs` if still missing
4. Run test — verify PASS:
   `node --test scripts/feature-modules/wiring.test.mjs`

5. Refactor while green (bounded):
   - Rule of three: same logic appears 3+ times in the files in scope → extract a named, domain-scoped helper — never a generic `utils.ts`
   - A modified file crosses ~300 lines, or a function exceeds ~50 lines → split/extract
   - Refactor only within task-scope files plus helper files declared in the file map
   - Re-run test: `node --test scripts/feature-modules/wiring.test.mjs` — must stay PASS
   - The auditor judges the refactor heuristics from the diff; no implementer self-report is required or accepted. A diff violating none of the thresholds proceeds to commit

6. Commit:
   `git add package.json Makefile .github/workflows/ci.yml scripts/feature-modules/wiring.test.mjs scripts/check-feature-modules.mjs`
   `git commit -m "chore(architecture): run feature-module guard in check and CI"`

## REFERENCES LOADED
docs/pocket/spec/2026-09-16-feature-module-convention/feature-module-convention.md — Rule Docs + wiring GWT (CI half)
Makefile — `check` runs lint + check:mutation-routing
.github/workflows/ci.yml — primary job `npm run check:mutation-routing` then lint/typecheck/test
package.json — `test` is workspace A && B; appending a third command is required so root `npm test` does not skip script tests

## WHY THIS APPROACH
Justification: Wiring is a separately verifiable contract (make check / CI) after rules exist.
Complexity: lightweight

## SANDWICH CONTEXT
[CRITICAL: Do not remove check:mutation-routing; add the new guard beside it.]
You are implementing CI wiring for Feature-module directory convention.
Spec: docs/pocket/spec/2026-09-16-feature-module-convention/feature-module-convention.md
Design decision: Option A — same CI pattern as mutation-routing.
Files in scope: package.json, Makefile, .github/workflows/ci.yml, scripts/feature-modules/wiring.test.mjs, scripts/check-feature-modules.mjs — no other files
Test framework: Node 22 `node --test`
Available after: T3 and T4
Architecture rule: No new npm packages; Node 22 is already the engine.
[RESTATE: Do not remove check:mutation-routing; add the new guard beside it.]

## DELIVERABLE
Verification — task is DONE when all pass:

Given package.json, When read, Then check:feature-modules and test:feature-modules exist
Given make check / CI primary job, When inspected, Then they invoke check:feature-modules beside mutation-routing
Given the convention-PR tree, When node scripts/check-feature-modules.mjs runs, Then exit 0
[derived] Given npm test at repo root, When run, Then feature-module unit tests execute (not only workspace vitest)

All tests PASS. Commit exists with message matching `chore(architecture): run feature-module guard in check and CI`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Root `npm test` includes script tests (workspace-only `A && B` is a known footgun)
  - Tests written BEFORE implementation (TDD — not after)
  - Rule of three enforced — no logic left duplicated 3+ times in the files in scope (enforcement verified by the auditor from the diff, not asserted by the implementer)
  - Commit message follows conventional commits format

Must-not-have:
  - Disabling mutation-routing or key-collision checks
  - Skipping the failing test step
  - Modifications to files outside the listed scope

Open question risks:
  - none beyond T1 merge-base (live CLI vs origin/main in CI checkout — GitHub Actions checkout of PR should have merge-base)

Rollback note:
  - Revert this commit; local `node scripts/check-feature-modules.mjs` still works

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: CI checkout depth hides origin/main
Escalate when: live guard fails on untouched god files (would mean T3 treated them as touched)
