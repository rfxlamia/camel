# Task T4 — Public API and one-way import walls

**Phase:** 1
**Depends:** T2
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
