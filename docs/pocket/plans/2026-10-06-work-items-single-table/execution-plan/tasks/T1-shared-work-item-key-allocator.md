# Task T1 — Shared work-item key allocator

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 1: Shared work-item key allocator [prereq]

## OBJECTIVE
Introduce one allocator for key numbers so board and Tracker creation share a single code path, including a column-less path.

Steps:
1. Write failing test for: "Both entry points use one allocator" (consecutive keys)
   Test file: `server/src/core/allocate-work-item-key.integration.test.ts`
   Level: integration (real Postgres, `RUN_INTEGRATION=1`)
   Test intent: Given a workspace whose `tracker_key_counter` is 5 / When `allocateWorkItemKey(trx, { workspaceId })` is called twice in one transaction / Then it returns keyNumber 6 then 7 and the counter row is 7
   Exercise through: exported `allocateWorkItemKey(dbExec, { workspaceId })` returning `{ keyNumber }`
   Test doubles: none; real Postgres via the existing integration test pool; do not mock Kysely
   Expected RED: `allocateWorkItemKey` is not exported from `core/allocate-work-item-key.ts` (TypeError), proving the helper does not exist yet
2. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/core/allocate-work-item-key.integration.test.ts`
3. Create `server/src/core/allocate-work-item-key.ts` with the `UPDATE workspaces SET tracker_key_counter = tracker_key_counter + 1 ... RETURNING` logic moved verbatim from `allocateCardIdentity` (`core/allocate-card-identity.ts:21-26`). Verify PASS (same command). Commit: `git commit -m "feat(server): add shared work-item key allocator"`.
4. Write failing test for: "No inline counter copy remains"
   Test file: `server/src/core/allocate-work-item-key.integration.test.ts` (second `describe`, source-contract style as used in `db/board-tracker-unify-migration.test.ts`)
   Level: unit (source contract)
   Test intent: Given the source of `modules/tracker/tracker-item-create.ts` and `core/allocate-card-identity.ts` / When read as text / Then tracker-item-create.ts does not contain `tracker_key_counter`, and allocate-card-identity.ts imports `allocateWorkItemKey` from `./allocate-work-item-key.js`
   Exercise through: `fs.readFileSync` on the two source files
   Test doubles: none
   Expected RED: tracker-item-create.ts still contains the inline `tracker_key_counter` update (`:142-148`)
5. Run test — verify FAIL: `npm run test --workspace=server -- src/core/allocate-work-item-key.integration.test.ts`
6. Make `allocateCardIdentity` call `allocateWorkItemKey`, and replace the inline copy in `tracker-item-create.ts` with a call to it (keep its own status choice from the tracker vocabulary: no column needed). Verify PASS; run `npm run typecheck --workspace=server`; refactor while green; commit: `git commit -m "refactor(server): route key allocation through one allocator"`.

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md — Rule 3 "One identity" (scenario "Both entry points use one allocator"); Appendix C (inline copy at `tracker-item-create.ts:142-148`)
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: lightweight
Justification: two call sites, a move-and-delegate refactor with one new 15-line helper; no schema change.

## SANDWICH CONTEXT
[CRITICAL: Key allocation must stay a single row-locked `UPDATE workspaces SET tracker_key_counter = tracker_key_counter + 1 ... RETURNING` inside the caller's transaction; no second allocator may exist after this task.]
You are implementing the shared allocator for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B (one-shot DO block migration; this task only prepares code)
Files in scope: server/src/core/allocate-work-item-key.ts (new), server/src/core/allocate-card-identity.ts, server/src/modules/tracker/tracker-item-create.ts, test file above
Available after: none (prereq)
Architecture rule: `.js` import extensions; no behavior change visible to clients.
[RESTATE: One allocator, row-locked counter UPDATE, caller owns the transaction.]

## DELIVERABLE
Given a workspace counter of 5, When the allocator is called twice in one transaction, Then keys 6 and 7 are returned and the counter is 7
Given board creation and Tracker creation, When both run, Then neither file contains its own counter update

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `allocateCardIdentity` return shape unchanged (`{ keyNumber, statusId }`)
  - Tests written before implementation; conventional commits with `server` scope
Must-not-have:
  - Any change to `workspaces` schema or to keys already issued
  - Touching files outside the list
Open question risks:
  - none
Rollback note:
  - Revert the two commits; no data change.
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: both deliverable scenarios pass, typecheck green, no other files modified
Uncertain when: `tracker-item-create.ts` has a different transaction shape than assumed
Escalate when: the allocator would need to run outside the caller's transaction
