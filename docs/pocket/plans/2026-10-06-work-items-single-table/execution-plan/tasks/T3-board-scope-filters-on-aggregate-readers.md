# Task T3 — Board scope filters on aggregate readers

**Phase:** 2
**Depends:** T2
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
