# Task T8 — Guard, parity assertions, counter repair and write trigger

**Phase:** 4
**Depends:** T7
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
