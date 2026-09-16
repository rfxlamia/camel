# EXECUTION PLAN — Feature-module directory convention

**Date:** 2026-09-16
**Spec:** docs/pocket/spec/2026-09-16-feature-module-convention/feature-module-convention.md
**GitHub issue:** #129
**Status:** draft
**Total tasks:** 6

---

## Execution Overview

### Recommended Order
```
T1 → T2 → T3, T4 (parallel) → T5
T6 parallel with T2–T5 after T1
```

> Dependency order above is **recommended** — pocket skill enforces actual
> parallelism and sequencing based on its routing logic.

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T2, T6 | T1 completes |
| Group B | T3, T4 | T2 completes |
| Group C | T5 | T3 and T4 complete |

### Constraints Reminder
**Architecture:** Convention PR may touch docs, `scripts/`, `package.json`, `Makefile`, CI, `client/src/shared/`. Must not change runtime handlers, schema, SSE, `workItemMutations` routing, BoardContext behavior, or HTTP contracts. Guard is a Node script (Option A), NodeNext-aware, no new npm deps, no path aliases. Scan only `client/src` and `server/src` (plus ignore `camel-lottie/`).
**Out-of-scope:** Big-bang git-mv; forcing #115/#121/#33 in this PR; Nest/Nx/ESLint; dual-table write-routing changes.
**Assumptions at risk:** Diff base `origin/main` merge-base; raw LF line counts; `.ts`/`.tsx` only; `workItemMutations.ts` on shrinking kernel allowlist.
**Sequencing:** T3 and T4 must not both rewrite `scripts/check-feature-modules.mjs` wholesale — they plug named modules into the dispatcher T1/T2 create.

### File Structure Map

```
Rule: Placement allowlist + tests
  Create: scripts/feature-modules/map.mjs                    (created by: T1)
  Create: scripts/feature-modules/git-diff.mjs               (created by: T1)
  Create: scripts/feature-modules/git-diff.test.mjs          (created by: T1)
  Create: scripts/check-feature-modules.mjs                  (created by: T1)
  Create: client/src/shared/index.ts                         (created by: T1)
  Create: scripts/feature-modules/placement.mjs              (created by: T2)
  Test:   scripts/feature-modules/placement.test.mjs         (created by: T2)
  Modify: scripts/check-feature-modules.mjs                  (T2)

Rule: 300-on-touch
  Create: scripts/feature-modules/line-budget.mjs            (created by: T3)
  Test:   scripts/feature-modules/line-budget.test.mjs       (created by: T3)
  Modify: scripts/check-feature-modules.mjs                  (T3)

Rule: Public API / one-way imports
  Create: scripts/feature-modules/imports.mjs                (created by: T4)
  Test:   scripts/feature-modules/imports.test.mjs           (created by: T4)
  Modify: scripts/check-feature-modules.mjs                  (T4)
  Modify: scripts/feature-modules/map.mjs                    (T4 — shrinking allowlist data if not complete in T1)

Rule: Docs + wiring
  Create: docs/pocket/adr/2026-09-16-feature-module-convention.md  (created by: T6)
  Create: scripts/feature-modules/wiring.test.mjs            (created by: T5)
  Modify: scripts/check-feature-modules.mjs                  (T5 — dispatcher exit 1 + messages)
  Modify: AGENTS.md                                          (T6)
  Modify: CLAUDE.md                                          (T6)
  Modify: package.json                                       (T5)
  Modify: Makefile                                           (T5)
  Modify: .github/workflows/ci.yml                           (T5)
```

---

## Pocket Packets

---

### Task 1: Map data, git-diff helper, CLI stub, shared kernel folder [prereq] [test-risk]

## OBJECTIVE
Create the single-source feature map, a testable git-diff helper (merge-base vs `origin/main`, rename detection inputs), a CLI stub that loads the map and exits 0 on the current tree, and `client/src/shared/index.ts` as the day-1 kernel home.

Files:
- Create: `scripts/feature-modules/map.mjs`
- Create: `scripts/feature-modules/git-diff.mjs`
- Create: `scripts/feature-modules/git-diff.test.mjs`
- Create: `scripts/check-feature-modules.mjs`
- Create: `client/src/shared/index.ts`

Steps:
1. Write failing test for: git-diff helper classifies new vs modified vs rename from injected git output
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit

   Test intent:
   Given a fake `git diff --name-status` / `--find-renames` payload vs merge-base
   When the helper parses it
   Then:
   - Added `.ts` paths are `new`
   - Modified paths are `modified`
   - Renames with identical content are `rename` (not `new`)
   - Copy (`C`) with unchanged content is `copied`
   - Deletes (`D`) are listed as deleted and not fed to line-budget/imports as live files
   - Rename similarity below 100 is rename-with-edit (not `new`)
   - Quoted paths with spaces are unquoted
   - `camel-lottie/` paths are ignored
   - Non-`.ts`/`.tsx` paths are omitted from source-file lists
   - Default merge-base ref is `origin/main` and an override ref is accepted

   Exercise through:
   - Exported parse function on `scripts/feature-modules/git-diff.mjs` (do not spawn real git in this test)

   Test doubles:
   - mock/fake: git CLI (pass fixture strings; do not call `git`)
   - do NOT mock: the parser under test

   Expected RED:
   - Module `scripts/feature-modules/git-diff.mjs` does not exist

2. Run test — verify FAIL:
   `node --test scripts/feature-modules/git-diff.test.mjs`
   Expected failure: cannot find module `./git-diff.mjs` (or ERR_MODULE_NOT_FOUND)

3. Implement minimal code to satisfy the test:
   File: `scripts/feature-modules/git-diff.mjs`
   Implement: parse name-status output into `{ new, modified, renamed, copied, deleted }` plus ignore rules; default merge-base `origin/main` with override argument. Also parse `C` copy, `D` delete, `R0xx` similarity below 100 as rename-with-edit, and quoted paths.
   Do not create `map.mjs`, the CLI, or `client/src/shared/index.ts` in this cycle.

4. Run test — verify PASS:
   `node --test scripts/feature-modules/git-diff.test.mjs`
   Expected: PASS

Cycle Map — map data driven by a failing assertion:
1. Write failing test for: map lists locked features and kernel-in-waiting paths
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit
   Test intent:
   Given `scripts/feature-modules/map.mjs`
   When imported
   Then:
   - it lists board, tracker, my-work, agent, chat, focus, settings, workspaces, notifications, activity, auth
   - `client/src/lib/workItemMutations.ts` is on the kernel-in-waiting allowlist
   - scan roots are `client/src` and `server/src`
   Exercise through: the map module exports
   Test doubles: none
   Expected RED: `map.mjs` does not exist
2. Run test — verify FAIL:
   `node --test scripts/feature-modules/git-diff.test.mjs`
   Expected failure: ERR_MODULE_NOT_FOUND for `./map.mjs`
3. Implement `scripts/feature-modules/map.mjs` with the locked lists.
4. Run test — verify PASS:
   `node --test scripts/feature-modules/git-diff.test.mjs`

Cycle A — stub CLI (integration):
1. Write failing test for: stub CLI pass line and argv
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: integration
   Test intent:
   Given `scripts/check-feature-modules.mjs` is not present
   When the test spawns `node scripts/check-feature-modules.mjs --base-ref origin/main --root .`
   Then:
   - process exit code is 0
   - stdout includes `Feature module check passed.`
   - stdout (or a `--print-config` line) echoes the resolved base-ref and root so ignored flags cannot go green
   When spawned with `--base-ref` pointing at a missing ref and without a fixture `--root`
   Then: exit 1 with a rule id (fail-loud; do not treat empty diff as pass)
   Exercise through: the CLI entry point
   Test doubles: none for the happy stub spawn; do not hit the network
   Expected RED: spawn ENOENT because `scripts/check-feature-modules.mjs` does not exist yet
2. Run test — verify FAIL:
   `node --test scripts/feature-modules/git-diff.test.mjs`
   Expected failure: spawn ENOENT for `scripts/check-feature-modules.mjs`
3. Implement `scripts/check-feature-modules.mjs`: load the map, accept `--base-ref` (default `origin/main`) and `--root`, echo resolved config, print pass line, exit 0 when there are no rule modules yet; missing merge-base is fail-loud unless `--root` is a fixture tree.
4. Run test — verify PASS:
   `node --test scripts/feature-modules/git-diff.test.mjs`

Cycle Git — real git binary:
1. Write failing test for: helper/CLI talk to a real git repo
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: integration
   Test intent:
   Given a temp directory `git init`, one base commit, then add/modify/rename/copy/delete `.ts` files
   When the production git invocation runs against that repo (`git merge-base`, `git diff --name-status --find-renames`)
   Then:
   - statuses match the working tree
   - a missing base ref fails loud
   - empty diff (HEAD == base) reports zero source files, not a silent skip of tree-level rules
   Exercise through: git-diff helper's spawn path (do not pass fixture strings in this cycle)
   Test doubles: none — use the real `git` binary on a temp repo; do not use origin network
   Expected RED: helper has no spawn path, only the string parser
2. Run test — verify FAIL:
   `node --test scripts/feature-modules/git-diff.test.mjs`
   Expected failure: no git spawn implementation
3. Implement spawn + argv construction in `git-diff.mjs` / CLI
4. Run test — verify PASS:
   `node --test scripts/feature-modules/git-diff.test.mjs`

Cycle B — shared kernel file exists:
1. Write failing test for: `client/src/shared/index.ts` is present
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit
   Test intent:
   Given the convention requires a day-1 kernel home
   When the test asserts `client/src/shared/index.ts` exists on disk
   Then:
   - the path exists
   - the file is a valid empty ESM module (`export {}`)
   Exercise through: filesystem existence + file contents in `git-diff.test.mjs` (do not use client typecheck as the RED signal)
   Test doubles: none
   Expected RED: existence assertion fails because the file does not exist
2. Run test — verify FAIL:
   `node --test scripts/feature-modules/git-diff.test.mjs`
   Expected failure: assertion that `client/src/shared/index.ts` is missing
3. Implement `client/src/shared/index.ts` with `export {}`.
4. Run test — verify PASS:
   `node --test scripts/feature-modules/git-diff.test.mjs`
   Expected: PASS
   Then smoke (not RED): `npm run typecheck --workspace=client` — expected exit 0

5. Refactor while green (bounded):
   - Rule of three: same logic appears 3+ times in the files in scope → extract a named, domain-scoped helper — never a generic `utils.ts`
   - A modified file crosses ~300 lines, or a function exceeds ~50 lines → split/extract
   - Refactor only within task-scope files plus helper files declared in the file map
   - Re-run test: `node --test scripts/feature-modules/git-diff.test.mjs` — must stay PASS
   - The auditor judges the refactor heuristics from the diff; no implementer self-report is required or accepted. A diff violating none of the thresholds proceeds to commit

6. Commit:
   `git add scripts/feature-modules/map.mjs scripts/feature-modules/git-diff.mjs scripts/feature-modules/git-diff.test.mjs scripts/check-feature-modules.mjs client/src/shared/index.ts`
   `git commit -m "chore(architecture): add feature-module map and guard stub"`

## REFERENCES LOADED
docs/pocket/spec/2026-09-16-feature-module-convention/feature-module-convention.md — feature map, kernel-in-waiting list, scan roots, rename vs new, `.ts`/`.tsx` only
scripts/check-work-item-mutation-routing.mjs — CLI pattern: walk, relative POSIX paths, exit 1 + stderr, exit 0 + pass message
package.json — Node >=22, no root `node:test` yet
client/tsconfig.json — `include: ["src"]`, `noUnusedLocals`, `isolatedModules`

## WHY THIS APPROACH
Justification: Shared map + git classification must exist before placement/300/import tasks or they will fork duplicate parsers.
Complexity: lightweight

## SANDWICH CONTEXT
[CRITICAL: Do not change runtime handlers, schema, SSE, workItemMutations routing, or BoardContext.tsx.]
You are implementing the map/CLI stub for Feature-module directory convention.
Spec: docs/pocket/spec/2026-09-16-feature-module-convention/feature-module-convention.md
Design decision: Option A — single Node guard, no new npm dependencies.
Files in scope: scripts/feature-modules/map.mjs, scripts/feature-modules/git-diff.mjs, scripts/feature-modules/git-diff.test.mjs, scripts/check-feature-modules.mjs, client/src/shared/index.ts — no other files
Test framework: Node 22 `node --test` (ESM `.mjs`), not Vitest workspaces
Available after: none (prereq)
Architecture rule: Guard scans client/src + server/src only; camel-lottie ignored; no path aliases.
[RESTATE: Do not change runtime handlers, schema, SSE, workItemMutations routing, or BoardContext.tsx.]

## DELIVERABLE
Verification — task is DONE when all pass:

Given fake git name-status with an add, a modify, and a rename, When parsed, Then statuses are new/modified/rename respectively and camel-lottie plus non-ts(x) are omitted
Given no override, When the helper is constructed, Then the merge-base ref defaults to origin/main and an override is accepted
Given the stub CLI, When run against the repo, Then it exits 0, prints a pass line, and accepts --base-ref and --root
Given client/src/shared/index.ts is required, When the existence test runs before the file is created, Then it fails; after export {} is added, Then the test passes

All tests PASS. Commit exists with message matching `chore(architecture): add feature-module map and guard stub`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Map lists every locked feature and kernel allowlist prefix from the spec
  - `workItemMutations.ts` is on the kernel-in-waiting list
  - Tests written BEFORE implementation (TDD — not after)
  - Rule of three enforced — no logic left duplicated 3+ times in the files in scope (enforcement verified by the auditor from the diff, not asserted by the implementer)
  - Commit message follows conventional commits format

Must-not-have:
  - Big-bang git-mv of tracker/board/agent
  - New npm dependencies
  - Skipping the failing test step
  - Modifications to files outside the listed scope
  - Touching BoardContext.tsx

Open question risks:
  - Diff base assumed origin/main → if wrong: report NEEDS_CONTEXT (helper should accept merge-base ref as argument, default origin/main)

Rollback note:
  - Revert this commit; no data migration

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: git rename detection format differs from assumed name-status
Escalate when: task touches runtime route/service files or BoardContext.tsx

---

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

---

### Task 3: 300-line ceiling on touch [depends: T2] [test-risk]

## OBJECTIVE
Fail new source files over 300 raw lines; fail non-trivial modifications of currently oversized source files unless the result is ≤300; exempt pure git rename, whitespace/format-only, import-specifier-only, tests, generated, and untouched files.

Files:
- Create: `scripts/feature-modules/line-budget.mjs`
- Create: `scripts/feature-modules/line-budget.test.mjs`
- Modify: `scripts/check-feature-modules.mjs`

Steps:
1. Write failing test for: non-trivial edit of oversized file without shrink
   Test file: `scripts/feature-modules/line-budget.test.mjs`
   Level: unit

   Test intent:
   Given a source file whose current (merge-base) line count is 999 and the PR hunk changes a handler body
   When the line-budget checker runs
   Then:
   - it reports a 300-on-touch violation with rule id, path, and line count if the result is still >300

   Exercise through:
   - exported `checkLineBudget({ path, status, beforeText, afterText, hunks })`

   Test doubles:
   - mock/fake: git show / diff hunks (inject strings)
   - do NOT mock: line-count and touch-classification logic

   Expected RED:
   - `line-budget.mjs` does not exist

2. Run test — verify FAIL:
   `node --test scripts/feature-modules/line-budget.test.mjs`
   Expected failure: ERR_MODULE_NOT_FOUND for `./line-budget.mjs`

3. Implement minimal code to satisfy the test:
   File: `scripts/feature-modules/line-budget.mjs`
   Implement: raw newline count; non-trivial touch + after >300 → violation.
   Wire into `scripts/check-feature-modules.mjs`.

4. Run test — verify PASS:
   `node --test scripts/feature-modules/line-budget.test.mjs`
   Expected: PASS

Additional TDD cycles (same test file and command):

Cycle A — extract success:
1. Given oversized file extracted so afterText has ≤300 lines, When checked, Then no 300-on-touch violation
2. FAIL (always-fail on any oversized before) then implement then PASS

Cycle B — new file 301 lines:
1. Given status new and afterText has 301 lines, When checked, Then fail; Given new test file `*.test.ts` with 800 lines, When checked, Then 300 rule does not apply
2. FAIL then implement new-file ceiling + test exclusion then PASS

Cycle C — rename:
1. Given status rename, identical content, 521 lines, When checked, Then no 300-new-file violation; Given rename plus body edit leaving >300 lines, Then fail
2. FAIL then implement then PASS

Cycle D — non-touches:
1. Given whitespace/format-only hunks on a 492-line file, When checked, Then no 300-on-touch violation; Given import-specifier-only hunks on a 999-line file, Then no 300-on-touch violation
   Expected RED: exemptions not implemented
2. FAIL then implement exemptions then PASS

Cycle E — exemption negatives and line-count edges:
1. Given a mixed hunk that changes an import specifier AND a body line, When checked, Then it IS a touch; Given a new import plus a new call site, Then it IS a touch; Given a comment-only change, Then it IS a touch; Given afterText has exactly 300 lines, Then pass; Given 301 lines with no trailing newline, Then fail; Given `foo.generated.ts` or a path containing `/generated/`, Then 300 rule does not apply
   Expected RED: heuristic too loose or generated glob undefined
2. FAIL then implement then PASS

Cycle F — hunk producer + CLI grandfather:
1. Given a temp git repo, When the production `git show <base>:<path>` / `git diff -U0` path builds beforeText and hunks (rename uses the old path), Then checkLineBudget sees the same classification as Cycle D/E; Given BoardContext.tsx is unmodified in that repo, When the CLI runs, Then no 300 violation for it (dispatcher does not invent a touch)
   Level: integration
   Exercise through: CLI + real git (do not pass pre-built hunks in this cycle)
   Test doubles: none
   Expected RED: line-budget only accepts injected hunks; no git-show path
2. FAIL then implement then PASS

Cycle G — CLI exit 1 for 300:
1. Given a temp git repo with a new 301-line module file, When the CLI runs with `--root` / `--base-ref`, Then exit 1 and stderr includes 300 rule id, path, and line count
   Expected RED: 300 module not wired into dispatcher
2. FAIL then wire then PASS

5. Refactor while green (bounded):
   - Rule of three: same logic appears 3+ times in the files in scope → extract a named, domain-scoped helper — never a generic `utils.ts`
   - A modified file crosses ~300 lines, or a function exceeds ~50 lines → split/extract
   - Refactor only within task-scope files plus helper files declared in the file map
   - Re-run test: `node --test scripts/feature-modules/line-budget.test.mjs` — must stay PASS
   - The auditor judges the refactor heuristics from the diff; no implementer self-report is required or accepted. A diff violating none of the thresholds proceeds to commit

6. Commit:
   `git add scripts/feature-modules/line-budget.mjs scripts/feature-modules/line-budget.test.mjs scripts/check-feature-modules.mjs`
   `git commit -m "feat(architecture): enforce 300-line budget on touched source files"`

## REFERENCES LOADED
docs/pocket/spec/2026-09-16-feature-module-convention/feature-module-convention.md — Rule 300-on-touch GWT
scripts/feature-modules/git-diff.mjs — (T1) rename vs modified
scripts/check-feature-modules.mjs — dispatcher to extend

## WHY THIS APPROACH
Justification: Touch classification + git rename is the spec’s discriminating behavior; isolated module keeps T4 from rewriting it.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Convention PR must not modify BoardContext.tsx; untouched oversized files stay grandfathered.]
You are implementing the 300-line ceiling for Feature-module directory convention.
Spec: docs/pocket/spec/2026-09-16-feature-module-convention/feature-module-convention.md
Design decision: Option A — single Node guard; raw LF newline counts.
Files in scope: scripts/feature-modules/line-budget.mjs, scripts/feature-modules/line-budget.test.mjs, scripts/check-feature-modules.mjs — no other files
Test framework: Node 22 `node --test`
Available after: T2 (CLI already classifies new files)
Architecture rule: No new npm deps; do not hit a real GitHub remote; tests inject diffs.
[RESTATE: Convention PR must not modify BoardContext.tsx; untouched oversized files stay grandfathered.]

## DELIVERABLE
Verification — task is DONE when all pass:

Given a 999-line source file with a non-trivial body hunk still >300 after, When checked, Then 300-on-touch failure with rule id, path, and line count
Given extract so the leftover file is ≤300 lines, When checked, Then pass
Given status new and 301 source lines, When checked, Then fail
Given an 800-line `*.test.ts`, When checked, Then 300 rule does not apply
Given pure rename of a 521-line file (identical content), When checked, Then 300-new-file does not fail
Given rename plus body edit still >300, When checked, Then fail
Given whitespace/format-only or import-specifier-only hunks, When checked, Then 300-on-touch does not fire
Given BoardContext.tsx is not in the diff, When the guard runs, Then no 300 violation for that file
[must-not] Given only formatting on an oversized file, When checked, Then system must NOT require a split

All tests PASS. Commit exists with message matching `feat(architecture): enforce 300-line budget on touched source files`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Test files and generated files excluded from 300
  - Tests written BEFORE implementation (TDD — not after)
  - Rule of three enforced — no logic left duplicated 3+ times in the files in scope (enforcement verified by the auditor from the diff, not asserted by the implementer)
  - Commit message follows conventional commits format

Must-not-have:
  - Splitting BoardContext or cards.ts in this task
  - Skipping the failing test step
  - Modifications to files outside the listed scope
  - Calling the real `origin/main` network; use injected git metadata

Open question risks:
  - CRLF vs LF → assumed LF; if counts disagree report NEEDS_CONTEXT
  - Import-specifier-only detection too loose/strict → report NEEDS_CONTEXT if tests cannot distinguish from logic edits

Rollback note:
  - Revert this commit; placement from T2 remains

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: import-path-only heuristic cannot be made deterministic
Escalate when: implementation starts extracting production god files to go green

---

### Task 4: Public API and one-way import walls [depends: T2] [parallel: T3]

## OBJECTIVE
Forbid deep imports into feature modules, require `index.ts` when a module tree has files, allow in-module and cross-feature index imports, allow shrinking kernel-in-waiting paths, and reject `features/work-items/` as a product module.

Files:
- Create: `scripts/feature-modules/imports.mjs`
- Create: `scripts/feature-modules/imports.test.mjs`
- Modify: `scripts/check-feature-modules.mjs`
- Modify: `scripts/feature-modules/map.mjs` (only if shrinking allowlist fields are missing)

Steps:
1. Write failing test for: deep import from leftover orchestrator
   Test file: `scripts/feature-modules/imports.test.mjs`
   Level: unit

   Test intent:
   Given `server/src/routes/cards.ts` contains `import { updateCard } from "../modules/board/cards-update.js"`
   When import rules run
   Then:
   - a deep-import violation is reported with rule id, path, and the specifier

   Exercise through:
   - exported `checkImports({ filePath, source, map })`

   Test doubles:
   - mock/fake: filesystem (pass source strings)
   - do NOT mock: specifier classification

   Expected RED:
   - `imports.mjs` does not exist

2. Run test — verify FAIL:
   `node --test scripts/feature-modules/imports.test.mjs`
   Expected failure: ERR_MODULE_NOT_FOUND for `./imports.mjs`

3. Implement minimal code to satisfy the test:
   File: `scripts/feature-modules/imports.mjs`
   Implement: detect ESM import/export/import() specifiers including `import type`; flag non-index imports into `modules/<f>/` or `features/<f>/` from outside that folder.
   Wire into the CLI.

4. Run test — verify PASS:
   `node --test scripts/feature-modules/imports.test.mjs`
   Expected: PASS

Additional TDD cycles (same test file and command):

Cycle A — public API and in-module:
1. Given outside file imports `../modules/board/index.js`, When checked, Then pass; Given `modules/board/cards-update.ts` imports `./cards-repo.js`, Then pass
2. FAIL then implement then PASS

Cycle B — cross-feature:
1. Given `features/board/x.ts` imports `../activity/index.ts` (or `features/activity/index.ts`), When checked, Then pass; Given it imports `features/activity/describeEvent.ts`, Then deep-import failure
2. FAIL then implement then PASS

Cycle C — one-way vs kernel allowlist:
1. Given `modules/board/x.ts` imports `../../routes/card-response.js`, When checked, Then one-way failure; Given `features/my-work/x.tsx` imports `../../components/my-work/MyWorkList.tsx`, When checked, Then one-way failure; Given import of allowlisted `work-item-response.js` (or `helpers.js`, `tracker-item-parsers.js`, `vocabulary-response.ts`, `work-items.ts`, `client/src/lib/workItemMutations.ts`), Then pass
   Expected RED: one-way rule not implemented, so leftover feature imports currently pass
2. FAIL then implement shrinking allowlist from map then PASS

Cycle D — composition root, missing index, work-items feature:
1. Given `server/src/routes.ts` imports `./modules/board/board.routes.js`, When checked, Then fail (must use index); Given `modules/board/` has a non-index file and no `index.ts` on disk (tree-level check, not source-string only), Then fail; Given new `client/src/features/work-items/WorkItemsPage.tsx`, Then fail
   Expected RED: no directory listing for index.ts requirement
2. FAIL then implement then PASS
   Note: `import type` and `export * from './internal.js'` deep paths must fail in this cycle or Cycle A.

Cycle E — specifier forms and kernel imports:
1. Given `from "../activity"` (extensionless directory → index) from another feature, When checked, Then pass; Given `from "./cards-update"` deep without index from outside, Then fail; Given `modules/board/x.ts` imports `../../core/position.js` or `client/src/shared/index.ts`, Then pass (kernel); Given a specifier-like string only inside a comment or template literal, Then must NOT fail
   Expected RED: parser misses extensionless forms or over-fires on comments
2. FAIL then implement then PASS

Cycle F — scan scope and CLI exit 1:
1. Given a pre-existing `routes/cards.ts` in the `--root` tree that deep-imports `modules/board/cards-update.js`, When the CLI walks the tree (not diff-only for import walls), Then exit 1 with deep-import rule id; import walls apply to scanned `.ts`/`.tsx` under `--root`, not only git-added files
   Expected RED: import check is diff-only or not wired
2. FAIL then implement then PASS

5. Refactor while green (bounded):
   - Rule of three: same logic appears 3+ times in the files in scope → extract a named, domain-scoped helper — never a generic `utils.ts`
   - A modified file crosses ~300 lines, or a function exceeds ~50 lines → split/extract
   - Refactor only within task-scope files plus helper files declared in the file map
   - Re-run test: `node --test scripts/feature-modules/imports.test.mjs` — must stay PASS
   - The auditor judges the refactor heuristics from the diff; no implementer self-report is required or accepted. A diff violating none of the thresholds proceeds to commit

6. Commit:
   `git add scripts/feature-modules/imports.mjs scripts/feature-modules/imports.test.mjs scripts/check-feature-modules.mjs scripts/feature-modules/map.mjs`
   `git commit -m "feat(architecture): enforce feature-module public API imports"`

## REFERENCES LOADED
docs/pocket/spec/2026-09-16-feature-module-convention/feature-module-convention.md — Rule Public API GWT
server/src/routes.ts — composition root currently deep-imports `./routes/*.js` (legacy; do not fail existing routes/ imports until those files move — only imports into modules/features trees)
scripts/feature-modules/map.mjs — kernel-in-waiting list

## WHY THIS APPROACH
Justification: Import walls are independent of 300-on-touch (T3) and share only the CLI dispatcher and map.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Do not fail existing type-folder-to-type-folder imports (routes/cards.ts importing routes/helpers.js). Walls apply to modules/ and features/ trees plus one-way module→leftover feature files.]
You are implementing public API import walls for Feature-module directory convention.
Spec: docs/pocket/spec/2026-09-16-feature-module-convention/feature-module-convention.md
Design decision: Option A — hand-rolled NodeNext-aware specifier scan, no ESLint.
Files in scope: scripts/feature-modules/imports.mjs, scripts/feature-modules/imports.test.mjs, scripts/check-feature-modules.mjs, scripts/feature-modules/map.mjs — no other files
Test framework: Node 22 `node --test`
Available after: T2
Architecture rule: NodeNext `.js` specifiers on server; client may omit extensions — parser must accept both.
[RESTATE: Do not fail existing type-folder-to-type-folder imports (routes/cards.ts importing routes/helpers.js). Walls apply to modules/ and features/ trees plus one-way module→leftover feature files.]

## DELIVERABLE
Verification — task is DONE when all pass:

Given routes/cards.ts imports modules/board/cards-update.js, When checked, Then deep-import failure with specifier
Given it imports modules/board/index.js, When checked, Then pass
Given in-module relative import, When checked, Then pass
Given features/board imports features/activity/index.ts, When checked, Then pass
Given features/board imports features/activity/describeEvent.ts, When checked, Then deep-import failure
Given modules/board imports routes/card-response.js, When checked, Then one-way failure
Given features/my-work/x.tsx imports components/my-work/MyWorkList.tsx, When checked, Then one-way failure
Given modules/board imports allowlisted work-item-response.js, When checked, Then pass
Given routes.ts imports modules/board/board.routes.js, When checked, Then fail
Given first files in modules/board/ without index.ts, When checked, Then fail
Given client/src/features/work-items/WorkItemsPage.tsx, When checked, Then fail
[must-not] Given routes/cards.ts imports ./helpers.js, When checked, Then system must NOT report a module-wall violation

All tests PASS. Commit exists with message matching `feat(architecture): enforce feature-module public API imports`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `import type`, dynamic `import()`, and `export * from` deep paths fail
  - Tests written BEFORE implementation (TDD — not after)
  - Rule of three enforced — no logic left duplicated 3+ times in the files in scope (enforcement verified by the auditor from the diff, not asserted by the implementer)
  - Commit message follows conventional commits format

Must-not-have:
  - Requiring empty index stubs for features with no files yet (index only when the module directory has files)
  - Skipping the failing test step
  - Modifications to files outside the listed scope
  - Creating features/work-items/ as a real product module

Open question risks:
  - workItemMutations.ts allowlist → must pass when imported from features until extracted

Rollback note:
  - Revert this commit; placement + 300 remain

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: specifier parser cannot handle a real repo import form
Escalate when: task starts rewriting production import paths to go green

---

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

---

### Task 6: ADR and agent convention docs [depends: T1] [parallel: T2]

## OBJECTIVE
Document the locked convention in an ADR plus AGENTS.md and CLAUDE.md: feature map, public API, 300-on-touch, one-way imports, shrinking kernel allowlist, hotfix sequence, and pointer to the guard script as source of truth for lists.

Files:
- Create: `docs/pocket/adr/2026-09-16-feature-module-convention.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

Steps:
1. Create the ADR covering context (#129, type-folders, god files, PR #128), decision (feature modules + kernel + Option A guard), map tables, 300 rules, public API, shrinking allowlist, hotfix order (kernel extract → tracker git-mv → later splits land in modules/features), and consequences (deletable work-items adapter; BoardContext not split in this PR). Record: unmapped-feature checks use the working-tree map (same PR may add a feature); missing `origin/main` merge-base is fail-loud; generated files for the 300 rule are `*.generated.ts(x)` and paths containing `/generated/`; CI must fetch full history so merge-base exists.
2. Verify: `test -f docs/pocket/adr/2026-09-16-feature-module-convention.md` and that AGENTS.md + CLAUDE.md contain a Feature-module convention section that links the ADR and `scripts/check-feature-modules.mjs` / `scripts/feature-modules/map.mjs`. Do not duplicate the full allowlist in prose if the map file is cited as canonical; do state the behavioral rules (300, index.ts, one-way, new files in agent/ fail).
3. Commit: `git add docs/pocket/adr/2026-09-16-feature-module-convention.md AGENTS.md CLAUDE.md`
   `git commit -m "docs(architecture): record feature-module convention and CI guard"`

## REFERENCES LOADED
docs/pocket/spec/2026-09-16-feature-module-convention/feature-module-convention.md — Implementation Notes, feature map, out-of-scope
docs/pocket/adr/2026-09-board-tracker-dual-table.md — ADR tone; dual-table shim stays; work-items adapter remains kernel
AGENTS.md / CLAUDE.md — existing dual-table bullet pattern to mirror, not replace

## WHY THIS APPROACH
Justification: Docs are independently useful once the map file exists; they must not wait for CI wiring.
Complexity: lightweight

## SANDWICH CONTEXT
[CRITICAL: Do not describe work-items as a product feature; it remains a deletable kernel adapter per ADR #103.]
You are writing convention docs for Feature-module directory convention.
Spec: docs/pocket/spec/2026-09-16-feature-module-convention/feature-module-convention.md
Design decision: Option A — document the guard, do not introduce ESLint/Nx.
Files in scope: docs/pocket/adr/2026-09-16-feature-module-convention.md, AGENTS.md, CLAUDE.md — no other files
Test framework: n/a (structural)
Available after: T1 (map path exists to cite)
Architecture rule: Keep dual-table mutation-routing bullet intact; add a new bullet, do not rewrite #103 away.
[RESTATE: Do not describe work-items as a product feature; it remains a deletable kernel adapter per ADR #103.]

## DELIVERABLE
Verification — task is DONE when all pass:

[derived] Given the convention PR, When merged, Then AGENTS.md/CLAUDE.md + ADR describe the map, public API, 300 rules, hotfix sequence
[must-not] Given the ADR, When read, Then it must NOT instruct a big-bang git-mv in the convention PR
[must-not] Given AGENTS.md, When read, Then it must NOT drop the dual-table workItemMutations routing rules

QUALITY BAR: `[no-tdd — structural task]`

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Hotfix order: kernel extract, then tracker move, then later splits into modules/features
  - Pointer to map.mjs as canonical lists
  - `[no-tdd — structural task]`
  - Commit message follows conventional commits format

Must-not-have:
  - Claiming BoardContext must be split in this PR
  - Nest/Nx migration language as a required implementation
  - Modifications to files outside the listed scope

Open question risks:
  - none

Rollback note:
  - Revert this commit; guard code remains

## STOP CONDITIONS
Done when: ADR exists, AGENTS.md and CLAUDE.md updated, commit created
Uncertain when: docs and map.mjs drift — cite the map file rather than copying tables
Escalate when: docs instruct changing workItemMutations behavior
