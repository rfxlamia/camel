# Task T18 — Rehearsal on a production dump (main agent only)

**Phase:** 6
**Depends:** T17
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 18: Rehearsal on a production dump (main agent only) [depends: T17]

## OBJECTIVE
Prove the whole merge on a copy of production data before the real cutover. **Main agent only, never delegate to a subagent. Requires the user to approve taking and storing a dump.**

[no-tdd — structural task]

Steps:
1. With the user's approval, take a read-only dump from `camel-ggf` (`pg_dump --format=custom` via `docker exec camel-db`) and copy it to a local scratch directory (never into the repo; delete after rehearsal; it contains customer data).
2. Restore into a local Postgres 16 (docker) database; run the old image's migration to establish the baseline; run `cutover-snapshot snapshot`.
3. Build the Phase B branch; run `node dist/db/migrate.js` against the restored copy; run `cutover-snapshot verify`; run the idempotency check (second migrate is a no-op); time each step.
4. Record in the checklist: row counts before/after (workspaces, cards, tracker items, events, labels, assignees), migration duration, and any assertion that fired.
5. Delete the dump and the restored database. Verify: `ls` the scratch directory is empty.
6. Record counts and timings (no names) in `deploy/CUTOVER-CHECKLIST.md`; the file is local only and is not committed.

## REFERENCES LOADED
Spec — Story 3; Appendix D (unverified items); Rollback Plan
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: only rehearsal on real data exercises ids, counters and edge rows that fixtures miss.

## SANDWICH CONTEXT
[CRITICAL: The dump contains customer data: store it only in the scratch directory, never commit or upload it, delete it when done; production access is read-only.]
You are rehearsing the merge for the work-items single-table change.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B
Files in scope: none in the repo except `deploy/CUTOVER-CHECKLIST.md` notes (counts only, no names)
Available after: T17
Architecture rule: read-only against production
[RESTATE: Dump stays in scratch and is deleted.]

## DELIVERABLE
Given a production dump, When the Phase B migration runs on the copy, Then verify exits 0, the second run is a no-op, and timings are recorded
Given any assertion fires, Then the failure is reported as BLOCKED with the assertion text

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Dump deleted at the end; counts recorded without customer names
Must-not-have:
  - Writes to production; committing any data
Open question risks:
Rollback note:
  - n/a (local only)
Red flags:
  - Dump file inside the repo directory → STOP

## STOP CONDITIONS
Done when: verify exit 0, idempotency confirmed, dump removed
Uncertain when: migration duration exceeds the planned window
Escalate when: any assertion fires

## Carried from Phase 3 phase-level pass (P3-F3/P3-F4, user-approved 2026-10-07)
- Run the rehearsal migration with the merge enabled: `WORK_ITEM_MERGE=on node dist/db/migrate.js` (or the same one-off `docker compose run ... -e WORK_ITEM_MERGE=on --entrypoint node server /app/server/dist/db/migrate.js` that T17's script uses). Without it the copy is skipped and timings / verify results are meaningless.
- Assert the per-workspace `work-item-merge: workspace=` notices are present and no `copy skipped` notice appears.
- The idempotency run (second migrate) must ALSO use `WORK_ITEM_MERGE=on`, and must then produce no per-workspace notices.

## Carried from Phase 5 T17 audit (2026-10-08)
- T17 scripts are local/git-ignored; verdict pinned by sha256 in `reviews/T17-review.json` (`reviewed_files`). Re-hash before rehearsal; any edit after audit needs a re-audit.
- Fix during rehearsal (T17 audit Minors): treat merge rc >= 128 (signal) like 255 (outcome unknown, keep `merge_started`, point 2) instead of a clean rollback; dry-run prints `merge_started` after the merge line while `--execute` writes it before; backup row-count equality vs live can false-abort (`cutover-ggf.sh` phase b); restore DB renames are separate transactions; phase c `test -e || cp -a` treats a partial copy as present; bare `shift` on a trailing `--from-phase`/`--date`.
- Verify on the host (T17 NEEDS_CONTEXT): host user + passwordless sudo, remote shell is bash, free disk vs `MIN_FREE_MB=1024` (Phase A saw ~846 MB), scratch-DB method for the backup check, trailing lines after `Schema applied.` from `compose run -T`, `dotenv` present in the runner image's production deps, old image accepts the new compose file.
