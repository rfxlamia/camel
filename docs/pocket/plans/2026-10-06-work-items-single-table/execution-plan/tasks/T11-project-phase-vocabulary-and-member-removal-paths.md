# Task T11 — Project, phase, vocabulary and member-removal paths

**Phase:** 4
**Depends:** T9
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
