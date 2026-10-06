# Task T20 — Contract: schema removal

**Phase:** 6
**Depends:** T19
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
