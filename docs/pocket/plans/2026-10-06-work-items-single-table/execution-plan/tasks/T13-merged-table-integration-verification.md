# Task T13 — Merged-table integration verification

**Phase:** 5
**Depends:** T10, T11, T12
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
