# Task T6 — Event readers tolerate merged events

**Phase:** 3
**Depends:** T3
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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

## Carried from Phase 2 phase-level pass (P2-F3, user-approved 2026-10-07)
- `GET /cards/:id/activity` (`server/src/modules/activity/activity.ts:~88-118`, `cardCheck` lookup) lacks `column_id IS NOT NULL`, so a column-less item resolves under `/cards/*` instead of 404 (spec Appendix B.5).
- In this task: add `.where("column_id", "is not", null)` to that lookup and a column-less 404 test case. Keep the existing 404 shape.
