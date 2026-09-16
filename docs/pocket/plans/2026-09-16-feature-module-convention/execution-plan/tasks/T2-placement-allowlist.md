# Task T2 — Placement allowlist

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 2: Placement allowlist [depends: T1]

## OBJECTIVE
Enforce new-file placement: allowed module/kernel prefixes pass; type-folders, legacy feature trees, src-root siblings, unmapped `modules/<unknown>/`, and new tests in forbidden trees fail with a rule id and path.

Files:
- Create: `scripts/feature-modules/placement.mjs`
- Create: `scripts/feature-modules/placement.test.mjs`
- Modify: `scripts/check-feature-modules.mjs`

Steps:
1. Write failing test for: allowed new board module file
   Test file: `scripts/feature-modules/placement.test.mjs`
   Level: unit

   Test intent:
   Given board is on the map and the file is classified `new`
   When placement is checked for `server/src/modules/board/cards-update.ts`
   Then:
   - no placement violation is returned

   Exercise through:
   - exported `checkPlacement({ path, status, map })` (or equivalent)

   Test doubles:
   - mock/fake: git (inject `status: "new"`)
   - do NOT mock: placement rules or map data

   Expected RED:
   - `placement.mjs` missing or always returns []

2. Run test — verify FAIL:
   `node --test scripts/feature-modules/placement.test.mjs`
   Expected failure: module not found or assertion on empty vs expected pass

3. Implement minimal code to satisfy the test:
   File: `scripts/feature-modules/placement.mjs`
   Implement: allow `server/src/modules/<mapped>/` and `client/src/features/<mapped>/`.
   Wire `scripts/check-feature-modules.mjs` to run placement on git-classified new files.

4. Run test — verify PASS:
   `node --test scripts/feature-modules/placement.test.mjs`
   Expected: PASS

Additional TDD cycles (same test file, same command; add one test per cycle before implementing that branch):

Cycle A — kernel allow:
1. Test intent: Given `new` `client/src/shared/taxonomy/sortVocab.ts` or `server/src/lib/attachment-foo.ts`, When checked, Then no placement violation
2. `node --test scripts/feature-modules/placement.test.mjs` FAIL then implement then PASS
   Expected RED: kernel prefixes not in allow list yet

Cycle B — forbidden type-folders:
1. Test intent: Given `new` files `server/src/routes/cards-update.ts`, `client/src/pages/ReportsPage.tsx`, `client/src/lib/foo.ts`, `server/src/agent/tools/newTool.ts`, `client/src/apiClient.ts`, When checked, Then each yields a placement violation with rule id and path
2. Run same command. Expected RED: those paths currently pass
3. Implement forbidden prefixes + src-root sibling rule (existing root files are not `new`)
4. PASS

Cycle C — unmapped feature:
1. Test intent: Given `new` `server/src/modules/billing/x.ts` and billing not in map, When checked, Then placement failure
2. FAIL then implement mapped-feature-name check then PASS

Cycle D — tests:
1. Test intent: Given `new` `server/src/routes/cards.write.test.ts` or `server/src/__tests__/foo.test.ts`, When checked, Then placement failure; Given `new` `server/src/modules/board/cards-update.test.ts`, When checked, Then pass
   Expected RED: test-file paths not classified yet
2. FAIL then implement then PASS

Cycle E — CLI exit 1 for placement:
1. Test intent: Given a temp git repo with `--root` containing a new `server/src/routes/cards-update.ts`, When `node scripts/check-feature-modules.mjs --root <dir> --base-ref <base>` runs, Then exit 1 and stderr includes the placement rule id and path
   Level: integration
   Exercise through: the CLI (do not mock placement.mjs)
   Test doubles: none for git — temp `git init` as in T1 Cycle Git
   Expected RED: CLI still exits 0 because placement is not wired or violations are dropped
2. `node --test scripts/feature-modules/placement.test.mjs` FAIL then wire dispatcher then PASS

5. Refactor while green (bounded):
   - Rule of three: same logic appears 3+ times in the files in scope → extract a named, domain-scoped helper — never a generic `utils.ts`
   - A modified file crosses ~300 lines, or a function exceeds ~50 lines → split/extract
   - Refactor only within task-scope files plus helper files declared in the file map
   - Re-run test: `node --test scripts/feature-modules/placement.test.mjs` — must stay PASS
   - The auditor judges the refactor heuristics from the diff; no implementer self-report is required or accepted. A diff violating none of the thresholds proceeds to commit

6. Commit:
   `git add scripts/feature-modules/placement.mjs scripts/feature-modules/placement.test.mjs scripts/check-feature-modules.mjs`
   `git commit -m "feat(architecture): reject new files outside feature-module allowlist"`

## REFERENCES LOADED
docs/pocket/spec/2026-09-16-feature-module-convention/feature-module-convention.md — Rule Placement allowlist + Tests GWT
scripts/check-work-item-mutation-routing.mjs — violation line format `path: detail`
scripts/feature-modules/map.mjs — (created by T1) prefixes and feature names

## WHY THIS APPROACH
Justification: Placement is independently shippable CI value before 300/import rules exist.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Placement applies only to new .ts/.tsx under client/src and server/src — do not fail docs/ or scripts/.]
You are implementing placement allowlist for Feature-module directory convention.
Spec: docs/pocket/spec/2026-09-16-feature-module-convention/feature-module-convention.md
Design decision: Option A — single Node guard.
Files in scope: scripts/feature-modules/placement.mjs, scripts/feature-modules/placement.test.mjs, scripts/check-feature-modules.mjs — no other files
Test framework: Node 22 `node --test`
Available after: T1 map + git-diff + CLI stub
Architecture rule: Forbidden trees include routes/, components/, pages/, hooks/, context/, client/src/lib/, server/src/{agent,chat,notifications}/, client/src/chat/, server/src/__tests__/, new src-root siblings.
[RESTATE: Placement applies only to new .ts/.tsx under client/src and server/src — do not fail docs/ or scripts/.]

## DELIVERABLE
Verification — task is DONE when all pass:

Given board on the map and status new, When checking server/src/modules/board/cards-update.ts, Then no placement violation
Given shared/ or server/src/lib new kernel file, When checked, Then no placement violation
Given new file in routes/, pages/, client/src/lib/, server/src/agent/, or client/src/apiClient.ts, When checked, Then placement failure with rule id and path
Given new server/src/modules/billing/x.ts, When billing is not on the map, Then placement failure
Given new server/src/routes/cards.write.test.ts or server/src/__tests__/foo.test.ts, When checked, Then placement failure
Given new server/src/modules/board/cards-update.test.ts, When checked, Then pass
[must-not] Given an existing src-root file classified modified (not new), When placement runs, Then it must NOT fail as a src-root sibling

All tests PASS. Commit exists with message matching `feat(architecture): reject new files outside feature-module allowlist`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Violation messages include rule id and path
  - Tests written BEFORE implementation (TDD — not after)
  - Rule of three enforced — no logic left duplicated 3+ times in the files in scope (enforcement verified by the auditor from the diff, not asserted by the implementer)
  - Commit message follows conventional commits format

Must-not-have:
  - Scanning camel-lottie or scripts/ as feature trees
  - Skipping the failing test step
  - Modifications to files outside the listed scope
  - Changing HTTP/schema/workItemMutations

Open question risks:
  - Stacked PR vs origin/main → new files classified using git-diff helper from T1; if merge-base wrong, report NEEDS_CONTEXT

Rollback note:
  - Revert this commit; stub CLI from T1 still exits 0

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: existing repo files would fail placement on a clean tree (they must be grandfathered as not `new`)
Escalate when: implementing placement requires editing server/src/routes or client pages
