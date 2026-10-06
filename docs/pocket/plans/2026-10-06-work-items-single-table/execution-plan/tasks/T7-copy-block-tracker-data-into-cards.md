# Task T7 — Copy block: tracker data into cards

**Phase:** 3
**Depends:** T24
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
