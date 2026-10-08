# EXECUTION PLAN — Work items single table (merge tracker_items into cards)

**Date:** 2026-10-06
**Spec:** docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
**Status:** draft
**Total tasks:** 25

GitHub issue: #203. Phases: A (expand, deployable alone) → B (cutover code, ships only at cutover) → C (cutover tooling + ops) → D (Contract, gated 14 days after cutover). T23 (client reload hook), T24 (deploy Phase A) and T25 (maintenance rehearsal) are numbered last but belong to the stage boundaries: T25 rehearses maintenance mode on the host first, then Phase A is DEPLOYED (T24) before any Phase B code is written; T19 needs both.

---

## Execution Overview

### Glossary (anonymized stand-ins)
- **the reference workspace / the largest tracker-heavy production workspace:** the production workspace on `camel-ggf` with the most cards plus tracker items. On 2026-10-06 it had 25 live cards and 53 live tracker items (78 in the Tracker list), header counts 6 in progress and 16 done. Identify it with a read-only volume query (workspaces ordered by cards + tracker items); its name is never written into the repo.
- **`KEY-<n>`:** key number `n` with that workspace's key prefix (for example `KEY-33` is item number 33).
- **`<camel host>`:** the site host name served by the `camel-ggf` nginx; read it from the live nginx file and never write it into a tracked file.
- **`camel-ggf`:** ssh alias of the production host. `bmad` / `camel.web.id` is decommissioned.

### Local-only files (never committed)
Host-specific deployment files stay on this machine and are gitignored, following the repo's existing convention for `deploy/deploy-ggf.sh` and `deploy/docker-compose.ggf.yml`: `deploy/deploy-ggf.sh`, `deploy/docker-compose.ggf.yml`, `deploy/cutover-ggf.sh`, `deploy/restore-ggf.sh`, `deploy/nginx/camel-ggf.conf`, `deploy/maintenance/`, `deploy/CUTOVER-CHECKLIST.md`. T15 adds the ignore patterns (the only tracked change to `.gitignore`). Because git will not hold these files, keep a private backup outside the repo. Application code, tests, `Dockerfile`, `server/` and `client/` are committed as usual. No task may `git add -f` any of the local-only files.

### Recommended Order
```
T1, T2 → T3, T4, T5 (parallel) → T6
T14 (any time) → T23 (also needs T2)
T15 → T25 (maintenance rehearsal, manual); T1–T6, T14, T23, T25 → T24 (DEPLOY PHASE A, manual, user present) → T7 → T8 → T9 → T10 (also needs T1), T11, T12 (parallel) → T13 → T16
T15 (any time)
T14, T15, T16 → T17 → T18 → T19 (cutover; also needs T24 and T25) → T20 → T21 → T22
```

> Dependency order above is **recommended** — pocket skill enforces actual parallelism and sequencing.

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T3, T4, T5 | T2 completes |
| Group B | T10, T11, T12 | T9 completes (T10 also needs T1, T12 also needs T5) |
| Group C | T14, T15 | nothing (any time) |
| Group D | T23 | T14 and T2 complete |

### Stage gates (resumable stopping points)
- After T6, T14, T23 and the T25 maintenance rehearsal: Phase A code is complete. **T24 deploys it** (additive schema, no user-visible change) and proves the expand migration, the new SQL file in the image, and the build id in production. Nothing in Phase B starts before T24 is done. Safe to stop for weeks at this point.
- After T13: Phase B code is complete; it is merged to a long-lived branch/PR and **must not be deployed before T19**.
- **Main-agent-only tasks (never delegate to a subagent, user present, explicit go-ahead):** T18, T19, T24, T25. They touch or read production.
- T23 ships inside T24; tabs opened before T24 do not contain the hook, so T24 includes a one-time "refresh once" notice to the team; T19 happens at least one day after T24.
- T20–T22 must not start before cutover date + 14 days (date is recorded in the cutover checklist by T19).

### Test seam for migration tests (applies to T2, T7, T8, T13, T16, T20, T22)
`migrate.ts` today uses the shared `pool` and calls `pool.end()` in `finally`, so it cannot be called twice in one process, cannot target a scratch schema, and would kill the pool that route tests need. T2 therefore extracts `applySchema(client)` (runs the SQL files on a connected client in one `BEGIN/COMMIT/ROLLBACK`, never ends the pool) and keeps `migrate()` as the thin CLI wrapper. **Wherever a task's test says "through `migrate()`", it means `applySchema(client)` on a scratch-schema client** created by `server/src/db/scratch-schema-test-support.ts` (also created by T2), following the `SET search_path` pattern of `full-migration.integration.test.ts`. Pre-merge fixtures are seeded BEFORE the merge block runs, using this pattern: apply once on the empty scratch schema (the merge block and trigger find nothing to migrate), seed the pre-merge rows, then apply again. For T2's duplicate-key test the unique index already exists after the first apply, so drop it before seeding the duplicates.

### Constraints Reminder
**Architecture:** server NodeNext ESM (`.js` import extensions); every mutation calls `recordActivity`; migration SQL idempotent and inside the single `migrate.ts` transaction; new `.ts` files <= 300 lines; optimistic locking `version` (409); validation via `validators/http.ts`; do not touch client beyond typecheck fallout and the forced-reload version bump; do not touch Redis/SSE topology or `camel-lottie/`.
**Out-of-scope:** promote-to-board flow; merging overlapping date columns; any UI change; non-default-board decision; SSE patch-in-place (#100 P1#3); #115/#119/#124; zero-downtime/dual-write; dropping `tracker_items` before the 14-day mark.
**Assumptions at risk:** (0) forced reload needs a small client hook (T23) because no reload mechanism exists today; (1) RESOLVED 2026-10-06: `bmad`/`camel.web.id` is decommissioned (confirmed by the maintainer); only `camel-ggf` matters; (2) live nginx on `camel-ggf` is not in the repo; (3) `updated_at` is a nullable stored column with computed fallback (plan decision, see T2) instead of the NOT NULL column Appendix B.1 describes; (4) `/cards/*` returns 404 for column-less items while `PATCH /work-items/:key` with `column_id` returns 400 (Appendix B.5 reconciled).
**Sequencing:** Dependency order shown is recommended only. Do not treat `[depends: TN]` as a hard lock unless the task cannot logically proceed without the prerequisite's output.

### File Structure Map

```
Rule: Identity enforced by the database
  Create: server/src/core/allocate-work-item-key.ts            (created by: T1)
  Create: server/src/db/scratch-schema-test-support.ts, server/src/db/apply-schema.integration.test.ts   (created by: T2; T13 may extend the support file with `createScratchApp()`)
  Create: server/src/db/work-item-merge.sql                    (created by: T2; data block added by T7, guard by T8)
  Modify: server/src/db/migrate.ts, Dockerfile, server/src/db/types.ts   (T2)
  Modify: server/src/core/allocate-card-identity.ts, server/src/modules/tracker/tracker-item-create.ts   (T1)
  Modify: server/src/db/board-tracker-unify-migration.test.ts   (T2)
  Test:   server/src/core/allocate-work-item-key.integration.test.ts (T1), server/src/db/work-item-merge-expand.test.ts + .integration.test.ts (T2)

Rule: Data is preserved (copy + guard)
  Modify: server/src/db/work-item-merge.sql                    (T7, T8)
  Test:   server/src/db/work-item-merge-copy.integration.test.ts (T7), server/src/db/work-item-merge-guard.integration.test.ts (T8)

Rule: Board scope and column-less rejection
  Create: server/src/modules/board/require-board-card.ts                                   (created by: T4)
  Modify: server/src/modules/notifications/scheduler.ts (regression test only unless a fix is needed)   (T3)
  Modify: server/src/modules/board/{metrics,board,cards-update,cards-delete,card-read,card-attachments,card-attachment-persistence,cards-move}.ts   (T3, T4)
  Modify: server/src/modules/chat/tools/factory.ts, server/src/modules/agent/service-deps-activity.ts   (T3)
  Modify: server/src/core/board-card-status-change.ts, server/src/core/my-work-mark-done.ts, server/src/modules/focus/focus-session-repo.ts   (T5)
  Test:   server/src/modules/board/column-less-scope.integration.test.ts (T3), column-less-card-routes.integration.test.ts (T4), server/src/core/column-less-guards.integration.test.ts (T5)

Rule: Feeds and event readers
  Modify: server/src/lib/work-item-events.ts, server/src/modules/activity/activity.ts   (T6; work-item-events again in T9)
  Test:   server/src/lib/work-item-events.test.ts, server/src/modules/activity/activity-feed.integration.test.ts (T6)

Rule: Client contract unchanged (merged-table reads and writes)
  Modify: server/src/lib/work-item-response.ts, server/src/modules/tracker/tracker-item-read.ts, server/src/core/work-item-debt.ts   (T9)
  Create: server/src/core/work-item-debt.integration.test.ts   (created by: T9)
  Modify: server/src/modules/tracker/tracker-item-{create,create-queries,update,delete,reorder,labels}.ts, server/src/core/tracker-item-status-change.ts, server/src/lib/{tracker-activity,tracker-assignees}.ts   (T10; `scripts/check-event-write-routing.mjs` is NOT changed here)
  Modify: server/src/modules/tracker/{tracker-project-delete,tracker-project-serialize,tracker-phase-queries,tracker-vocabularies}.ts, server/src/lib/helpers.ts   (T11)
  Modify: server/src/modules/my-work/{my-work-data-source-list,my-work-data-source-detail,my-work-response-hydration,my-work-router}.ts, server/src/core/my-work-mark-done.ts, server/src/modules/focus/{focus-session-repo,focus-session-inputs}.ts   (T12)
  Modify: server/src/realtime/types.ts, server/src/core/work-item-latency.ts (only if T14/T12 need it)   (T12, T14)
  Test:   server/src/lib/work-items.merged.integration.test.ts (T9), server/src/modules/tracker/tracker-writes.merged.integration.test.ts (T10), server/src/modules/tracker/tracker-structure.merged.integration.test.ts (T11), server/src/modules/my-work/my-work.merged.integration.test.ts (T12), server/src/routes/work-item-merged.integration.test.ts, work-item-merged-allocator.integration.test.ts, work-item-merged-workspace.integration.test.ts, work-item-merged-writers.test.ts (T13)

Rule: Cutover is safe and recoverable
  (LOCAL ONLY, gitignored, never committed: every `deploy/*-ggf.sh`, `deploy/docker-compose.ggf.yml`, `deploy/nginx/camel-ggf.conf`, `deploy/maintenance/`, `deploy/CUTOVER-CHECKLIST.md` below)
  Create: server/src/background-jobs.ts (import-safe home of `startBackgroundJobs`)         (created by: T14)
  Modify: server/src/index.ts, server/src/modules/notifications/scheduler.ts (+ other timer/worker starters found in T14)   (T14)
  Create: deploy/nginx/camel-ggf.conf, deploy/maintenance/index.html                       (created by: T15)
  Create: server/src/scripts/cutover-snapshot.ts                                           (created by: T16)
  Create: deploy/cutover-ggf.sh, deploy/restore-ggf.sh                                     (created by: T17)
  Create: deploy/CUTOVER-CHECKLIST.md                                                      (created by: T25; extended by T24, T17, T18, T19)
  Modify: deploy/docker-compose.ggf.yml (pass `BACKGROUND_JOBS: ${BACKGROUND_JOBS:-on}` through)   (T17)
  Create: client/src/shared/useBuildReload.ts (+ test), server/src/lib/health.ts (+ test), server health route in server/src/index.ts:105, client/src/App.tsx, Dockerfile, deploy/deploy-ggf.sh   (created/modified by: T23)
  Test:   server/src/background-jobs.test.ts (T14), server/src/scripts/cutover-snapshot.integration.test.ts (T16)

Rule: Contract
  Modify: server/src/db/schema.sql, server/src/db/migrate.ts, server/src/db/types.ts, Dockerfile, server/src/db/{board-tracker-unify-migration,tracker-migration}.test.ts, server/src/db/full-migration.integration.test.ts   (T20)
  Delete: server/src/db/work-item-merge.sql   (T20)
  Create: server/src/db/work-item-contract.integration.test.ts   (created by: T20)
  Delete/Modify: server/src/lib/work-item-response.ts, server/src/core/work-item-debt.ts (+test), server/src/scripts/check-key-collisions.ts, server/src/lib/tracker-activity.ts (+test), scripts/check-event-write-routing.mjs, scripts/check-work-item-mutation-routing.mjs, server/package.json, package.json, .github/workflows/*, deploy/DEBT-CHECKS.md, deploy/debt-check.cron.example, client/src/shared/workItemMutations.ts (only if removable without UI change), CLAUDE.md, .claude/skills/camel-server/SKILL.md   (T21)
  Create: server/src/lib/work-item-shim-removed.test.ts, docs/pocket/adr/2026-10-work-items-single-table.md   (created by: T21)
  Create: server/src/db/work-item-rename.integration.test.ts   (created by: T22)
  Modify: every server file that names `cards` / `card_events` (compiler- and grep-guided list recorded in the T22 report), db/types.ts, schema.sql   (T22)
  Rename: cards -> work_items, card_events -> work_item_events   (T22)
```

---

## Pocket Packets

---

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

---

### Task 2: Expand migration (nullable column_id, new columns, unique key, wiring) [prereq]

## OBJECTIVE
Add the additive, deployable-alone schema changes in a new SQL file executed by `migrate.ts` inside the same transaction, and update Kysely types.

Steps:
0. Write failing test for: "applySchema is an injectable, atomic seam"
   Test file: `server/src/db/apply-schema.integration.test.ts`
   Level: integration (real Postgres, scratch schema)
   Test intent: Given a scratch schema and a dedicated client / When `applySchema(client)` runs the SQL files / Then the objects from all files exist in that schema and the shared `pool` is still usable afterwards; and given the same scratch schema pre-seeded with an incompatible table named `cards` so `schema.sql` fails / Then `applySchema` rejects and none of the objects from later files (for example the agent tables) exist (full rollback)
   Exercise through: exported `applySchema(client)` in `db/migrate.ts`; `migrate()` stays the thin CLI wrapper (connect, `applySchema`, `pool.end()`)
   Test doubles: none; `scratch-schema-test-support.ts` (new) creates a uniquely named schema, sets `search_path` on the client, and drops it in teardown
   Expected RED: `applySchema` is not exported from `migrate.ts`
0b. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/db/apply-schema.integration.test.ts`
0c. Extract `applySchema` from `migrate.ts` and create the support file. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "refactor(db): extract injectable applySchema"`.
1. Write failing test for: "New SQL file is wired into migration and image"
   Test file: `server/src/db/work-item-merge-expand.test.ts`
   Level: unit (source contract)
   Test intent: Given `migrate.ts` and `Dockerfile` / When read as text / Then `migrate.ts` reads `work-item-merge.sql` and executes it after `schema.sql` and before `agent-schema.sql` inside the existing BEGIN/COMMIT, and the Dockerfile has `COPY server/src/db/work-item-merge.sql ./server/dist/db/work-item-merge.sql`
   Exercise through: `fs.readFileSync` on both files
   Test doubles: none
   Expected RED: neither file references `work-item-merge.sql`
2. Run test — verify FAIL: `npm run test --workspace=server -- src/db/work-item-merge-expand.test.ts`
3. Create `server/src/db/work-item-merge.sql` (empty guarded stub), wire `migrate.ts` and the Dockerfile. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "chore(db): wire work-item-merge.sql into migration and image"`.
4. Write failing test for: "Column-less items and database-enforced unique keys"
   Test file: `server/src/db/work-item-merge-expand.integration.test.ts`
   Level: integration (real Postgres)
   Test intent: Given a freshly migrated database / When a card is inserted with `column_id` NULL and key 999, then a second row with the same `(workspace_id, key_number)` is inserted (including when the first is soft-deleted), and two rows with NULL key are inserted / Then the NULL-column insert succeeds, the duplicate raises unique violation `23505`, and the two NULL-key inserts succeed
   Exercise through: raw inserts on the scratch-schema client after `applySchema(client)`
   Test doubles: none
   Expected RED: `column_id` is `NOT NULL` (error 23502) and no unique index exists
5. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/db/work-item-merge-expand.integration.test.ts`
6. In `work-item-merge.sql` (all idempotent): `ALTER TABLE cards ALTER COLUMN column_id DROP NOT NULL`; `ADD COLUMN IF NOT EXISTS` on `cards` for `start_date DATE`, `end_date DATE`, `completed_at TIMESTAMPTZ`, `plan_position DOUBLE PRECISION`, `updated_at TIMESTAMPTZ` (nullable; NULL means "use computed value", see QUALITY BAR); `ALTER TABLE tracker_items ADD COLUMN IF NOT EXISTS migrated_to_id INTEGER`; `CREATE UNIQUE INDEX IF NOT EXISTS ... ON cards (workspace_id, key_number)` (soft-deleted rows included; NULL keys ignored by Postgres). No `CONCURRENTLY`. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "feat(db): expand cards for merged work items"`.
7. Write failing test for: "Pre-existing duplicate keys abort the migration loudly"
   Test file: `server/src/db/work-item-merge-expand.integration.test.ts` (separate `describe` using the scratch-schema support file)
   Level: integration
   Test intent: Given a scratch schema where `applySchema(client)` already ran once, the unique key index was then dropped, and two cards with the same `(workspace_id, key_number)` were seeded / When `applySchema(client)` runs a second time / Then it rejects with a message starting `work-item-merge: duplicate card keys` naming the workspace and key, the unique key index still does not exist afterwards (the failing run did not create it), and both seeded duplicate cards are unchanged (the failed run rolled back and left the seeded state intact)
   Exercise through: `applySchema(client)` called twice on one scratch-schema client, with `DROP INDEX` and the duplicate inserts between the calls (per the Test seam pattern)
   Test doubles: none
   Expected RED: index creation fails with a generic Postgres error, not the explicit message
8. Run test — verify FAIL (same command). Add a `DO` block before the index that `RAISE EXCEPTION 'work-item-merge: duplicate card keys workspace=% key=%'` when duplicates exist. Verify PASS.
9. Write failing test for: "Running migrate twice is a no-op"
   Test file: same integration file
   Level: integration
   Test intent: Given a migrated database / When `migrate()` runs a second time / Then it resolves without error and column and index definitions are unchanged
   Exercise through: `applySchema(client)` twice on one scratch-schema client, then `information_schema` and `pg_indexes` reads
   Test doubles: none
   Expected RED: none expected; this is a labeled regression guard. Prove it can fail by temporarily removing one `IF NOT EXISTS` in the SQL, confirm RED, then restore it
10. Update `server/src/db/types.ts`: `Cards.column_id: number | null`, add the new `Cards` columns, add `TrackerItems.migrated_to_id`. Rewrite the test at `server/src/db/board-tracker-unify-migration.test.ts:108` to assert the unique index lives in `work-item-merge.sql` and NOT in `schema.sql`. Run `npm run typecheck --workspace=server` and fix the fallout ONLY in these named files, using plain narrowing (`if (row.column_id == null) continue;`, or a non-null type where an inner join on `columns` guarantees it): `core/remap-card-statuses.ts`, `modules/board/cards-delete.ts`, `modules/board/board.ts`, `modules/board/column-is-done-remap.ts`, `core/board-card-status-change.ts`, `core/my-work-mark-done.ts`, `modules/board/card-attachments.ts`, `modules/board/card-attachment-persistence.ts`, `lib/work-item-response.ts`. These guards are permanent defensive code: write no TODO or placeholder comments. Fallout in any other file → report NEEDS_CONTEXT.
11. Commit: `git commit -m "feat(server): type merged work-item columns"`.

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Rules "Identity is database-enforced", "Run-once safety"; Appendix B.1, B.2; Implementation Notes (ordering, no CONCURRENTLY); Appendix A #4 (test pin at `board-tracker-unify-migration.test.ts:108-118`)
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: schema change plus wiring, type change with compile fallout across files, and a pinned test to rewrite.

## SANDWICH CONTEXT
[CRITICAL: Every statement must be idempotent and run inside the single transaction opened by `migrate.ts`; the new SQL file must also be copied by the Dockerfile or the production container will fail to find it.]
You are implementing the expand step of the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B (one-shot DO block in the merge SQL file; this task is the additive part and ships alone)
Files in scope: server/src/db/work-item-merge.sql (new), migrate.ts, scratch-schema-test-support.ts (new), apply-schema.integration.test.ts (new), Dockerfile, db/types.ts, db/board-tracker-unify-migration.test.ts, the two new test files, and the nine named typecheck-fallout files in step 10
Available after: none (prereq; T1 independent)
Architecture rule: no behavior change for users; `schema.sql` must not gain the unique index (keeps the old pinned test meaningful); `.js` extensions.
[RESTATE: Idempotent, single transaction, copied into the image.]

## DELIVERABLE
Given `migrate.js` and the Dockerfile, When inspected, Then the new SQL file is executed after `schema.sql` in the same transaction and copied into `dist/db`
Given a migrated database, When a column-less card or a duplicate key is inserted, Then NULL-column succeeds and duplicates raise 23505
Given duplicate keys pre-exist, When the schema is applied, Then it aborts with `work-item-merge: duplicate card keys ...`, the unique index is not created, and the seeded rows are unchanged
Given `migrate()` runs twice, Then no error and no schema drift
[derived] Given `updated_at` is NULL on a card, When serialized later (T9), Then the existing computed value is used

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `updated_at` nullable with computed fallback (plan decision: avoids touching every card write path; Appendix B.1 said NOT NULL: flag this in the report)
  - Typecheck green on completion
Must-not-have:
  - `CREATE INDEX CONCURRENTLY`; `NOT NULL` on any new column; any data copy (that is T7)
Open question risks:
  - Production duplicate-key count is 0 as of 2026-10-06; if the pre-check fires in rehearsal, STOP and report NEEDS_CONTEXT
Rollback note:
  - Additive only; redeploy previous image. The unique index and nullable column are harmless to old code.
Red flags:
  - Editing `schema.sql` (the pinned-test rewrite touches only the test file) → STOP

## STOP CONDITIONS
Done when: all four scenarios pass, typecheck green, `npm run test --workspace=server -- src/db/board-tracker-unify-migration.test.ts` green
Uncertain when: `migrate()` cannot target a scratch database in integration tests
Escalate when: typecheck fallout appears in any file not named in step 10

---

### Task 3: Board scope filters on aggregate readers [depends: T2]

## OBJECTIVE
Make flow metrics, `GET /board`, chat board data and agent timestamps ignore column-less rows.

Steps:
1. Write failing test for: "Tracker-native items never count as board cards" (metrics)
   Test file: `server/src/modules/board/column-less-scope.integration.test.ts`
   Level: integration
   Test intent: Given a workspace with 2 board cards (one done) and 3 column-less cards / When flow metrics are computed / Then totals reflect only the 2 board cards
   Exercise through: the exported metrics function/handler in `modules/board/metrics.ts`
   Test doubles: none (real Postgres); do not mock Kysely
   Expected RED: metrics report 5 cards
2. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/modules/board/column-less-scope.integration.test.ts`
3. Add `column_id IS NOT NULL` to the cards query at `metrics.ts:11`. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "fix(board): exclude column-less items from flow metrics"`.
4. Write failing test for: "GET /board returns only board cards"
   Test file: same
   Level: integration
   Test intent: Given the same fixture / When the board response is built / Then it lists only the 2 board cards, and no assignee, label or attachment query ran for the 3 column-less ids (assert via the response and by seeding an assignee on a column-less card that must not appear)
   Exercise through: `buildBoardResponse` / the route handler in `board.ts:28-117`
   Test doubles: none
   Expected RED: assignees of column-less rows are loaded (board.ts:122-126) and rows are only dropped at the `Map`
5. Run test — verify FAIL (same command). Filter in SQL at `board.ts:64-117`. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "fix(board): filter column-less items in board query"`.
6. Write failing test for: "Chat and agent readers exclude them"
   Test file: same
   Level: integration
   Test intent: Given the fixture / When `query_board_data` (chat tool, `modules/chat/tools/factory.ts:33`) and the agent timestamps reader (`modules/agent/service-deps-activity.ts:10`) run / Then neither includes column-less cards
   Exercise through: the exported tool/dep functions
   Test doubles: Anthropic client is not involved; if the tool factory needs a service object, use the existing test support constructors in the same folder
   Expected RED: both include the 3 rows
7. Run test — verify FAIL (same command). Add the filter in both. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "fix(agent): exclude column-less items from chat and agent board data"`.
8. Write failing test for: "Soft-deleted column-less items appear nowhere"
   Test file: `server/src/modules/board/column-less-scope.integration.test.ts`
   Level: integration
   Test intent: Given a soft-deleted column-less card that still holds its key / When metrics, the board response and the chat/agent readers run / Then it is excluded from all of them, and a new item cannot reuse its key
   Exercise through: the same entry points as steps 1-6, plus a raw insert of a duplicate key expecting `23505`
   Test doubles: none
   Expected RED: if any reader lacks `deleted_at IS NULL` for column-less rows the count changes; if every reader already filters it, record this cycle as a labeled regression guard and prove it can fail by temporarily removing one filter
9. Run test — verify the outcome above (same command). Fix any reader that lacks `deleted_at IS NULL`. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "test(board): pin soft-deleted exclusion for column-less items"`.
10. Write failing test for: "Due-date reminders ignore column-less items (intended behavior pinned)"
   Test file: `server/src/modules/notifications/scheduler.column-less.integration.test.ts`
   Level: integration
   Test intent: Given one board card and one column-less item, both with a due date tomorrow / When the due-date reminder job runs (`modules/notifications/scheduler.ts:7-9`) / Then only the board card produces a reminder; the test name and a comment state this pins today's inner-join behavior and that planned items intentionally get no reminders until a product decision changes it
   Exercise through: the exported job function
   Test doubles: fake clock (`vi.useFakeTimers`); do not mock the DB
   Expected RED: none expected (the inner join already excludes it); labeled regression guard, proven able to fail by temporarily switching the join to a left join
11. Run test — verify the outcome above: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/modules/notifications/scheduler.column-less.integration.test.ts`. Commit: `git commit -m "test(notifications): pin reminder behavior for column-less items"`.

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Rule "Tracker-native items never count as board cards"; Appendix C ("Must gain column_id IS NOT NULL")
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: four files across board/chat/agent, each a small predicate, with one integration fixture shared by all.

## SANDWICH CONTEXT
[CRITICAL: Only rows with a non-NULL `column_id` are board cards; filter in SQL, never by dropping rows in TypeScript.]
You are implementing board-scope filters for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B
Files in scope: modules/board/metrics.ts, modules/board/board.ts, modules/chat/tools/factory.ts, modules/agent/service-deps-activity.ts, modules/notifications/scheduler.ts (test only unless a fix is needed), two new test files
Available after: T2
Architecture rule: no behavior change while no column-less rows exist (production today)
[RESTATE: Filter column-less rows in SQL.]

## DELIVERABLE
Given 2 board cards + 3 column-less cards, When metrics run, Then only 2 are counted
Given the same fixture, When the board is built, Then only board cards, assignees, labels and attachments are loaded
Given the same fixture, When chat/agent readers run, Then column-less cards are excluded
Given a soft-deleted column-less card, When any of these readers runs, Then it is excluded and its key stays reserved
Given a column-less item with a due date, When the reminder job runs, Then no reminder is produced (pinned, intended)

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Existing board/metrics tests still green
Must-not-have:
  - Changing response shapes; touching event readers (T6)
Open question risks:
  - Exact export names in these files unverified → NEEDS_CONTEXT if the entry points differ
Rollback note:
  - Revert commits; no data change.
Red flags:
  - Any change in output for a database with no column-less rows → STOP

## STOP CONDITIONS
Done when: three scenarios pass and `npm run test --workspace=server` for the touched folders is green
Uncertain when: a reader has no test seam without mocking the DB
Escalate when: a fourth aggregate reader on `cards` is found without a column filter (add to report)

---

### Task 4: Reject column-less items on /cards endpoints [depends: T2]

## OBJECTIVE
`/cards/:id` family returns 404 for column-less items; board-only actions are rejected.

Steps:
1. Write failing test for: "Column-less item through board-only endpoints"
   Test file: `server/src/modules/board/column-less-card-routes.integration.test.ts`
   Level: integration (Express app via supertest-style helper already used by `routes/cards-identity.integration.test.ts`)
   Test intent: Given a column-less card with key 50 / When `GET /cards/:id`, `PATCH /cards/:id`, `DELETE /cards/:id`, `POST /cards/:id/move`, and an attachment upload on it are called / Then each returns 404 and the row is unchanged
   Exercise through: the HTTP routes with an authenticated workspace member
   Test doubles: none; storage provider for attachments uses the existing test fake
   Expected RED: GET/PATCH return 200 (no column check in `card-read.ts:13`, `cards-update.ts:70,107,163`)
2. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/modules/board/column-less-card-routes.integration.test.ts`
3. Add a shared `requireBoardCard` lookup (`column_id IS NOT NULL`) used by `card-read.ts`, `cards-update.ts`, `cards-delete.ts`, `cards-move.ts`, `card-attachments.ts`, `card-attachment-persistence.ts`; return the existing not-found error shape. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "fix(board): treat column-less items as not found on card routes"`.
4. Write failing test for: "Board cards unchanged"
   Test file: same
   Level: integration
   Test intent: Given a normal board card / When the same endpoints are called / Then behavior and status codes are exactly as before (including 409 on stale `version`)
   Exercise through: the HTTP routes
   Test doubles: none
   Expected RED: none expected; labeled regression guard. Prove it can fail by temporarily making `requireBoardCard` always return not-found, confirm RED, then restore
5. Run test — verify the outcome above and then PASS on the final code: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/modules/board/column-less-card-routes.integration.test.ts`
6. Create `server/src/modules/board/require-board-card.ts` as the single shared helper (named here so the file map is exact), refactor while green (re-run the same command), then commit: `git commit -m "test(board): pin board card route behavior"`.

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Rule "Client contract unchanged" (column-less rejection); Appendix B.5; Appendix C ("Must reject column-less items")
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: six files share one guard; a shared helper avoids six divergent copies (rule of three).

## SANDWICH CONTEXT
[CRITICAL: `/cards/*` never operates on a column-less item; the error must be the existing 404 shape, never a 500; the lookup must stay scoped by `workspace_id`.]
You are implementing column-less rejection for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B
Files in scope: the six board files above, the new `modules/board/require-board-card.ts`, and the test file
Available after: T2
Architecture rule: validation via `validators/http.ts`; no response-shape change
[RESTATE: 404, same shape, workspace-scoped.]

## DELIVERABLE
Given a column-less card, When any /cards endpoint above is called, Then 404 and no mutation
Given a board card, When called, Then behavior is unchanged

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - One shared helper imported by all six sites
Must-not-have:
  - Enabling `PATCH column_id` on column-less items (promote flow is out of scope)
Open question risks:
  - Attachment delivery already uses an inner join on columns (`card-attachment-delivery.ts:62-68`); do not duplicate its guard
Rollback note:
  - Revert commits.
Red flags:
  - Any status other than 404 for a column-less lookup → STOP

## STOP CONDITIONS
Done when: both scenarios pass and existing card route tests are green
Uncertain when: a route has no test harness
Escalate when: a route legitimately needs to read column-less items

---

### Task 5: Reject column-less items in core paths [depends: T2]

## OBJECTIVE
Make status-change, my-work mark-done (board branch) and focus board lookup treat column-less rows as not found.

Steps:
1. Write failing test for: "Core paths treat column-less items as board-missing"
   Test file: `server/src/core/column-less-guards.integration.test.ts`
   Level: integration
   Test intent: Given a column-less card / When `board-card-status-change` is invoked for its id, `my-work-mark-done` takes the board branch for it, and `focus-session-repo` `findTask("board", id)` is called / Then each yields its existing not-found result and writes nothing
   Exercise through: the exported functions at `core/board-card-status-change.ts:39-194`, `core/my-work-mark-done.ts:101-109,221,230`, `modules/focus/focus-session-repo.ts:229`
   Test doubles: none
   Expected RED: status-change selects the row and proceeds with a NULL column; focus returns the task
2. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/core/column-less-guards.integration.test.ts`
3. Add `column_id IS NOT NULL` to the three lookups. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "fix(core): ignore column-less items in board-only code paths"`.
4. Write failing test for: "Board behavior unchanged"
   Test file: same
   Level: integration
   Test intent: Given a normal board card / When the same functions run / Then results equal the pre-change behavior
   Exercise through: same functions
   Test doubles: none
   Expected RED: none expected; labeled regression guard. Prove it can fail by temporarily inverting one added predicate, confirm RED, then restore
5. Run test — verify PASS on the final code: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/core/column-less-guards.integration.test.ts`; refactor while green (re-run the same command), then commit: `git commit -m "test(core): pin board-only path behavior"`.

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Appendix C rows for `board-card-status-change.ts`, `my-work-mark-done.ts`, `focus-session-repo.ts:229`
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: lightweight
Justification: three one-line predicates with one shared fixture.

## SANDWICH CONTEXT
[CRITICAL: Board-only code paths must never act on a row with NULL `column_id`.]
You are implementing core-path guards for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B
Files in scope: the three source files above and the test file
Available after: T2
Architecture rule: keep existing not-found result shapes
[RESTATE: Column-less rows are invisible to board-only paths.]

## DELIVERABLE
Given a column-less card, When those paths are called, Then not-found and no writes
Given a board card, When called, Then unchanged

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Only the board branch changes; tracker branches are left for T12
Must-not-have:
  - Touching tracker branches or event readers
Open question risks:
  - none
Rollback note:
  - Revert commit.
Red flags:
  - Edits in `my-work-mark-done.ts` tracker branch → STOP (T12 owns it)

## STOP CONDITIONS
Done when: both scenarios pass; existing `core/my-work-mark-done.test.ts` green
Uncertain when: function signatures differ from the assumed ones
Escalate when: a guard changes a public response shape

---

### Task 6: Event readers tolerate merged events [depends: T3]

## OBJECTIVE
Prepare feed and event readers for `card_events` rows with NULL `card_id`, NULL `to_column_id` and `tracker_*` types, without changing today's output.

Steps:
1. Write failing test for: "tracker_* event types pass through unchanged"
   Test file: `server/src/lib/work-item-events.test.ts`
   Level: unit
   Test intent: Given a `card_events`-shaped row with `event_type` `tracker_project_created` and NULL `card_id` / When `toCardTrackerEvent` (`lib/work-item-events.ts:104-150`) maps it / Then the type stays `tracker_project_created`; today's `move`, `create`, `delete`, `update` mappings are unchanged
   Exercise through: exported mapper function
   Test doubles: none (pure function)
   Expected RED: the mapper relabels it `tracker_item_updated` (`:126-131`)
2. Run test — verify FAIL: `npm run test --workspace=server -- src/lib/work-item-events.test.ts`
3. Fix mapper pass-through for `tracker_*` types. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "fix(server): keep tracker event types when mapping card events"`.
4. Write failing test for: "/activity excludes project and phase events"
   Test file: `server/src/modules/activity/activity-feed.integration.test.ts`
   Level: integration
   Test intent: Given `card_events` rows including `tracker_project_created`/`tracker_phase_deleted` with NULL `card_id`, plus normal board events / When `/activity` is requested / Then only today's event kinds are returned and none has a null title
   Exercise through: the `/activity` route (`modules/activity/activity.ts:64-71`)
   Test doubles: none
   Expected RED: the feed returns the project/phase rows with `cardTitle` null
5. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/modules/activity/activity-feed.integration.test.ts`
6. Exclude `tracker_project_%` and `tracker_phase_%` in the `/activity` query. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "fix(activity): keep project and phase events out of the card feed"`.
7. Write failing test for: "NULL column and NULL card never render 'undefined'"
   Test file: `server/src/lib/work-item-events.test.ts`
   Level: unit
   Test intent: Given an event with NULL `to_column_id` and NULL joined titles / When the chat mapper (`chat/tools/factory.ts:50`) and agent mapper (`service-deps-activity.ts:24`) format it / Then the output contains no literal `undefined` or `null` text
   Exercise through: the exported mapping functions (extract the formatting into a named function in the same file if it is inline; keep file <= 300 lines)
   Test doubles: none
   Expected RED: missing-title path prints `undefined`
8. Run test — verify FAIL (same command as step 2). Add null guards. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "fix(agent): guard null titles in activity mappers"`.

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Story 2 scenario "Activity feed"; Appendix C "Event readers to adapt"; Appendix B.3
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: four readers with distinct failure modes; this task keeps behavior identical today but safe for merged events.

## SANDWICH CONTEXT
[CRITICAL: `/activity` output must not change for production data as it is today; project and phase events remain visible only in the unified feed.]
You are implementing event-reader tolerance for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B
Files in scope: lib/work-item-events.ts (mapper only; the tracker_events UNION is T9), modules/activity/activity.ts, modules/chat/tools/factory.ts, modules/agent/service-deps-activity.ts, test files
Available after: T3 (same files as T3 for chat and agent readers)
Architecture rule: no schema change
[RESTATE: Today's `/activity` output unchanged.]

## DELIVERABLE
Given a `tracker_project_created` card_events row, When mapped, Then its type is unchanged
Given project/phase events in card_events, When /activity loads, Then they are absent
Given NULL titles, When mapped by chat or agent readers, Then no 'undefined' text

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Activity function names confirmed by reading `activity.ts` (unverified in the scan)
Must-not-have:
  - Reading from `card_events` for tracker data before cutover; changing the unified-feed query (T9)
Open question risks:
  - Whether `recordTrackerActivity` also writes `tracker_project_*` types is unverified → NEEDS_CONTEXT if the call sites differ
Rollback note:
  - Revert commits.
Red flags:
  - Any diff in `/activity` output on the existing fixture → STOP

## STOP CONDITIONS
Done when: three scenarios pass, existing activity tests green
Uncertain when: mapper functions are not exported
Escalate when: unified-feed changes seem required

---

### Task 7: Copy block: tracker data into cards [depends: T24]

## OBJECTIVE
Add the one-shot `DO` block that copies tracker rows into `cards` and remaps everything that points at them.

Steps:
1. Write failing test for: "A tracker item keeps all its data"
   Test file: `server/src/db/work-item-merge-copy.integration.test.ts`
   Level: integration (scratch database; run `migrate()` pieces as in `full-migration.integration.test.ts`)
   Test intent: Given a tracker item with project, phase, status, priority, dates, version 3, 2 assignees, 1 label and 5 `tracker_events` / When the merge SQL runs / Then a `cards` row exists with `column_id` NULL, the same `key_number`, title, description, status, priority, project, phase, `start_date`, `end_date`, `completed_at`, `version`, `created_at`, and `updated_at` copied; `plan_position` = tracker `position`; board `position` is a non-null placeholder; `card_assignees`/`card_labels` have the new id; `card_events` has the 5 events with new `card_id`, original `event_type`, `payload`, `created_at`, `actor_id` and `workspace_id`; `tracker_items.migrated_to_id` equals the new id
   Exercise through: executing `work-item-merge.sql` against the seeded scratch DB
   Test doubles: none
   Expected RED: no copy occurs; `migrated_to_id` stays NULL
2. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/db/work-item-merge-copy.integration.test.ts`
3. Implement the copy in a single `DO` block: `INSERT ... SELECT ... RETURNING` into `cards` using default ids (never explicit ids), keep a temp mapping `(old_id, new_id)`, set `migrated_to_id`, remap satellites. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "feat(db): copy tracker items into cards"`.
4. Write failing test for: "Item-less events and focus sessions"
   Test file: same
   Level: integration
   Test intent: Given `tracker_events` with `tracker_item_id` NULL (project/phase) and a `focus_sessions` row with `task_source='tracker'`, `task_id` = old id / When the merge SQL runs / Then item-less events are copied with `workspace_id` and NULL `card_id`; the focus row keeps `task_source='tracker'` with `task_id` = new id; and no orphan references remain
   Exercise through: executing the SQL
   Test doubles: none
   Expected RED: events not copied; focus row still points at the old id
5. Run test — verify FAIL (same command). Implement. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "feat(db): remap events and focus sessions during merge"`.
6. Write failing test for: "Soft-deleted tracker rows and empty workspaces"
   Test file: same
   Level: integration
   Test intent: Given a soft-deleted tracker row (key retained) and a workspace with 0 tracker items / When the SQL runs / Then the deleted row is copied with `deleted_at` preserved, and the empty workspace is unchanged
   Exercise through: executing the SQL
   Test doubles: none
   Expected RED: deleted row not copied
7. Run test — verify FAIL (same command). Implement. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "feat(db): preserve soft-deleted tracker rows in merge"`.
8. Write failing test for: "One audit notice per workspace"
   Test file: `server/src/db/work-item-merge-copy.integration.test.ts`
   Level: integration
   Test intent: Given two workspaces with tracker items / When the merge SQL runs on a pg client that records `notice` events / Then exactly one notice per affected workspace is emitted, formatted `work-item-merge: workspace=<id> tracker_before=<n> cards_added=<n>`, with matching counts; the `card_events` row count equals the copied events exactly (no extra audit rows written for the migration itself)
   Exercise through: executing the SQL with `client.on("notice", ...)`
   Test doubles: none
   Expected RED: no notices are emitted
9. Run test — verify FAIL (same command). Add `RAISE NOTICE` per workspace. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "feat(db): log per-workspace counts during merge"`.
10b. Write failing test for: "Tracker key colliding with a card key aborts the merge"
   Test file: `server/src/db/work-item-merge-copy.integration.test.ts`
   Level: integration
   Test intent: Given a pre-merge fixture where a tracker item and a card in the same workspace both have key 7 (possible before the merge because they live in separate tables) / When the merge SQL runs through `applySchema(client)` / Then it rejects with a message starting `work-item-merge: key collision` naming the workspace and key, and afterwards no tracker row has `migrated_to_id` set and no copied card exists (nothing partially copied)
   Exercise through: `applySchema(client)` on a scratch schema seeded before the merge SQL
   Test doubles: none
   Expected RED: the copy hits the unique index and fails with a bare 23505 message
10c. Run test — verify FAIL (same command). Add an explicit collision pre-check inside the block that raises `work-item-merge: key collision workspace=% key=%`. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "feat(db): fail loudly on key collisions during merge"`.
10. Id-reference re-scan (report in the task output; any hit becomes a remap in this block with its own cycle): `rg "tracker_item_id|trackerItemId|task_id" server/src --type ts`, plus a read-only look at JSONB payload keys written by `recordActivity`/notification creators for tracker ids (`card_events.payload`, `notifications`): `notifications.card_id` points only at cards (already verified); confirm no payload stores a tracker numeric id.
11. Before step 3, read `lib/card-response.ts` `computeCardUpdatedAt` and `modules/focus/focus-session-inputs.ts` `buildReturnPath` to confirm: `updated_at` is copied from tracker, and `return_path` for tracker sessions uses the key (`/tracker/<key>`) so it needs no rewrite; if it embeds the numeric id, add the rewrite and a test.

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Story 1 Rules 1 and 2; Appendix B.2, B.3, B.4, B.6; Implementation Notes (default ids, COALESCE position, ordering)
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: deep
Justification: data-moving SQL with id remapping across six tables, run on production data; mistakes are expensive.

## SANDWICH CONTEXT
[CRITICAL: Copy rows with default (sequence) ids only, never explicit ids; the whole block must be one atomic `DO` statement inside the `migrate.ts` transaction, and every statement must be idempotent against re-runs (guard added in T8 must not be bypassed).]
You are implementing the data copy for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B
Files in scope: server/src/db/work-item-merge.sql, server/src/db/work-item-merge-copy.integration.test.ts
Available after: T24 (Phase A deployed; nothing of this task may be deployed before T19)
Architecture rule: place after tracker satellite schema, vocabulary slot constraints and the key backfill (`schema.sql:816-869`); no `CONCURRENTLY`
[RESTATE: Default ids only; one atomic DO block; idempotent.]

## DELIVERABLE
Given a tracker item with satellites, When merged, Then every field and relation follows the new row
Given item-less events and tracker focus sessions, When merged, Then events are kept and no orphan exists
Given soft-deleted rows and empty workspaces, When merged, Then deleted rows are preserved and empty workspaces are unchanged
Given two workspaces with tracker items, When merged, Then one per-workspace notice with counts is emitted and no migration activity rows are written

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Board `position` for copied rows is a non-null placeholder never read for ordering; `COALESCE(position, ...)` for `plan_position`
  - `status_id` copied verbatim (same vocabulary table)
Must-not-have:
  - Merging date column meanings; changing tracker `position` semantics; writing to `tracker_events` or `tracker_items` except `migrated_to_id`
Open question risks:
  - `return_path` format and `computeCardUpdatedAt` shape are unverified → NEEDS_CONTEXT if they differ
Rollback note:
  - Whole transaction rolls back on any error; no partial state.
Red flags:
  - Explicit id inserts → STOP

## STOP CONDITIONS
Done when: three scenarios pass, previous migration tests still green
Uncertain when: a satellite table exists that the scan missed (grep `REFERENCES tracker_items`/`tracker_item_id` again and report)
Escalate when: the copy needs `UPDATE` of existing card ids, or the re-scan finds a tracker id stored in a JSON payload

---

### Task 8: Guard, parity assertions, counter repair and write trigger [depends: T7]

## OBJECTIVE
Make the merge run exactly once, verify it, repair counters, and block later writes to `tracker_items`.

Steps:
1. Write failing test for: "Re-run after go-live is a no-op"
   Test file: `server/src/db/work-item-merge-guard.integration.test.ts`
   Level: integration
   Test intent: Given a database where the merge already ran and a user then edited a migrated item's title and created a new item / When the migration runs again / Then the block is skipped, nothing is copied twice, the edit and new item are untouched, and no assertion runs
   Exercise through: running the migration SQL a second time
   Test doubles: none
   Expected RED: the copy runs again (duplicate rows or unique violation)
2. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/db/work-item-merge-guard.integration.test.ts`
3. Wrap copy and assertions in `IF EXISTS (SELECT 1 FROM tracker_items WHERE migrated_to_id IS NULL) THEN ... END IF`. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "feat(db): make tracker merge run once"`.
4. Write failing test for: "Any parity mismatch rolls everything back"
   Test file: same
   Level: integration
   Test intent: Given a pre-merge fixture and a temporary AFTER INSERT trigger on `card_labels` that raises (so the failure happens inside the same transaction after rows were copied) / When the merge SQL runs through `applySchema(client)` on one dedicated client / Then it rejects, and from a SECOND connection to the same scratch schema every `tracker_items.migrated_to_id` is NULL and no copied card exists (rollback observed from outside, not by the test's own ROLLBACK)
   Exercise through: `applySchema(client)`; observation through a second client
   Test doubles: none; the sabotage trigger is created in test setup and dropped in teardown
   Expected RED: the block commits despite the failure, or the copied cards remain
5. Run test — verify FAIL (same command). Add assertions scoped to the rows being migrated (counts, per-row title/status/project/phase/dates/version equality, orphan checks for `card_labels`, `card_assignees`, `card_events`, `focus_sessions`). Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "feat(db): add parity assertions to tracker merge"`.
6. Write failing test for: "Counter repair"
   Test file: same
   Level: integration
   Test intent: Given a workspace whose counter is below its max key (including a soft-deleted card) / When the merge runs / Then `tracker_key_counter` is at least the max key in every workspace, and the next allocated key is max + 1
   Exercise through: SQL after `migrate()`, then `allocateWorkItemKey`
   Test doubles: none
   Expected RED: counter unchanged
7. Run test — verify FAIL (same command). Add `GREATEST(counter, MAX(key_number))` repair for all workspaces. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "feat(db): repair key counters during merge"`.
8. Write failing test for: "Late-write trigger"
   Test file: same
   Level: integration
   Test intent: Given the merge has run on a database that had tracker rows (the trigger exists only when at least one row has `migrated_to_id` set) / When `INSERT INTO tracker_items` is attempted, then `UPDATE` and `SELECT` on `tracker_items`, then `applySchema(client)` again / Then the insert raises, update and select work, and the second run does not fail on duplicate trigger creation
   Exercise through: raw SQL and `applySchema(client)`
   Test doubles: none
   Expected RED: the insert succeeds
9. Run test — verify FAIL (same command). Add a conditional `BEFORE INSERT` trigger created only if absent AND at least one `tracker_items` row has `migrated_to_id` set. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "feat(db): block late tracker inserts after merge"`.
10. Write failing test for: "Fresh or empty database gets no trigger"
   Test file: `server/src/db/work-item-merge-guard.integration.test.ts`
   Level: integration
   Test intent: Given a fresh scratch schema with no tracker rows / When `applySchema(client)` runs / Then the migration succeeds, no trigger exists on `tracker_items`, and a fixture can still insert into `tracker_items` (so older integration fixtures keep working until they are rewritten in T9-T12)
   Exercise through: `applySchema(client)` then a raw insert
   Test doubles: none
   Expected RED: the trigger is created unconditionally, so the insert raises
11. Run test — verify FAIL (same command). Make trigger creation conditional as in step 9 (if step 9 already does, record this as a labeled regression guard and prove it can fail by removing the condition). Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "test(db): pin trigger conditions for empty databases"`.
12. Write failing test for: "Partially migrated state only processes the remaining rows"
   Test file: same
   Level: integration
   Test intent: Given a database where 2 of 5 tracker rows already have `migrated_to_id` (interrupted earlier state, with their cards present) and 3 do not / When the merge SQL runs / Then only the 3 remaining rows are copied, the first 2 cards are untouched, assertions are scoped to the 3 rows, and a second run is a no-op
   Exercise through: `applySchema(client)` on a hand-built fixture
   Test doubles: none
   Expected RED: the block copies all 5 rows (duplicates) or skips entirely; if the step 3 guard already makes it pass, record this as a labeled regression guard and prove it can fail by temporarily removing the `migrated_to_id IS NULL` filter
13. Run test — verify the outcome above. Scope the copy and assertions to rows with `migrated_to_id IS NULL`. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "fix(db): resume partially migrated tracker rows safely"`.

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Story 1 Rule 2; Design Decision; Implementation Notes (assertions scoped to migrated rows; trigger created after the block); Appendix B.9
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: deep
Justification: this is the safety mechanism; a mistake either crash-loops production on every restart or lets bad data through.

## SANDWICH CONTEXT
[CRITICAL: Assertions and the copy run ONLY while at least one tracker row has `migrated_to_id IS NULL`; whole-table comparisons are forbidden because users edit after go-live and the next restart would crash-loop.]
You are implementing the guard for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B
Files in scope: server/src/db/work-item-merge.sql, server/src/db/work-item-merge-guard.integration.test.ts
Available after: T7
Architecture rule: single `migrate.ts` transaction; `RAISE EXCEPTION` aborts the container start (entrypoint `set -e`)
[RESTATE: Assertions only on rows being migrated; skip entirely when none remain.]

## DELIVERABLE
Given the merge already ran, When migration runs again, Then it is skipped and user edits survive
Given a parity mismatch, When migration runs, Then it raises and all changes roll back
Given a counter below the max key, When the merge finishes, Then counter >= max key and the next key is max + 1
Given the merge has run on data, When an insert into tracker_items is attempted, Then it raises and later runs still succeed
Given an empty database, When migrated, Then no trigger exists and fixtures can still seed tracker_items
Given a partially migrated state, When the merge runs, Then only unmigrated rows are processed

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Error messages begin with `work-item-merge:` and name the workspace/key
  - Trigger creation is conditional and droppable with the table
Must-not-have:
  - Whole-table equality checks; a trigger that blocks UPDATE/SELECT
Open question risks:
  - Whether the key-backfill block at `schema.sql:816-869` interacts with the counter repair on a re-run is unverified → report
Rollback note:
  - If a failure occurs inside the block: transaction rolls back; redeploy the old image (no restore).
Red flags:
  - Assertion runs when no un-migrated rows exist → STOP

## STOP CONDITIONS
Done when: three scenarios pass and all earlier migration tests green
Uncertain when: the sabotage technique is not possible inside the test DB
Escalate when: rollback of `DROP NOT NULL` cannot be proven

---

### Task 9: Merged-table reads and the unified list [depends: T6, T8]

## OBJECTIVE
Serve Tracker and unified reads from the merged table and remove the two-table merge.

Steps:
1. Write failing test for: "Reference workspace reads identically after merge"
   Test file: `server/src/lib/work-items.merged.integration.test.ts`
   Level: integration
   Test intent: Given a workspace with 25 board cards and 53 column-less cards (inserted directly) plus one soft-deleted column-less card / When `listMergedWorkItems` (renamed internally to a single query) and `GET /work-items` run / Then 78 items are returned, `source` is `tracker` when `column_id` is NULL else `board`, keys are unchanged, the soft-deleted item is absent, and the response shape matches today's fixtures
   Exercise through: `listMergedWorkItems` and the `/work-items` route
   Test doubles: none
   Expected RED: the function still reads `tracker_items`
2. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/lib/work-items.merged.integration.test.ts`
3. Rewrite `selectTrackerItemRows`/`selectBoardWorkItemRows` consumers in `lib/work-item-response.ts` (`:84-153`, `:387-480`) and `modules/tracker/tracker-item-read.ts` to a single query over `cards`; replace the tracker-wins dedup with a `ORDER BY created_at, id`; express the non-default-board exclusion as an explicit `(column_id IS NULL OR board_id IS NULL)` predicate via a LEFT JOIN on `columns`. Keep response shapes. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "refactor(server): read work items from one table"`.
4. Write failing test for: "Unified feed shows each event once"
   Test file: same
   Level: integration
   Test intent: Given copied tracker events in `card_events` (item and item-less) and an untouched `tracker_events` table / When the unified feed (`work-item-events.ts:270-295`) loads / Then each event appears once with `source` derived from `column_id` (NULL → tracker), item-less events are retained, and `tracker_events` is not read
   Exercise through: the unified activity function/route
   Test doubles: none
   Expected RED: events appear twice or item-less events vanish (`card_id IS NOT NULL` at `:276`)
5. Run test — verify FAIL (same command). Rewrite the UNION to read only `card_events`. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "refactor(server): unify activity feed on one event table"`.
6. Write failing test for: "Non-default-board cards stay excluded"
   Test file: same
   Level: integration
   Test intent: Given 18 live cards in columns with non-NULL `board_id` and 25 on the default board / When `GET /work-items` runs / Then the 18 are absent and the default-board count is unchanged
   Exercise through: the `/work-items` route
   Test doubles: none
   Expected RED: if the single-query rewrite lost the `board_id IS NULL` predicate, the 18 appear; if step 3 already preserved it, record this as a labeled regression guard and prove it can fail by removing the predicate temporarily
7. Run test — verify the outcome above. Fix the predicate if needed. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "test(server): pin non-default-board exclusion"`.
8. Write failing test for: "updatedAt falls back to the computed value"
   Test file: same
   Level: integration
   Test intent: Given one column-less item with stored `updated_at` and one board card with NULL `updated_at` / When listed / Then the first returns its stored value and the second returns `computeCardUpdatedAt` output
   Exercise through: the `/work-items` route
   Test doubles: none
   Expected RED: the serializer ignores the stored column
9. Run test — verify FAIL (same command). Implement the fallback. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "feat(server): serialize stored updated_at with computed fallback"`.
10. Write failing test for: "Key-collision check ignores migrated rows"
   Test file: `server/src/core/work-item-debt.integration.test.ts` (new; the existing `work-item-debt.test.ts` is a chained query-builder mock and cannot express this scenario)
   Level: integration (real Postgres, scratch schema via `scratch-schema-test-support.ts`)
   Test intent: Given a `tracker_items` row with `migrated_to_id` set and a card with the same `key_number` in one workspace / When `findKeyCollisions` (`core/work-item-debt.ts`) runs / Then it reports 0 collisions; and given an UNMIGRATED tracker row with the same key as a card / Then it reports 1
   Exercise through: exported `findKeyCollisions`
   Test doubles: none beyond the file's existing fixtures
   Expected RED: after the merge every migrated row collides with its copied card, so the first case reports collisions
11. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/core/work-item-debt.integration.test.ts`. Exclude `migrated_to_id IS NOT NULL` rows in the query, and in the same commit add one extra `.where` level to the mock chains in the existing `work-item-debt.test.ts` so those mapping tests keep passing (`npm run test --workspace=server -- src/core/work-item-debt.test.ts`). Verify PASS, refactor while green (re-run the same commands), then commit: `git commit -m "fix(server): ignore migrated rows in key-collision check"`.

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Story 2 (HTTP contract, activity feed, non-default boards); Appendix B.1; Appendix C
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: two large functions in the kernel with exact response-shape preservation; keep each file <= 300 lines (extract while touching).

## SANDWICH CONTEXT
[CRITICAL: Response shapes and `source` semantics must stay identical for the unchanged client; `GET /work-items` must still exclude cards on non-default boards.]
You are implementing merged reads for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B
Files in scope: lib/work-item-response.ts, lib/work-item-events.ts, modules/tracker/tracker-item-read.ts, core/work-item-debt.ts, core/work-item-debt.test.ts (mock chain only), core/work-item-debt.integration.test.ts (new), new test file
Available after: T6, T8
Architecture rule: 300-on-touch (work-item-response.ts is 480 lines: extract in the same PR); `.js` extensions
[RESTATE: Same shapes, same `source`, non-default boards excluded.]

## DELIVERABLE
Given 25 board + 53 column-less cards and one soft-deleted item, When listed, Then 78 items with unchanged keys and shapes
Given merged events, When the unified feed loads, Then each event once, item-less retained
Given 18 cards on non-default boards, When listed, Then they remain excluded
Given NULL or stored `updated_at`, When serialized, Then stored value or the computed fallback
Given migrated tracker rows that share keys with their copied cards, When the collision check runs, Then it reports 0 (only unmigrated overlaps count)

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Existing `lib/work-items.test.ts` and `lib/work-item-events.test.ts` adapted, not deleted
Must-not-have:
  - Reading `tracker_items` or `tracker_events` in `work-item-response.ts`, `work-item-events.ts` or `tracker-item-read.ts` after this task (`core/work-item-debt.ts` keeps reading `tracker_items` until T21); removing `check:key-collisions` (T21)
Open question risks:
  - `updatedAt` fallback semantics unverified for edge rows → NEEDS_CONTEXT
Rollback note:
  - Code ships only at cutover; revert PR.
Red flags:
  - Any response-shape difference against current fixtures → STOP

## STOP CONDITIONS
Done when: two scenarios pass and the existing work-item tests (updated) are green
Uncertain when: the non-default-board predicate changes counts
Escalate when: shape drift is unavoidable

---

### Task 10: Tracker item writes on the merged table [depends: T1, T9]

## OBJECTIVE
Create, update, delete, reorder, status-change, labels and assignees for Tracker items operate on `cards` rows with NULL `column_id`, still emitting tracker-style activity.

Steps:
1. Write failing test for: "Create and update a Tracker item on the merged table"
   Test file: `server/src/modules/tracker/tracker-writes.merged.integration.test.ts`
   Level: integration (Express routes)
   Test intent: Given a workspace / When `POST /tracker/items` (and `/work-items`) creates an item and `PATCH` changes its title with the correct `version` / Then a `cards` row with NULL `column_id` is created with a key from the shared allocator, `version` increments, a stale `version` returns 409, one `card_events` row per mutation is written via `recordActivity` with `event_type` `tracker_item_created`/`tracker_item_updated`, and `tracker_items` is not written
   Exercise through: the HTTP routes
   Test doubles: none
   Expected RED: rows are written to `tracker_items`
2. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/modules/tracker/tracker-writes.merged.integration.test.ts`
3. Rewrite create/update (`tracker-item-create.ts`, `-create-queries.ts`, `-update.ts`), switch `recordTrackerActivity` callers to `recordActivity` (keep the `tracker_item_*` type strings; `scripts/check-event-write-routing.mjs` keeps its per-file `ALLOWLIST` of `lib/helpers.ts`, `lib/tracker-activity.ts` and `db/seed.ts` unchanged until T21 removes the `lib/tracker-activity.ts` entry together with the file). Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "refactor(tracker): write items to the merged table"`.
4. Write failing test for: "Soft-delete and reorder"
   Test file: same
   Level: integration
   Test intent: Given three column-less items / When one is soft-deleted and another reordered with `beforeKey`/`afterKey` / Then `deleted_at` is set, `plan_position` changes between its neighbors, board `position` is never read for ordering, and each mutation writes one event via `recordActivity`
   Exercise through: the HTTP routes
   Test doubles: none
   Expected RED: routes still target tracker tables
5. Run test — verify FAIL (same command). Rewrite `tracker-item-delete.ts`, `tracker-item-reorder.ts`. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "refactor(tracker): move delete and reorder to the merged table"`.
6. Write failing test for: "Status change"
   Test file: same
   Level: integration
   Test intent: Given a column-less item in Backlog / When its status is changed to In Progress and then to a canceled status / Then `status_id` and `completed_at` follow the existing tracker rules, `version` increments, stale `version` returns 409, and no `column_id` is assigned
   Exercise through: the HTTP route
   Test doubles: none
   Expected RED: the route still targets tracker tables
7. Run test — verify FAIL (same command). Rewrite `server/src/core/tracker-item-status-change.ts` (its real path; `updateTable("tracker_items")` is at `:129`). Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "refactor(tracker): move status changes to the merged table"`.
8. Write failing test for: "Labels and assignees"
   Test file: same
   Level: integration
   Test intent: Given a column-less item / When a label and an assignee are added then removed / Then `card_labels` and `card_assignees` change accordingly and nothing is written to tracker junction tables
   Exercise through: the HTTP routes
   Test doubles: none
   Expected RED: routes still write `tracker_item_labels`/`tracker_item_assignees`
9. Run test — verify FAIL (same command). Rewrite `tracker-item-labels.ts` and `lib/tracker-assignees.ts`. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "refactor(tracker): move labels and assignees to the merged table"`.
10. Write failing test for: "Promote through PATCH is rejected"
   Test file: same
   Level: integration
   Test intent: Given a column-less item / When `PATCH /work-items/:key` includes `column_id` / Then the response is 400 with `{ error, fieldErrors }` via `sendValidationError` and the row is unchanged
   Exercise through: the HTTP route
   Test doubles: none
   Expected RED: the field is ignored or accepted
11. Run test — verify FAIL (same command). Add the validation. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "fix(tracker): reject column_id on work-item patch"`.
12. Run `npm run check:event-write-routing` and `npm run check:mutation-routing`; both must pass. Do NOT delete `recordTrackerActivity` or `lib/tracker-activity.ts` (T11 may still use it; T21 deletes it).

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Stories 1–2; Appendix B.5; Appendix C ("Tracker-only infrastructure"); CLAUDE.md activity-logging rule
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: deep
Justification: ten-plus files with locking, activity and ordering semantics; must keep optimistic locking and event routing guards green.

## SANDWICH CONTEXT
[CRITICAL: Every mutation calls `recordActivity` (only `recordActivity` may insert into `card_events`); stale writes return HTTP 409; a Tracker item (column-less) is never given a `column_id`.]
You are implementing Tracker writes for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B
Files in scope: modules/tracker/tracker-item-{create,create-queries,update,delete,reorder,labels}.ts, core/tracker-item-status-change.ts, lib/tracker-activity.ts, lib/tracker-assignees.ts, test file
Available after: T9
Architecture rule: validation through `validators/http.ts`; 300-on-touch; `.js` extensions
[RESTATE: recordActivity everywhere, 409 on stale, no column_id for Tracker items.]

## DELIVERABLE
Given create/update, When called, Then rows land in cards with correct version and events
Given delete and reorder, When called, Then deleted_at and plan_position change
Given a status change, When called, Then status_id, version and 409 behavior follow the old rules
Given labels and assignees, When changed, Then merged junctions change
Given column_id in a PATCH body, When called, Then 400 and no change

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Event type strings unchanged (`tracker_item_created/updated/deleted`, `tracker_vocabulary_created`)
Must-not-have:
  - Writes to `tracker_items`/`tracker_events` (trigger would raise); promote flow
Open question risks:
  - The `tracker_project_*` call sites (T11) may use a different writer → NEEDS_CONTEXT
Rollback note:
  - Code ships only at cutover; revert PR.
Red flags:
  - A `card_events` insert outside `recordActivity` → STOP

## STOP CONDITIONS
Done when: both scenarios pass, both check scripts pass, existing tracker tests adapted and green
Uncertain when: ordering semantics for `plan_position` ties are unclear
Escalate when: a route cannot preserve its 409 behavior or `tracker-item-create.ts` conflicts with T1 changes

---

### Task 11: Project, phase, vocabulary and member-removal paths [depends: T9]

## OBJECTIVE
Move remaining tracker-table users (project/phase delete and queries, vocabularies, member removal) onto the merged table.

Steps:
0. Read-only scan first: find every writer of `tracker_project_*`/`tracker_phase_*` events (`tracker-project-serialize.ts:69`, `tracker-phase-queries.ts:21,165`, `tracker-project-delete.ts:92`). Rewrite them to call `recordActivity` directly (T10 keeps `recordTrackerActivity` alive, T21 deletes it). Report the call-site list.
1. Write failing test for: "Project and phase deletion release merged items"
   Test file: `server/src/modules/tracker/tracker-structure.merged.integration.test.ts`
   Level: integration
   Test intent: Given a project and phase referenced by column-less items and board cards / When the project or phase is deleted / Then `cards.project_id`/`phase_id` are cleared for both kinds, and exactly one project/phase event is written via `recordActivity` with the original `tracker_project_*`/`tracker_phase_*` type, `workspace_id` set and NULL `card_id`
   Exercise through: the project/phase routes (`tracker-project-delete.ts:43,68,75,92`, `tracker-phase-queries.ts:21,135,151,165`)
   Test doubles: none
   Expected RED: queries still touch `tracker_items`
2. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/modules/tracker/tracker-structure.merged.integration.test.ts`
3. Rewrite those sites and `tracker-project-serialize.ts:69`, `tracker-vocabularies.ts:127`. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "refactor(tracker): move project and phase queries to the merged table"`.
4. Write failing test for: "Removing a workspace member clears merged assignments"
   Test file: same
   Level: integration
   Test intent: Given a member assigned to board cards and column-less items / When the member is removed (`lib/helpers.ts:428-443`) / Then assignments disappear from `card_assignees` for both kinds and nothing is left in tracker assignee tables
   Exercise through: the member-removal function/route
   Test doubles: none
   Expected RED: helper still deletes from `tracker_item_assignees`
5. Run test — verify FAIL (same command). Rewrite the helper (extract tracker-specific code out of `helpers.ts` if the file exceeds 300 lines: convention requires it on touch). Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "refactor(server): remove members from merged assignments"`.

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Appendix C (tracker-project-delete, tracker-phase-queries, helpers.ts); Story 1 Rule 3
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: five files, mostly mechanical query changes, but event semantics (item-less events) matter.

## SANDWICH CONTEXT
[CRITICAL: Project/phase events keep their `tracker_*` type, carry `workspace_id`, and have NULL `card_id`; all writes go through `recordActivity`.]
You are implementing structure-path moves for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B
Files in scope: modules/tracker/{tracker-project-delete,tracker-project-serialize,tracker-phase-queries,tracker-vocabularies}.ts, lib/helpers.ts, test file
Available after: T9
Architecture rule: 300-on-touch; `.js` extensions
[RESTATE: recordActivity, NULL card_id, original types.]

## DELIVERABLE
Given project/phase deletion, When executed, Then merged items are released and one event is written
Given member removal, When executed, Then merged assignments are removed

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Exact call sites for `tracker_project_*` writers identified and reported
Must-not-have:
  - Touching T10 files
Open question risks:
  - Whether project/phase events use `recordTrackerActivity` is unverified → NEEDS_CONTEXT
Rollback note:
  - Revert PR (ships at cutover).
Red flags:
  - Direct insert into `card_events` → STOP

## STOP CONDITIONS
Done when: both scenarios pass, existing project/phase tests adapted
Uncertain when: `helpers.ts` extraction affects imports across many files
Escalate when: extraction touches more than 5 importers

---

### Task 12: My-work, focus and realtime ids on the merged table [depends: T9, T5]

## OBJECTIVE
Move my-work (list, detail, hydration, mark-done tracker branch), focus lookups and SSE payloads to the merged table with new ids.

Steps:
1. Write failing test for: "My Work lists merged items without duplicates"
   Test file: `server/src/modules/my-work/my-work.merged.integration.test.ts`
   Level: integration
   Test intent: Given a user assigned to board cards and column-less items / When My Work list and detail load / Then each item appears once, `source` is derived from `column_id`, labels and assignees hydrate from the merged junctions, and the shadow-dedup `NOT EXISTS` over tracker tables is gone
   Exercise through: `my-work-data-source-list.ts:107-163`, `-detail.ts:34-47`, `my-work-response-hydration.ts:38,161,269-276`
   Test doubles: none
   Expected RED: queries still reference tracker tables
2. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/modules/my-work/my-work.merged.integration.test.ts`
3. Rewrite those sites and the tracker branch of `core/my-work-mark-done.ts:113`. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "refactor(my-work): read assigned items from the merged table"`.
4. Write failing test for: "Focus sessions and SSE carry the new id"
   Test file: same
   Level: integration
   Test intent: Given a migrated focus session with `task_source='tracker'` / When it is loaded (`focus-session-repo.ts:226-262`, `focus-session-inputs.ts:9-13,31,48-49`) and a Tracker item is updated / Then `findTask('tracker', id)` resolves via `cards` where `column_id IS NULL`, `buildReturnPath` still returns `/tracker/<key>`, and the SSE payload (`realtime/types.ts:53`, `my-work-router.ts:252`) carries the new numeric id as `trackerItemId`
   Exercise through: repo functions and the my-work router publisher
   Test doubles: stub the Redis/SSE publisher with the existing fake used by realtime tests
   Expected RED: lookup queries `tracker_items`
5. Run test — verify FAIL (same command). Rewrite. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "refactor(focus): resolve tracker tasks from the merged table"`.

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Story 1 (focus), Story 3 (forced reload), Appendix B.4; Appendix C (id-only references; client files compare `trackerItemId`)
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: several read paths and an id contract used by six client files; must not require client edits.

## SANDWICH CONTEXT
[CRITICAL: The server must emit the NEW ids everywhere (API, SSE, focus); the client is not edited and must keep working.]
You are implementing my-work/focus/realtime moves for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B
Files in scope: the my-work, focus, realtime-type files above, core/my-work-mark-done.ts (tracker branch), test file
Available after: T9, T5
Architecture rule: no Redis/SSE topology change
[RESTATE: New ids everywhere; client unchanged.]

## DELIVERABLE
Given merged items, When My Work loads, Then each once with correct source
Given a migrated focus session and an item update, Then lookups and SSE use new ids and the return path is unchanged

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `my-work` URLs still use identity (workspace, source, key)
Must-not-have:
  - Client edits beyond typecheck; board branch changes (T5)
Open question risks:
  - Query shapes in my-work and the scheduler were not fully inspected → NEEDS_CONTEXT
Rollback note:
  - Revert PR (ships at cutover).
Red flags:
  - Client file modified → STOP

## STOP CONDITIONS
Done when: both scenarios pass and existing my-work/focus tests adapted
Uncertain when: the SSE fake cannot assert payload ids
Escalate when: the client needs a code change

---

### Task 13: Merged-table integration verification [depends: T10, T11, T12]

## OBJECTIVE
Prove the reference-workspace scenarios end to end on the merged schema (cross-unit verification).

Steps:
1. Write failing test for: "Reference workspace is preserved"
   Test file: `server/src/routes/work-item-merged.integration.test.ts`
   Level: integration (merge on a scratch schema, then HTTP against an app bound to that schema)
   Test intent: Given a pre-merge fixture of 25 board cards (6 in progress, 16 done, columns with WIP) and 53 tracker items with projects, phases, labels, assignees, events and one focus session / When the full migration runs and then `GET /work-items`, `GET /board`, `/activity`, unified feed, My Work and flow metrics are called / Then Tracker lists 78, Board 25 with header counts 6 in progress and 16 done, the key set equals the pre-merge set, every tracker item's fields and relations match, and `/cards/:id` of a tracker item is 404
   Exercise through: `applySchema(client)` on a scratch schema (pre-merge fixtures seeded first), then the HTTP routes of an app whose pool uses that schema: reuse the pattern in `routes/work-item-unified.integration.test.ts`; if none exists, extend `scratch-schema-test-support.ts` with a `createScratchApp()` that sets the schema through the connection `options` before the app modules are imported
   Test doubles: none
   Expected RED: this is an integration gate over finished tasks, so it passes at branch head; prove it can fail by temporarily reverting one task's read change (e.g. the T9 single-query read) and confirming RED, then restore
2. Run test — verify the temporary-sabotage RED, then PASS at branch head: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/work-item-merged.integration.test.ts`
3. Write failing test for: "Restart after go-live and late writes"
   Test file: same
   Level: integration
   Test intent: Given the merged DB after user edits / When the migration runs again and a legacy insert into `tracker_items` is attempted / Then the run is a no-op and the insert raises
   Exercise through: `applySchema(client)` twice and a raw insert
   Test doubles: none
   Expected RED: passes only when T8 is in place (regression guard on the combined branch)
3b. Run the first test file again after adding step 3's test: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/work-item-merged.integration.test.ts`; all cases pass.
4. Write failing test for: "One allocator across both entry points"
   Test file: `server/src/routes/work-item-merged-allocator.integration.test.ts`
   Level: integration
   Test intent: Given one workspace / When a card is created through the board create route and an item through the Tracker create route, then another card through the agent board-create dependency / Then keys are consecutive and unique, the unique index holds, and each creation wrote one event
   Exercise through: the HTTP routes and the exported agent create dependency (`modules/agent/service-deps-board.ts:187`)
   Test doubles: none
   Expected RED: passes at branch head by design; prove it can fail by temporarily giving the Tracker create path its own counter update, confirm RED, then restore
5. Run test — verify the temporary-sabotage RED, then PASS: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/work-item-merged-allocator.integration.test.ts`
6. Write failing test for: "A brand-new workspace works after the merge"
   Test file: `server/src/routes/work-item-merged-workspace.integration.test.ts`
   Level: integration
   Test intent: Given a merged scratch schema whose late-write trigger exists (fixture seeded with tracker rows before the merge) / When a new workspace is created through the workspace create route (including onboarding, vocabulary seed and any template path) and a first Tracker item and a first board card are created in it / Then every call succeeds, the new workspace gets consecutive keys, and no row was written to `tracker_items`, `tracker_item_labels`, `tracker_item_assignees` or `tracker_events`
   Exercise through: the HTTP routes of the scratch app
   Test doubles: none
   Expected RED: passes at branch head by design; prove it can fail by temporarily making the workspace create path insert a tracker row, confirm the trigger raises (RED), then restore
7. Run test — verify the temporary-sabotage RED, then PASS: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/work-item-merged-workspace.integration.test.ts`; refactor while green (re-run the same command), then commit: `git commit -m "test(server): verify new workspaces after the merge"`.
8. Write failing test for: "No writer to the old tracker tables remains"
   Test file: `server/src/routes/work-item-merged-writers.test.ts`
   Level: unit (source contract)
   Test intent: Given the non-test sources under `server/src` / When scanned as text / Then, ignoring the single definition file `server/src/lib/tracker-activity.ts` (which still contains its own `insertInto("tracker_events")` until T21), there is no `insertInto`/`updateTable`/`deleteFrom` on `tracker_items`, `tracker_item_labels`, `tracker_item_assignees` or `tracker_events`, and no call to `recordTrackerActivity(` anywhere else; and `scripts/check-event-write-routing.mjs` allowlists no file other than `lib/helpers.ts`, `lib/tracker-activity.ts` and `db/seed.ts`
   Exercise through: `fs` directory walk and `fs.readFileSync` (the scan strips comments before matching, so a mention in a comment is not a hit)
   Test doubles: none
   Expected RED: passes at branch head by design; prove it can fail by temporarily leaving one old writer in place, confirm RED, then restore
9. Run test — verify the temporary-sabotage RED, then PASS: `npm run test --workspace=server -- src/routes/work-item-merged-writers.test.ts`; refactor while green (re-run the same command), then commit: `git commit -m "test(server): pin removal of old tracker writers"`.
10. Run `npm run test`, `npm run typecheck`, `npm run lint`, `make check`, `npm run check:event-write-routing`; all green. Commit only if there are fixture tidy-ups: `git commit -m "test(server): verify merged work items end to end"`.

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Story 1 scenario "Reference production workspace is preserved" (anonymized as reference workspace), Acceptance Criteria rules "Data is preserved", "Run-once safety", "Client contract unchanged"
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: integration seam over T7–T12; no production code except small fixes found.

## SANDWICH CONTEXT
[CRITICAL: Do not weaken any assertion to make the test pass; a failing seam goes back to its owning task.]
You are implementing the end-to-end verification for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B
Files in scope: the four new test files and shared fixtures under the same folder (no production file changes except one-line fixes that you report)
Available after: T10, T11, T12
Architecture rule: tests <= 300 lines per file (split by describe if needed)
[RESTATE: No weakened assertions; report failing seams.]

## DELIVERABLE
Given the reference fixture, When migrated, Then 78/25/6/16, keys, fields, relations and 404 behavior hold
Given a restart and a legacy insert, Then no-op and raise
Given board, Tracker and agent creation in one workspace, Then keys are consecutive and unique
Given a brand-new workspace after the merge, When it is created and used, Then everything succeeds and no old tracker table is written
Given the server sources, When scanned, Then no writer to the old tracker tables or caller of `recordTrackerActivity` remains

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Fixture anonymized (no customer names)
Must-not-have:
  - Production code changes beyond one-line fixes (report them)
Open question risks:
  - none
Rollback note:
  - n/a (tests only)
Red flags:
  - A skipped test or loosened assertion → STOP

## STOP CONDITIONS
Done when: both scenarios pass; `npm run test`, typecheck, lint, `make check` green
Uncertain when: fixture cannot reproduce the header counts
Escalate when: a seam failure needs design change

---

### Task 14: BACKGROUND_JOBS switch [prereq]

## OBJECTIVE
Add one env switch that pauses schedulers, agent workers, latency reporter and Redis subscribers so the new server can run behind maintenance without side effects.

Steps:
1. First, grep `server/src/index.ts`, `modules/notifications/scheduler.ts`, `core/work-item-latency.ts:50` and `rg "setInterval|subscribe\("` to list every background starter; record the list in the task report.
2. Write failing test for: "BACKGROUND_JOBS=off starts no timers or subscribers"  (the function lives in the new import-safe module `server/src/background-jobs.ts`; importing it must not start the HTTP listener, the pool or Redis)
   Test file: `server/src/background-jobs.test.ts`
   Level: unit
   Test intent: Given `BACKGROUND_JOBS=off` / When the exported `startBackgroundJobs()` (extracted from `index.ts`) runs with fake timers / Then no scheduler, cleanup, latency reporter or Redis subscription is created; with the variable unset or `on`, all are created as today
   Exercise through: `startBackgroundJobs()` imported from `background-jobs.ts`; observation: `vi.getTimerCount()` for timers plus module-boundary spies on the scheduler starter, latency reporter starter and Redis subscribe
   Test doubles: fake timers (`vi.useFakeTimers`), Redis client mocked at the module boundary (`vi.mock("./db/redis.js")`), starters spied via `vi.mock`; do not mock `startBackgroundJobs`
   Expected RED: `startBackgroundJobs` is not exported
3. Run test — verify FAIL: `npm run test --workspace=server -- src/background-jobs.test.ts`
4. Extract the starters into `server/src/background-jobs.ts`, guarded by `process.env.BACKGROUND_JOBS !== "off"`, and call it from `index.ts`. Verify PASS, refactor while green (re-run the same command), run `npm run typecheck --workspace=server`, then commit: `git commit -m "feat(server): add BACKGROUND_JOBS switch"`.
5. Write failing test for: "HTTP and SSE stay active under off"
   Test file: `server/src/background-jobs.test.ts` (second `describe`, source contract)
   Level: unit (source contract)
   Test intent: Given the sources of `index.ts` and `background-jobs.ts` / When read as text / Then `BACKGROUND_JOBS` appears only in `background-jobs.ts`, and `index.ts` still calls `listen` and mounts the SSE routes unconditionally
   Exercise through: `fs.readFileSync`
   Test doubles: none
   Expected RED: none expected after step 4; this is a labeled regression guard (today `index.ts` has no `BACKGROUND_JOBS` reference and already calls `listen` and mounts SSE). Prove it can fail: temporarily add a `BACKGROUND_JOBS` check inside `index.ts` (or wrap `listen` in a condition), confirm RED, then restore
6. Run test — verify the temporary-sabotage RED, then PASS on the restored code (`npm run test --workspace=server -- src/background-jobs.test.ts`), refactor while green (re-run the same command), then commit: `git commit -m "test(server): pin background-jobs gating"`.

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Story 3; Appendix B.7 (`off` pauses scheduler, agent workers and Redis subscribers; default on)
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: touches startup wiring; behavior with the switch unset must be byte-identical to today.

## SANDWICH CONTEXT
[CRITICAL: With the variable unset, startup behavior must be unchanged; with `off`, no background work may start.]
You are implementing the background-jobs switch for the cutover.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B (cutover tooling)
Files in scope: server/src/background-jobs.ts (new), server/src/index.ts, modules/notifications/scheduler.ts, core/work-item-latency.ts (only if needed; if T12 also touches it, whichever merges first wins and the other rebases), new test
Available after: none (independent)
Architecture rule: 300-on-touch; `.js` extensions
[RESTATE: Unset = unchanged; off = nothing starts.]

## DELIVERABLE
Given `BACKGROUND_JOBS=off`, When the server starts, Then no background starter runs
Given unset/on, Then all start as before

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Report lists every starter found
Must-not-have:
  - Redis/SSE topology changes; disabling the HTTP/SSE endpoints
Open question risks:
  - Where the notification scheduler is started was not found by the scan → NEEDS_CONTEXT
Rollback note:
  - Revert commit.
Red flags:
  - Behavior difference with the variable unset → STOP

## STOP CONDITIONS
Done when: both scenarios pass and typecheck green
Uncertain when: a worker starts from a module import side effect
Escalate when: a starter cannot be gated without refactoring

---

### Task 15: Maintenance mode config for camel-ggf nginx (local files) [prereq]

## OBJECTIVE
Bring the live `camel-ggf` nginx config onto this machine as local, uncommitted files (one read-only `cat`) and add a flag-file maintenance mode with a local `nginx -t` check. **No remote write happens in this task**; the rehearsal on the host is T25.

[no-tdd — structural task]

Steps:
1. Fetch the live config read-only: `ssh camel-ggf 'cat /etc/nginx/sites-enabled/camel'` (sites-enabled file observed with `server_name <camel host> _;`, `/api/`, `/`, static assets). Save it twice: `deploy/nginx/camel-ggf.conf.live` (never edited) and `deploy/nginx/camel-ggf.conf` (the working copy). Do NOT change behavior yet. This file is host-specific: it stays local and is never committed.
2. Add maintenance mode: flag file `/var/www/camel-maintenance/ON`; when present, `/api/` returns `503` with JSON `{"error":"maintenance"}` and `Retry-After: 600`; `/api/events` (SSE) returns `503`; all other paths serve `deploy/maintenance/index.html` with status 503; `error_page 502 503 504` serves the same page for the camel vhost only. Because the host also runs another app (`pengamatan`) and the vhost has a catch-all `server_name _`, scope every directive to the camel server block and verify the other vhost is untouched.
3. Verify locally: `docker run --rm -v "$PWD/deploy/nginx/camel-ggf.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine nginx -t` (use a local copy with `proxy_pass` upstream stubbed if nginx cannot resolve it).
4. Add these patterns to `.gitignore`: `deploy/*-ggf.sh`, `deploy/nginx/*ggf*`, `deploy/maintenance/`, `deploy/CUTOVER-CHECKLIST.md`. Verify with `git check-ignore -v` on each path (each must print its rule) and `git status --short deploy` must show nothing new. Commit ONLY `.gitignore`: `git commit -m "chore(git): ignore host-specific deploy files"`. Keep a private backup of the ignored files outside the repo.

## REFERENCES LOADED
Spec — Story 3 scenario "Maintenance during the window"; Implementation Notes (maintenance, 502/503/504); Plan Overview (nginx not in repo; no api subdomain on ggf)
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: shared production host with another application; error here affects unrelated users.

## SANDWICH CONTEXT
[CRITICAL: Do not modify any nginx server block other than the camel one; this task performs no remote write (the only remote command is a read-only `cat`).]
You are implementing maintenance mode for the camel-ggf host.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B (cutover tooling)
Files in scope: deploy/nginx/camel-ggf.conf (new, local only), deploy/maintenance/index.html (new, local only), .gitignore (the only committed change)
Available after: none (independent)
Architecture rule: public repo: no secrets, hostnames beyond those already in the repo, or customer names
[RESTATE: Camel server block only; user approval for remote writes.]

## DELIVERABLE
Given the new config, When `nginx -t` runs locally, Then it passes
Given the flag-file location, When read in the config, Then /api returns JSON 503 with Retry-After, SSE returns 503, other paths serve the maintenance page, and 502/503/504 map to the page for the camel server block only
Given a diff of `deploy/nginx/camel-ggf.conf` against the untouched copy `deploy/nginx/camel-ggf.conf.live`, When reviewed, Then only the camel server block differs

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `nginx -t` green locally; an untouched copy of the live file is kept as `deploy/nginx/camel-ggf.conf.live` (local only, matched by the ignore pattern) before any edit, and is the diff baseline and the T25 restore reference
Must-not-have:
  - Changing TLS, upstream or other vhosts; committing secrets
Open question risks:
  - Whether TLS terminates upstream of this nginx is unverified (config listens on 80) → NEEDS_CONTEXT
Rollback note:
  - Nothing was applied to the host; delete the local files, or restore `deploy/nginx/camel-ggf.conf` from `deploy/nginx/camel-ggf.conf.live`.
Red flags:
  - `nginx -t` fails or the diff touches another server block → STOP

## STOP CONDITIONS
Done when: local `nginx -t` green and the diff against `deploy/nginx/camel-ggf.conf.live` touches only the camel server block
Uncertain when: the live config differs from what the repo expects
Escalate when: the captured file shows TLS or upstream settings that need a decision

---

### Task 16: Cutover snapshot and verify script [depends: T13]

## OBJECTIVE
Provide the application-level gate: snapshot what users see before shutdown, verify it against the new code path before reopening.

Steps:
1. Write failing test for: "Verify exits 0 when everything matches"
   Test file: `server/src/scripts/cutover-snapshot.integration.test.ts`
   Level: integration
   Test intent: Given a pre-merge fixture (board cards + tracker items) / When `takeSnapshot` runs with the OLD semantics (SQL over `cards` default-board + `tracker_items`, on a schema that already has the T2 expand columns), then the merge SQL runs through `applySchema(client)`, then `verifySnapshot` runs the NEW code paths (`listMergedWorkItems`, board response, header counts) / Then every workspace matches (keys per workspace, Tracker count, Board count, in-progress and done counts) and `main(["verify", file])` resolves to exit code 0
   Exercise through: exported `takeSnapshot(db)`, `verifySnapshot(db, snapshot)` and `main(argv): Promise<number>` in `scripts/cutover-snapshot.ts` (the CLI wrapper only does `process.exit(await main(process.argv.slice(2)))`)
   Test doubles: none
   Expected RED: the module does not exist
2. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/scripts/cutover-snapshot.integration.test.ts`
3. Implement (minimal) `server/src/scripts/cutover-snapshot.ts` with CLI modes `snapshot <file>` and `verify <file>` (exit 0 only if all workspaces match; print per-workspace diffs otherwise); ensure it is compiled into `dist/scripts/` (same as `check-key-collisions`). Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "feat(server): add cutover snapshot and verify script"`.

4. Write failing test for: "Verify exits 1 naming the altered workspace"
   Test file: same
   Level: integration
   Test intent: Given the same fixture where one card in one workspace is altered between snapshot and verify / When `verifySnapshot` runs / Then exactly that workspace is reported as a mismatch, others match, and `main` resolves to exit code 1
   Exercise through: `verifySnapshot` and `main`
   Test doubles: none
   Expected RED: verify reports success or does not name the workspace
5. Run test — verify FAIL (same command). Implement the per-workspace diff output and exit codes. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "feat(server): report cutover mismatches per workspace"`.

6. Write failing test for: "Snapshot ignores column-less rows and migrated_to_id"
   Test file: same
   Level: integration
   Test intent: Given a post-T24 schema where some `cards` rows have `column_id` NULL and some `tracker_items` have `migrated_to_id` set / When `takeSnapshot` runs / Then it counts only board cards on the default board plus unmigrated tracker rows, so the snapshot of a not-yet-merged database is stable
   Exercise through: `takeSnapshot(db)`
   Test doubles: none
   Expected RED: the snapshot counts column-less rows or migrated rows
7. Run test — verify FAIL (same command). Adjust the snapshot SQL. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "fix(server): keep cutover snapshot on old semantics"`.

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Story 3 "Application-level parity gate"; Rule "Cutover is safe and recoverable"
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: needs to share logic with the merged readers without importing deleted code later.

## SANDWICH CONTEXT
[CRITICAL: `snapshot` must use old-schema SQL only (it runs before the merge); `verify` must use the production code paths, not re-implemented SQL.]
You are implementing the cutover gate for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B (cutover tooling)
Files in scope: server/src/scripts/cutover-snapshot.ts, its test
Available after: T13
Architecture rule: scripts live under `server/src/scripts/`; `.js` imports; <= 300 lines
[RESTATE: Old SQL for snapshot; production paths for verify.]

## DELIVERABLE
Given matching data, When verify runs, Then exit 0
Given one altered workspace, Then exit 1 naming that workspace (separate cycle)

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Snapshot file contains no customer names (workspace ids only)
Must-not-have:
  - Any write to the database
Open question risks:
  - none
Rollback note:
  - n/a (read-only script)
Red flags:
  - Snapshot depends on `migrated_to_id` or other post-merge columns → STOP

## STOP CONDITIONS
Done when: both scenarios pass
Uncertain when: header counts need data not available without the HTTP layer
Escalate when: verify cannot reuse production paths without auth

---

### Task 17: Cutover and restore scripts plus checklist [depends: T14, T15, T16]

## OBJECTIVE
Write the scripted cutover for `camel-ggf` (extending `deploy-ggf.sh`) and a restore script, plus a dated, resumable checklist.

[no-tdd — structural task]

Steps:
1. Create `deploy/cutover-ggf.sh` (`set -euo pipefail`) with ordered, individually re-runnable phases: (a) preflight (disk space, `docker compose ps`, nginx flag path writable, old image id recorded); (b) `pg_dump` custom-format backup to a timestamped path on the host and **verified restorable** by restoring into a scratch database and running a row-count query; abort before any change if either fails; (c) retag the running image `camel-server:pre-merge-<date>` and copy `/var/www/camel` to `/var/www/camel.pre-merge-<date>`; (d) take the snapshot via `docker exec camel-server node dist/scripts/cutover-snapshot.js snapshot <file>`; (e) enable the maintenance flag; stop the server container; (f) build/load the new image (reuse `deploy-ggf.sh` steps) and start with `BACKGROUND_JOBS=off`; migration runs at start; a failing migration leaves the app down behind the maintenance page and prints the redeploy-old-image command; (g) run `verify`; on success restart with jobs on (SSE connections drop with the restart), disable the flag; on failure keep maintenance on and print the restore command; (h) confirm the build id served by `/health` changed (T23 hook makes open tabs reload); write the cutover timestamp and the "Contract not before" date (+14 days) to `deploy/CUTOVER-CHECKLIST.md` output (local copy).
2. Create `deploy/restore-ggf.sh`: restores the backup (path argument), redeploys the retagged old image and old client dist, runs `docker compose up -d`, disables nothing until a health check passes; prints elapsed time since cutover (advisory 15-minute window, not enforced).
3. Create `deploy/CUTOVER-CHECKLIST.md` if it is absent (T25 normally creates it first; it is local only and not in git, so check before assuming), then extend it (no secrets): ordered checklist with checkboxes, the two failure points (inside the DO block: redeploy old image, no restore; after reopening: restore backup, edits since are lost), and the dates.
4. Verify without touching production: `bash -n deploy/cutover-ggf.sh deploy/restore-ggf.sh` and `shellcheck` if available; dry-run mode `--dry-run` prints every command without executing. These files are local only (ignored since T15): do not commit or `git add -f` them; keep a private backup.

## REFERENCES LOADED
Spec — Story 3, Rollback Plan, Appendix B.6–B.8; `deploy/deploy-ggf.sh`, `deploy/docker-compose.ggf.yml`
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: shell with irreversible steps; correctness comes from ordering, abort-before-change, and rehearsal in T18.

## SANDWICH CONTEXT
[CRITICAL: Nothing in this task may be executed against production; scripts are written and statically checked only. The backup must be proven restorable before any change.]
You are implementing cutover tooling for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B (cutover tooling)
Files in scope: deploy/cutover-ggf.sh, deploy/restore-ggf.sh, deploy/CUTOVER-CHECKLIST.md, deploy/docker-compose.ggf.yml (add `BACKGROUND_JOBS: ${BACKGROUND_JOBS:-on}` to the server environment)
Available after: T14, T15, T16
Architecture rule: host-specific files stay local and uncommitted; no secrets; remote commands use `sudo docker` like `deploy-ggf.sh`
[RESTATE: Static checks only; backup verified restorable.]

## DELIVERABLE
Given `--dry-run`, When run, Then every phase prints its commands in order and the script exits 0 without side effects
Given a failing backup verification, Then the script aborts before stopping any service

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Each phase is idempotent or guarded against being run twice
Must-not-have:
  - Remote execution; secrets in the repo; deleting the old image or old client dist
Open question risks:
  - Host user, sudo requirements and disk space on `camel-ggf` unverified → NEEDS_CONTEXT (T18 verifies)
Rollback note:
  - See `restore-ggf.sh`; two documented failure points.
Red flags:
  - Any command that runs remote without `--execute` → STOP

## STOP CONDITIONS
Done when: `bash -n` passes, `--dry-run` output reviewed, checklist complete
Uncertain when: compose service names differ on the host
Escalate when: restore cannot be made one-command

---

### Task 18: Rehearsal on a production dump (main agent only) [depends: T17]

## OBJECTIVE
Prove the whole merge on a copy of production data before the real cutover. **Main agent only, never delegate to a subagent. Requires the user to approve taking and storing a dump.**

[no-tdd — structural task]

Steps:
1. With the user's approval, take a read-only dump from `camel-ggf` (`pg_dump --format=custom` via `docker exec camel-db`) and copy it to a local scratch directory (never into the repo; delete after rehearsal; it contains customer data).
2. Restore into a local Postgres 16 (docker) database; run the old image's migration to establish the baseline; run `cutover-snapshot snapshot`.
3. Build the Phase B branch; run `node dist/db/migrate.js` against the restored copy; run `cutover-snapshot verify`; run the idempotency check (second migrate is a no-op); time each step.
4. Record in the checklist: row counts before/after (workspaces, cards, tracker items, events, labels, assignees), migration duration, and any assertion that fired.
5. Delete the dump and the restored database. Verify: `ls` the scratch directory is empty.
6. Record counts and timings (no names) in `deploy/CUTOVER-CHECKLIST.md`; the file is local only and is not committed.

## REFERENCES LOADED
Spec — Story 3; Appendix D (unverified items); Rollback Plan
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: only rehearsal on real data exercises ids, counters and edge rows that fixtures miss.

## SANDWICH CONTEXT
[CRITICAL: The dump contains customer data: store it only in the scratch directory, never commit or upload it, delete it when done; production access is read-only.]
You are rehearsing the merge for the work-items single-table change.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B
Files in scope: none in the repo except `deploy/CUTOVER-CHECKLIST.md` notes (counts only, no names)
Available after: T17
Architecture rule: read-only against production
[RESTATE: Dump stays in scratch and is deleted.]

## DELIVERABLE
Given a production dump, When the Phase B migration runs on the copy, Then verify exits 0, the second run is a no-op, and timings are recorded
Given any assertion fires, Then the failure is reported as BLOCKED with the assertion text

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Dump deleted at the end; counts recorded without customer names
Must-not-have:
  - Writes to production; committing any data
Open question risks:
Rollback note:
  - n/a (local only)
Red flags:
  - Dump file inside the repo directory → STOP

## STOP CONDITIONS
Done when: verify exit 0, idempotency confirmed, dump removed
Uncertain when: migration duration exceeds the planned window
Escalate when: any assertion fires

---

### Task 19: Cutover on camel-ggf (main agent only) [depends: T18, T24, T25]

## OBJECTIVE
Execute the cutover in an off-peak window with the user present. **Main agent only, never delegate to a subagent. Production write: explicit go-ahead is required at the start and at the decision point after reopening.**

[no-tdd — structural task]

Steps:
1. Announce the window to the team (user-owned); confirm backups exist; confirm T15's maintenance rehearsal passed.
2. Run `deploy/cutover-ggf.sh --execute` phase by phase, pausing for the user's go-ahead before phase (e) (maintenance on) and before lifting maintenance.
3. After reopening, the user smoke-tests the Board and Tracker of the reference workspace (78 items, 25 cards); decision window ~15 minutes; if bad, run `deploy/restore-ggf.sh <backup>`.
4. Record the cutover timestamp and the "Contract not before" date (cutover + 14 days) in `deploy/CUTOVER-CHECKLIST.md`; the file is local only and is not committed.
5. Watch `docker logs camel-server` for 30 minutes for errors referencing `tracker_items` or `column_id`.

## REFERENCES LOADED
Spec — Story 3, Rollback Plan; `deploy/CUTOVER-CHECKLIST.md`
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: deep
Justification: the only irreversible step in the plan; needs a human decision point.

## SANDWICH CONTEXT
[CRITICAL: Do not lift maintenance unless both the in-database assertions and the application-level `verify` passed; do not proceed past any failed phase.]
You are executing the cutover for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B
Files in scope: deploy/CUTOVER-CHECKLIST.md
Available after: T18, T24, T25 (T24 deployed at least one day earlier)
Architecture rule: user present; maintenance banner during the window
[RESTATE: Both gates must pass before reopening.]

## DELIVERABLE
Given a verified backup and passing rehearsal, When the cutover runs, Then verify exits 0, maintenance lifts, and the user confirms 78 items / 25 cards on the reference workspace
Given any failure, Then the app stays behind maintenance and the documented recovery runs

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Contract-not-before date written down
Must-not-have:
  - Running Contract tasks; deleting the pre-merge image, client copy or backup
Open question risks:
  - none (bmad confirmed decommissioned)
Rollback note:
  - Inside the block: redeploy old image. After reopening: restore backup; edits since are lost.
Red flags:
  - Any phase fails and the script continues → STOP

## STOP CONDITIONS
Done when: user confirms the smoke test and the 30-minute log watch is clean
Uncertain when: verify output has warnings
Escalate when: restore is needed

---

### Task 20: Contract: schema removal [depends: T19]

## OBJECTIVE
Remove the merged shim from the schema 14 days after cutover. **Do not start before the date recorded by T19.**

Steps:
1. Gate: read the recorded date; if today is earlier, STOP and report.
2. Write failing test for: "Fresh database has no tracker_items"
   Test file: `server/src/db/work-item-contract.integration.test.ts`
   Level: integration
   Test intent: Given an empty database / When `migrate()` runs / Then no `tracker_items`, `tracker_item_labels`, `tracker_item_assignees`, `tracker_events` tables exist, the unique key index exists, `cards.column_id` is nullable, and `migrate()` twice is a no-op
   Exercise through: `applySchema(client)` on an empty scratch schema
   Test doubles: none
   Expected RED: the tables are still created
3. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/db/work-item-contract.integration.test.ts`
4. Write failing test for: "Merged database drops old tables only when fully migrated"
   Test file: same
   Level: integration
   Test intent: Given a merged production-shaped database where every `tracker_items` row has `migrated_to_id` / When the Contract `migrate()` runs / Then the old tables are dropped; and given the same database with one row whose `migrated_to_id` is NULL, Then `migrate()` raises `work-item-contract: unmigrated tracker rows` and nothing is dropped
   Exercise through: `applySchema(client)` on two merged scratch-schema fixtures
   Test doubles: none
   Expected RED: the drop happens unconditionally or the old tables are kept
5. Run test — verify FAIL (same command). Then edit `schema.sql` at the statements that re-run on every start and reference tracker tables (`:398`, `:512-517`, `:537-539`, `:830`, `:931-943`), move the unique index and nullable column into `schema.sql`, replace the one-shot data block with a guarded `DROP TABLE IF EXISTS ... ` (only when all rows migrated), remove the redundant partial index `idx_cards_workspace_key_live`, delete `work-item-merge.sql` and its wiring in `migrate.ts` and the Dockerfile, update `db/types.ts`, and update `board-tracker-unify-migration.test.ts`, `tracker-migration.test.ts`, `full-migration.integration.test.ts`. Verify both tests PASS, refactor while green (re-run the same command), then commit: `git commit -m "refactor(db): drop tracker tables after merge"`.

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Scope "Contract PR"; Appendix A #12 (statements that re-run each start); Rollback Plan
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: deep
Justification: irreversible drops guarded by data checks; must keep fresh installs correct.

## SANDWICH CONTEXT
[CRITICAL: Never drop `tracker_items` unless every row has `migrated_to_id`; statements that re-run on every start must no longer recreate or touch dropped tables.]
You are implementing the Contract schema removal for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B (Contract stage)
Files in scope: schema.sql, work-item-merge.sql (deleted), migrate.ts, Dockerfile, db/types.ts, the three migration tests, new contract test
Available after: T19 + 14 days
Architecture rule: single transaction; no `CONCURRENTLY`
[RESTATE: Drop only when fully migrated; nothing recreates dropped tables.]

## DELIVERABLE
Given an empty database, When migrated, Then no tracker tables exist and constraints hold
Given a merged database with all rows migrated, When migrated, Then old tables are dropped
Given one unmigrated row, When migrated, Then it raises and nothing is dropped

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - A fresh install and a merged production-shaped database both migrate cleanly
Must-not-have:
  - Dropping data when any row is unmigrated
Open question risks:
  - Other code still reading tracker tables is removed in T21; run T21 first if typecheck fails → NEEDS_CONTEXT
Rollback note:
  - Backup restore only.
Red flags:
  - Dropping before the recorded date → STOP

## STOP CONDITIONS
Done when: both scenarios pass and the three migration tests are updated and green
Uncertain when: a deploy script or doc still names a dropped table
Escalate when: the date gate is not satisfied

---

### Task 21: Contract: remove shim code, checks and docs [depends: T20]

## OBJECTIVE
Delete the merge/dedup shim, detection tooling, source-branching and update docs; supersede the ADR.

Steps:
1. Write failing test for: "No shim remains"
   Test file: `server/src/lib/work-item-shim-removed.test.ts`
   Level: unit (source contract)
   Test intent: Given the repo sources / When read as text / Then `listMergedWorkItems` dedup, `core/work-item-debt.ts`, `src/scripts/check-key-collisions.ts`, `recordTrackerActivity`, and the tracker-wins comment no longer exist, and `package.json` has no `check:key-collisions` scripts
   Exercise through: `fs`/glob reads
   Test doubles: none
   Expected RED: they exist
2. Run test — verify FAIL: `npm run test --workspace=server -- src/lib/work-item-shim-removed.test.ts`
3. Remove: dedup and dual helpers in `lib/work-item-response.ts`; `core/work-item-debt.ts` and its test; `check-key-collisions` script and `package.json` entries; `lib/tracker-activity.ts` and its allowlist entry in `scripts/check-event-write-routing.mjs`; the nightly smoke step (`tracker-contracts.smoke.ts` if that is the CI smoke) and `.github/workflows` references; `deploy/DEBT-CHECKS.md` and `deploy/debt-check.cron.example` (and the host cron: document its removal in the checklist; do not touch the host without approval); the latency warn-log tied to the ADR gate; `check:mutation-routing` script and `source` branching in `client/src/shared/workItemMutations.ts` only if it can be removed without UI change (otherwise leave the client file and record it). Verify PASS; run `npm run test`, typecheck, lint, `make check`. Commit: `git commit -m "refactor(server): remove board-tracker shim"`.
3b. `bmad`/`camel.web.id` is confirmed decommissioned: delete `deploy/deploy.sh`, `deploy/docker-compose.prod.yml` and `deploy/nginx/camel.conf` (the web.id config) and fix every reference to them. Also remove the detection-gate artifacts listed in the old ADR: the scheduled ADR-revisit workflow (2027-09-01) under `.github/workflows/`, and the CODEOWNERS entries, PR template section and `AGENTS.md` lines that point at the dual-table ADR. Commit: `git commit -m "chore(deploy): remove legacy bmad deploy files and ADR gate artifacts"`.
4. Write ADR `docs/pocket/adr/2026-10-work-items-single-table.md` superseding `2026-09-board-tracker-dual-table.md` (mark the old one `superseded`); update the paragraph in `CLAUDE.md` about the dual table, and the `camel-server` skill's stale host and debt-check sections. Commit: `git commit -m "docs: supersede dual-table ADR with single-table decision"`.

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Scope "Contract PR"; Appendix C (tracker-only infrastructure counts and files)
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: broad but mechanical removal; test is a guardrail so nothing is left behind.

## SANDWICH CONTEXT
[CRITICAL: The Contract is done only when every item in the removal list is gone; leaving one detection script or doc behind is the exact debt this change exists to remove.]
You are implementing the Contract cleanup for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B (Contract stage)
Files in scope: the removal list above (including `deploy/deploy.sh`, `deploy/docker-compose.prod.yml`, `deploy/nginx/camel.conf`, the ADR-revisit workflow, CODEOWNERS, PR template, AGENTS.md), ADR, CLAUDE.md, skill file
Available after: T20
Architecture rule: public repo hygiene; no host changes without approval
[RESTATE: Everything on the list is removed.]

## DELIVERABLE
Given the repo, When scanned, Then no shim, detection script, tracker-activity writer or dedup remains and the ADR is superseded

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `make check` green after removal
Must-not-have:
  - Client UI changes; host changes
Open question risks:
  - Client `workItemMutations.ts` source-branching removal might alter UI → record, do not force
Rollback note:
  - Revert PR (no data change).
Red flags:
  - `closes #103` before every item is removed → STOP

## STOP CONDITIONS
Done when: scenario passes, full checks green, ADR written
Uncertain when: the CI smoke step identity is unclear
Escalate when: client change is unavoidable

---

### Task 22: Contract: rename cards to work_items [depends: T21]

## OBJECTIVE
Rename `cards` → `work_items` and `card_events` → `work_item_events` mechanically, compiler-guided, and close #103.

Steps:
1. Write failing test for: "Tables are renamed and old names are gone"
   Test file: `server/src/db/work-item-rename.integration.test.ts`
   Level: integration
   Test intent: Given a migrated database (fresh and merged) / When `migrate()` runs / Then `work_items` and `work_item_events` exist, `cards` and `card_events` do not, all FKs, indexes and the unique key survive on the new names, and `migrate()` twice is a no-op
   Exercise through: `applySchema(client)` (twice) and `information_schema`/`pg_indexes` reads
   Test doubles: none
   Expected RED: old names still exist
2. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/db/work-item-rename.integration.test.ts`
3. Add an idempotent `ALTER TABLE cards RENAME TO work_items` (guarded by `to_regclass`), same for events; update every Kysely reference and raw SQL string (`"cards"`, `FROM cards`, `JOIN cards`, `UPDATE cards`, `card_events`) found by the typecheck and by grep; do not rename the HTTP paths (`/cards/:id` stays: client contract). Verify PASS; run `npm run test`, typecheck, lint, `make check`. Commit: `git commit -m "refactor(server): rename cards to work_items"`.
4. Open the PR with `closes #103` and `closes #203` in the body; leave #100 alone (its P1#3 is separate).

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Scope (rename at Contract stage); Issue #103 acceptance
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: ~58 query sites plus raw SQL, compiler-guided; the migration itself is two guarded statements.

## SANDWICH CONTEXT
[CRITICAL: HTTP paths and response shapes do not change; only table and Kysely names change; the rename must be idempotent and inside the single migration transaction.]
You are implementing the table rename for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B (Contract stage)
Files in scope: schema.sql, db/types.ts, every server file referencing `cards`/`card_events`, tests
Available after: T21
Architecture rule: 300-on-touch applies to every touched file
[RESTATE: Idempotent rename; HTTP unchanged.]

## DELIVERABLE
Given a migrated database, When migrated, Then only the new table names exist with all constraints intact

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Grep for the old names returns only intentional HTTP path strings and historical docs
Must-not-have:
  - Changing HTTP routes or JSON field names
Open question risks:
  - none
Rollback note:
  - Revert PR and run the reverse rename statement from the PR description.
Red flags:
  - Any raw SQL string missed by the compiler → run the full integration suite before merge

## STOP CONDITIONS
Done when: scenario passes and all checks are green
Uncertain when: a dynamic SQL string builds the table name
Escalate when: the 300-on-touch extraction expands scope too far

---

### Task 23: Build-id reload hook for open tabs [depends: T2, T14]

## OBJECTIVE
Make open browser tabs reload themselves after any new deployment, so a tab that predates the cutover cannot keep sending old tracker numeric ids (for example into focus sessions). **Ships with T24 (Phase A deploy), at least one day before T19; focus mode is ON in production, which is the stale-tab risk this removes.**

Steps:
1. Read-only first: find how the client builds its API base URL (`client/src/api.ts`), where the server health route is mounted (`server/src/index.ts:105`, and whether it is reachable as `/api/health` through nginx on `camel-ggf`), and where `App` mounts global listeners (`client/src/App.tsx`). Record the answers in the report.
2. Write failing test for: "Health reports a build id"
   Test file: `server/src/lib/health.test.ts`
   Level: unit
   Test intent: Given `BUILD_ID=abc123` in the environment / When `buildHealthPayload()` is called / Then it returns `{ ok: true, buildId: "abc123", workItemsListLatency: <snapshot> }`; and with `BUILD_ID` unset it returns a non-empty `buildId` that is stable across calls in one process
   Exercise through: exported `buildHealthPayload()` in `server/src/lib/health.ts`
   Test doubles: stub `getListLatencySnapshot` at the module boundary; do not mock the function under test
   Expected RED: `lib/health.ts` does not exist (`buildHealthPayload` is not exported)
3. Run test — verify FAIL: `npm run test --workspace=server -- src/lib/health.test.ts`
4. Create `server/src/lib/health.ts` and make `index.ts:105` return `buildHealthPayload()`. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "feat(server): expose build id on health"`.
5. Write failing test for: "Tab reloads when the build id changes"
   Test file: `client/src/shared/useBuildReload.test.tsx`
   Level: unit (React hook under jsdom)
   Test intent: Given the hook captured build id "a" at load / When the page becomes visible and the health fetch returns "b" / Then `window.location.reload` is called once; when it returns "a" it is not called; when the fetch fails or returns 503 (maintenance or restart) it is not called and no retry storm occurs (at most one check per visibility event and one per 5 minutes); and when the FIRST fetch at load fails (no captured id) and a later fetch succeeds, it captures that id and does NOT reload
   Exercise through: the exported `useBuildReload()` hook rendered in a test component with fake timers
   Test doubles: global `fetch` mocked, `window.location.reload` replaced with a spy; do not mock the hook
   Expected RED: `client/src/shared/useBuildReload.ts` does not exist
6. Run test — verify FAIL: `npm run test --workspace=client -- src/shared/useBuildReload.test.tsx`
7. Create `client/src/shared/useBuildReload.ts` and mount it once in `client/src/App.tsx`. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "feat(client): reload open tabs when the build changes"`.
7a. Write failing test for: "Health route and hook agree"
   Test file: `server/src/lib/health.test.ts` (separate `describe`)
   Level: integration (Express app) plus source contract
   Test intent: Given the server app / When `GET` is called on `HEALTH_PATH` (a constant exported from `lib/health.ts` and used to mount the route in `index.ts`) / Then it returns 200 JSON including `buildId`; and given the text of `client/src/shared/useBuildReload.ts` / Then it contains the same health path literal as the client really calls through the nginx `/api/` proxy (determined in step 1) and the field name `buildId`
   Exercise through: the app handler (the supertest-style helper used by `routes/*.integration.test.ts`) and `fs.readFileSync`
   Test doubles: none
   Expected RED: `HEALTH_PATH` is not exported and the route is mounted with a literal
7b. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/lib/health.test.ts`. Export `HEALTH_PATH`, mount the route through it, and make the hook use the same literal. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "test(server): pin health route contract with the reload hook"`.
8. Write failing test for: "Images carry a build id"
   Test file: `server/src/lib/health.test.ts` (separate `describe`, source contract as used in `db/work-item-merge-expand.test.ts`)
   Level: unit (source contract)
   Test intent: Given the tracked `Dockerfile` / When read as text / Then it declares `ARG BUILD_ID` and sets `ENV BUILD_ID=$BUILD_ID` (the host-specific deploy script is local only, so it is not tested from the repo)
   Exercise through: `fs.readFileSync` on the Dockerfile
   Test doubles: none
   Expected RED: the Dockerfile does not mention `BUILD_ID`
9. Run test — verify FAIL (same command as step 3). Edit the Dockerfile (committed). Also edit the local-only `deploy/deploy-ggf.sh` so it passes `--build-arg BUILD_ID=<git short hash>-<timestamp>` (not committed, not tested from the repo). Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "chore(deploy): stamp images with a build id"`.
10. Run `npm run typecheck`, `npm run lint`, `npm run test --workspace=client -- src/shared/useBuildReload.test.tsx`; all green.

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Story 3 scenario "Forced reload"; Appendix C (client files that compare numeric ids: `focusGuards.ts`, `FocusPage.tsx`, `TrackerDetailPage.tsx`, `TrackerPage.tsx`, `FocusSessionContext.tsx`, `FocusEntryButton.tsx`); Plan Overview note that no reload mechanism exists today
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: the one place where the "client unchanged" constraint cannot hold; kept to a single hook plus a header-free health field, and it must be live in browsers before the cutover.

## SANDWICH CONTEXT
[CRITICAL: The hook must never reload during maintenance or while the server is unreachable (a 502/503 or failed fetch means do nothing), and must reload at most once per detected build change, otherwise it creates a reload loop for the whole team.]
You are implementing the reload hook for the work-items single-table merge cutover.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B (cutover tooling)
Files in scope: server/src/lib/health.ts (new), server/src/lib/health.test.ts (new), server/src/index.ts, client/src/shared/useBuildReload.ts (new), client/src/shared/useBuildReload.test.tsx (new), client/src/App.tsx, Dockerfile, deploy/deploy-ggf.sh (local only, not committed)
Available after: T2, T14 (same files: Dockerfile, server/src/index.ts); deployed by T24, at least one day before T19
Architecture rule: client uses bundler resolution (no extensions); server uses `.js` extensions; no UI changes
[RESTATE: No reload on failure or maintenance; at most one reload per build change.]

## DELIVERABLE
Given build id "a" at load and "b" on the next visible check, When checked, Then the page reloads once
Given the same build id, or a failed or 503 health fetch, When checked, Then no reload
Given `BUILD_ID` set at image build, When `/health` is called, Then it reports that id
Given the Dockerfile, When read, Then it threads `BUILD_ID`; and as a manual check (not a test) the local-only deploy script passes `--build-arg BUILD_ID=...`

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Client test runs via the client workspace (`document` exists only there)
  - A comment-free hook under 80 lines; no new dependency
Must-not-have:
  - Any visible UI; polling faster than one check per visibility event plus one per 5 minutes; reload on non-2xx
Open question risks:
  - Whether `/health` is reachable through nginx on `camel-ggf` is unverified (the live vhost proxies `/api/` only) → NEEDS_CONTEXT; if only `/api/health` is proxied, use that path
Rollback note:
  - Revert the commits and redeploy; no data change.
Red flags:
  - A reload loop observed in tests → STOP

## STOP CONDITIONS
Done when: all four scenarios pass and typecheck/lint are green
Uncertain when: the API base cannot be derived the same way the rest of the client does
Escalate when: the hook would need a UI element

---

### Task 24: Deploy Phase A to camel-ggf (main agent only) [depends: T1, T2, T3, T4, T5, T6, T14, T23, T25]

## OBJECTIVE
Deploy the additive Phase A work to production and prove, before any Phase B code exists, that the expand migration, the new SQL file in the image and the build id all work on the real host. **Main agent only, never delegate to a subagent; the user must be present and give an explicit go-ahead before every remote write.**

[no-tdd — structural task]

Steps:
1. Scope check: `git log --oneline origin/main..HEAD` shows only Phase A tasks (T1-T6, T14, T23); also re-run the read-only data checks on the host (count only, no names): duplicate `(workspace_id, key_number)` in `cards`, tracker/card key overlaps per workspace, and live cards with NULL `key_number` must all return 0; `grep -n "migrated_to_id IS NULL" server/src/db/work-item-merge.sql` returns nothing (no copy block yet); run `npm run test`, `npm run typecheck`, `npm run lint`, `make check`, and `RUN_INTEGRATION=1 npm run test:integration:routes --workspace=server`; all green.
2. With the user's go-ahead: take a `pg_dump --format=custom` backup on the host, verify it by restoring into a scratch database and running a row-count query, and record the path and counts. Abort here if either fails.
3. Retag the running image `camel-server:pre-phase-a-<YYYYMMDD>` and copy `/var/www/camel` to `/var/www/camel.pre-phase-a-<YYYYMMDD>`.
4. Deploy with `deploy/deploy-ggf.sh` (stamps `BUILD_ID`). Watch `docker logs camel-server` for `Schema applied.`.
5. Verify read-only: the health response carries the new build id; SQL shows `cards.column_id` nullable (`is_nullable = 'YES'`), the unique key index exists, `tracker_items.migrated_to_id` exists, row counts equal the step 2 counts, and the reference workspace still shows its Tracker and Board counts in the UI. No errors in the logs for 15 minutes.
6. Tell the team to refresh their tabs once (tabs opened before this deploy do not contain the reload hook). Extend `deploy/CUTOVER-CHECKLIST.md` (created by T25) with a "Phase A deployed" section (timestamp, build id, backup path, retag names, counts; no customer names). The checklist is local only and is not committed.

## REFERENCES LOADED
Spec — Rollback Plan; Plan Overview stage gates; `deploy/deploy-ggf.sh`, `deploy/docker-compose.ggf.yml`
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: a real stage boundary: it proves production-only mechanics (image contents, migration on real data, build id) one step at a time instead of all on cutover day.

## SANDWICH CONTEXT
[CRITICAL: Only Phase A code may be deployed; if the duplicate-key pre-check raises `work-item-merge: duplicate card keys`, the container will not start: redeploy the retagged image and report; never edit production data to make it pass.]
You are deploying Phase A of the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B (additive part only)
Files in scope: deploy/CUTOVER-CHECKLIST.md
Available after: T1-T6, T14, T23, T25
Architecture rule: public repo hygiene (no secrets, no customer names)
[RESTATE: Phase A only; explicit user go-ahead for each remote write.]

## DELIVERABLE
Given the Phase A build, When deployed, Then `Schema applied.` is logged, the health build id changed, `column_id` is nullable, the unique index and `migrated_to_id` exist, and counts are unchanged
Given a failed backup verification, Then nothing is deployed
Given a pre-check duplicate-key failure, Then the maintenance page shows, the old image is redeployed and the issue is reported

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Backup verified restorable before the deploy
Must-not-have:
  - Any Phase B code; the copy block; production data edits; delegation to a subagent
Open question risks:
  - Disk space and sudo requirements on the host are unverified → NEEDS_CONTEXT
Rollback note:
  - Redeploy `camel-server:pre-phase-a-<date>` and restore `/var/www/camel.pre-phase-a-<date>`; the expand changes are additive and harmless to old code.
Red flags:
  - Row counts differ after deploy → STOP and report

## STOP CONDITIONS
Done when: all verification checks pass and the team has been told to refresh
Uncertain when: the migration log lacks `Schema applied.`
Escalate when: counts differ or the container fails to start

---

### Task 25: Maintenance rehearsal on camel-ggf (main agent only) [depends: T15]

## OBJECTIVE
Rehearse the maintenance mode on the real host in a quiet window so cutover day does not depend on untested nginx behavior. **Main agent only, never delegate to a subagent; the user must be present and give an explicit go-ahead before every remote write.**

[no-tdd — structural task]

Steps:
1. With the user's go-ahead: on `camel-ggf`, copy the live nginx file to a timestamped backup, install `deploy/nginx/camel-ggf.conf` and the maintenance page (`deploy/maintenance/index.html`), then `sudo nginx -t && sudo systemctl reload nginx`.
2. Create the flag file and verify: (a) `curl -i` the site root returns 503 with the maintenance page; (b) the API health path returns JSON 503 with `Retry-After`; (c) the SSE path returns 503; (d) the other application's vhost still answers normally.
3. Stop `camel-server` briefly and confirm that a 502 serves the maintenance page; start it again.
4. Remove the flag; confirm normal operation, including a logged-in page load.
5. Create `deploy/CUTOVER-CHECKLIST.md` with a "Maintenance rehearsal" section (date, results of checks a-d and the 502 check, backup file path; no names). The checklist is local only and is not committed.

## REFERENCES LOADED
Spec — Story 3 scenario "Maintenance during the window"; T15 output
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: the shared host runs another application and the vhost has a catch-all server name; a mistake here affects unrelated users.

## SANDWICH CONTEXT
[CRITICAL: Keep a backup of the previous nginx file, run `nginx -t` before any reload, and restore immediately if any other vhost behaves differently.]
You are rehearsing maintenance mode for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B (cutover tooling)
Files in scope: deploy/CUTOVER-CHECKLIST.md (new, local only)
Available after: T15 (runs BEFORE T24 so a failed Phase A deploy shows the maintenance page instead of a bare 502)
Architecture rule: the camel server block only
[RESTATE: Backup, `nginx -t`, restore on any surprise.]

## DELIVERABLE
Given the flag file, When requests hit the camel vhost, Then 503 page, JSON 503 + Retry-After on the API, 503 on SSE, other vhost unaffected
Given the server stopped and no flag, Then 502 shows the maintenance page
Given the flag removed, Then normal operation

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Backup file path recorded
Must-not-have:
  - Changing TLS or upstream settings; touching other server blocks; delegation to a subagent
Open question risks:
  - TLS termination in front of this nginx is unverified → NEEDS_CONTEXT
Rollback note:
  - Restore the backed-up file, `nginx -t`, reload.
Red flags:
  - `nginx -t` fails or the other application misbehaves → STOP and restore

## STOP CONDITIONS
Done when: all checks pass and the flag is removed
Uncertain when: the live config differs from `deploy/nginx/camel-ggf.conf.live`
Escalate when: the reload affects the other application

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|-----------------|
| T1 | Shared key allocator | prereq | lightweight | consecutive keys from one allocator |
| T2 | Expand migration | prereq | standard | NULL column_id insert ok, duplicate key rejected, idempotent |
| T3 | Board scope filters | T2 | standard | column-less items not counted/loaded |
| T4 | Reject column-less on /cards | T2 | standard | 404 on all card routes |
| T5 | Reject column-less in core paths | T2 | lightweight | status/mark-done/focus ignore them |
| T6 | Event reader tolerance | T3 | standard | types pass through, /activity unchanged |
| T7 | Copy block | T24 | deep | every field and relation follows the new row |
| T8 | Guard, assertions, trigger | T7 | deep | re-run no-op, mismatch rolls back, late insert raises |
| T9 | Merged reads | T6, T8 | standard | 78 items, same shapes, feed once |
| T10 | Tracker writes | T9 | deep | writes land in merged table, 409, recordActivity |
| T11 | Project/phase/member paths | T9 | standard | structure deletes and member removal on merged table |
| T12 | My-work, focus, realtime ids | T9, T5 | standard | new ids end to end, client untouched |
| T13 | Merged-table E2E verification | T10, T11, T12 | standard | 78/25/6/16, keys, relations, restart |
| T14 | BACKGROUND_JOBS switch | prereq | standard | off starts nothing |
| T15 | Maintenance mode config (local files) | prereq | standard | `nginx -t` green, only camel block differs |
| T16 | Snapshot and verify script | T13 | standard | exit 0 on match, names mismatched workspace |
| T17 | Cutover/restore scripts + checklist | T14, T15, T16 | standard | dry-run order, abort before change |
| T18 | Rehearsal on production dump | T17 | standard | verify 0, second run no-op, dump deleted |
| T19 | Cutover | T18, T24, T25 | deep | both gates pass, user confirms 78/25 |
| T20 | Contract: schema removal | T19 | deep | no tracker tables, guarded drop |
| T21 | Contract: shim, checks, docs, ADR | T20 | standard | nothing left on the removal list |
| T22 | Contract: rename | T21 | standard | only work_items names remain, closes #103 |
| T23 | Build-id reload hook | T2, T14 | standard | tab reloads once on build change, never on failure |
| T24 | Deploy Phase A (manual) | T1-T6, T14, T23, T25 | standard | Schema applied, counts unchanged, build id changed |
| T25 | Maintenance rehearsal (manual) | T15 | standard | 503/502 pages, other vhost untouched |
