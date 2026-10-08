# Task T2 — Expand migration (nullable column_id, new columns, unique key, wiring)

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
