# Task T1 — Map data, git-diff helper, CLI stub, shared kernel folder

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
