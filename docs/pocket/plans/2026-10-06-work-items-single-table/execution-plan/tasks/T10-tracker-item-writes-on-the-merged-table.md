# Task T10 — Tracker item writes on the merged table

**Phase:** 4
**Depends:** T1, T9
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
