# Task T16 — Cutover snapshot and verify script

**Phase:** 5
**Depends:** T13
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 16: Cutover snapshot and verify script [depends: T13]

## OBJECTIVE
Provide the application-level gate: snapshot what users see before shutdown, verify it against the new code path before reopening.

Steps:
1. Write failing test for: "Verify exits 0 when everything matches"
   Test file: `server/src/scripts/cutover-snapshot.integration.test.ts`
   Level: integration
   Test intent: Given a pre-merge fixture (board cards + tracker items) / When `takeSnapshot` runs with the OLD semantics (SQL over `cards` default-board + `tracker_items`, on a schema that already has the T2 expand columns), then the merge SQL runs through `applySchema(client)`, then `verifySnapshot` runs the NEW code paths (`listMergedWorkItems`, board response, header counts) / Then every workspace matches (keys per workspace, Tracker count, Board count, in-progress and done counts) and `main(["verify", file])` resolves to exit code 0
   Exercise through: exported `takeSnapshot(db)`, `verifySnapshot(db, snapshot)` and `main(argv): Promise<number>` in `scripts/cutover-snapshot.ts` (the CLI wrapper only does `process.exit(await main(process.argv.slice(2)))`)
   Test doubles: none
   Expected RED: the module does not exist
2. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/scripts/cutover-snapshot.integration.test.ts`
3. Implement (minimal) `server/src/scripts/cutover-snapshot.ts` with CLI modes `snapshot <file>` and `verify <file>` (exit 0 only if all workspaces match; print per-workspace diffs otherwise); ensure it is compiled into `dist/scripts/` (same as `check-key-collisions`). Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "feat(server): add cutover snapshot and verify script"`.

4. Write failing test for: "Verify exits 1 naming the altered workspace"
   Test file: same
   Level: integration
   Test intent: Given the same fixture where one card in one workspace is altered between snapshot and verify / When `verifySnapshot` runs / Then exactly that workspace is reported as a mismatch, others match, and `main` resolves to exit code 1
   Exercise through: `verifySnapshot` and `main`
   Test doubles: none
   Expected RED: verify reports success or does not name the workspace
5. Run test — verify FAIL (same command). Implement the per-workspace diff output and exit codes. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "feat(server): report cutover mismatches per workspace"`.

6. Write failing test for: "Snapshot ignores column-less rows and migrated_to_id"
   Test file: same
   Level: integration
   Test intent: Given a post-T24 schema where some `cards` rows have `column_id` NULL and some `tracker_items` have `migrated_to_id` set / When `takeSnapshot` runs / Then it counts only board cards on the default board plus unmigrated tracker rows, so the snapshot of a not-yet-merged database is stable
   Exercise through: `takeSnapshot(db)`
   Test doubles: none
   Expected RED: the snapshot counts column-less rows or migrated rows
7. Run test — verify FAIL (same command). Adjust the snapshot SQL. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "fix(server): keep cutover snapshot on old semantics"`.

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Story 3 "Application-level parity gate"; Rule "Cutover is safe and recoverable"
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: needs to share logic with the merged readers without importing deleted code later.

## SANDWICH CONTEXT
[CRITICAL: `snapshot` must use old-schema SQL only (it runs before the merge); `verify` must use the production code paths, not re-implemented SQL.]
You are implementing the cutover gate for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B (cutover tooling)
Files in scope: server/src/scripts/cutover-snapshot.ts, its test
Available after: T13
Architecture rule: scripts live under `server/src/scripts/`; `.js` imports; <= 300 lines
[RESTATE: Old SQL for snapshot; production paths for verify.]

## DELIVERABLE
Given matching data, When verify runs, Then exit 0
Given one altered workspace, Then exit 1 naming that workspace (separate cycle)

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Snapshot file contains no customer names (workspace ids only)
Must-not-have:
  - Any write to the database
Open question risks:
  - none
Rollback note:
  - n/a (read-only script)
Red flags:
  - Snapshot depends on `migrated_to_id` or other post-merge columns → STOP

## STOP CONDITIONS
Done when: both scenarios pass
Uncertain when: header counts need data not available without the HTTP layer
Escalate when: verify cannot reuse production paths without auth
