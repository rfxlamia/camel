# Task T2 — Extract server kernel card-assignees and card-response

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 2: Extract server kernel card-assignees and card-response [depends: T1]

## OBJECTIVE
Move `card-assignees.ts` and `card-response.ts` (and colocated tests) into `server/src/lib/` so later `modules/my-work` and `modules/board` import kernel lib instead of leftover `routes/`.

Files:
- Create: `server/src/lib/card-assignees.ts`, `server/src/lib/card-response.ts`, plus colocated tests currently beside them under `server/src/routes/`
- Modify: `server/src/lib/work-item-response.ts`, `server/src/core/board-card-status-change.ts`, `server/src/core/board-card-status-change.test.ts`, leftover `server/src/routes/my-work*.ts` and `server/src/routes/cards.ts` / `board.ts` / `card-create.ts` specifiers only, `scripts/feature-modules/git-diff.test.mjs`, `scripts/feature-modules/imports.test.mjs`
- Test: `scripts/feature-modules/git-diff.test.mjs`

Steps:
1. Write failing test for: Module must not import leftover card-assignees
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit

   Test intent:
   Given card-assignees and card-response still live under `server/src/routes/`
   When Cycle Map is evaluated
   Then:
   - `server/src/lib/card-assignees.ts` and `server/src/lib/card-response.ts` exist
   - leftover `server/src/routes/card-assignees.ts` and `server/src/routes/card-response.ts` are gone
   - my-work and board product routers are still under `server/src/routes/` (not moved in this task)

   Exercise through:
   - Cycle Map `existsSync` assertions

   Test doubles:
   - mock/fake: none
   - do NOT mock: Cycle Map / filesystem

   Expected RED:
   - `server/src/lib/card-assignees.ts` does not exist today

2. Run test — verify FAIL:
   `npm run test:feature-modules`
   Expected failure: missing `server/src/lib/card-assignees.ts` (or card-response)

3. Implement minimal code to satisfy the test:
   File: paths in OBJECTIVE
   Implement: `git mv` to `server/src/lib/` with NodeNext `.js` specifier retargets; do not create `modules/board` or `modules/my-work` yet

4. Run test — verify PASS:
   `npm run test:feature-modules`
   Expected: PASS
   Also run: `npm run check:feature-modules` and `npm run test --workspace=server -- src/lib/card-response.test.ts src/lib/card-response.integration.test.ts src/core/board-card-status-change.test.ts`

5. Refactor while green (bounded):
   - Do not split files already >300 lines; revert biome import-order on fat files
   - Re-run: `npm run test:feature-modules`

6. Commit:
   Stage every path this packet moves or retargets.
   `git commit -m "refactor(architecture): extract card-assignees into server kernel"`
   PR: `refs #131`

## REFERENCES LOADED
docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md — rule: Kernel/shared first; GWT Module must not import leftover card-assignees
server/src/lib/work-item-response.ts — kernel already imports leftover card-assignees
server/src/modules/tracker/index.ts — `.js` re-export pattern (not used until feature packets)

## WHY THIS APPROACH
Justification: Kernel + my-work + board share these files; extracting first prevents FM-RULE-4 in T4/T5.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Do not open modules/board or modules/my-work in this task; do not split fat files]
You are implementing T2 server kernel extract for #131 relocation close.
Spec: docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
Design decision: Option A — kernel-first ladder
Files in scope: listed in OBJECTIVE
Test framework: node:test `npm run test:feature-modules`; Vitest `npm run test --workspace=server -- <rel path>`
Available after: T1
Architecture rule: leftover routes may import `server/src/lib/`; future modules must not import leftover routes
[RESTATE: Do not open modules/board or modules/my-work in this task; do not split fat files]

## DELIVERABLE
Given card-assignees.ts is still under routes/ and kernel work-item-response imports it, When a later my-work or board module packet would need those helpers, Then card-assignees already lives under server/src/lib/ from this extract

All tests PASS. Commit exists with message matching `refactor(architecture): extract card-assignees into server kernel`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Cycle Map locks lib homes and routes/ absences for these two files
  - Specifier-only retarget of kernel and leftover consumers
  - Conventional commit; PR `refs #131`

Must-not-have:
  - Moving my-work or board routers in this PR
  - God-file splits
  - `closes #131`
  - Dual-table / HTTP behavior changes

Open question risks:
  - If additional `card-*.ts` files are also imported by kernel + two features, report NEEDS_CONTEXT before expanding scope

Rollback note:
  - Revert this PR

## STOP CONDITIONS
Done when: Cycle Map green, check:feature-modules green, commit created
Uncertain when: another shared card-* file is required for one-way
Escalate when: extracting these files requires editing production logic
