# Task T9 — Merged-table reads and the unified list

**Phase:** 4
**Depends:** T6, T8
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
