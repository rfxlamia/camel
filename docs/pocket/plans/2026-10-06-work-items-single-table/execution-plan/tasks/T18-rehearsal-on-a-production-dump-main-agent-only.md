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
- Host disk cleanup (user-approved 2026-10-08): `/` free went 835 MB → 1.9 GB (disabled snap revisions, apt cache, journal vacuum to 50M, rotated syslog, `/home/ubuntu/dump.sql`, image `camel-server:pre-phase-a-20261007` removed). `MIN_FREE_MB=1024` preflight now passes. Phase A rollback image no longer exists on the host; rollback for T19 relies on the `pre-merge-<date>` retag made by `cutover-ggf.sh` phase c. Two unattached volumes (`pengamatan-db_pengamatan_mysql` 197 MB, anonymous `3caeb40…` 418 MB) were left untouched pending a pengamatan data check.
- Phase 5 phase-level pass, deferred to T18 (user-approved 2026-10-08):
  - P5-F2: add a real-Postgres integration test of the env gate the cutover uses (`WORK_ITEM_MERGE=on` → `SET LOCAL` → `migrate()` stdout) asserting the four validator conditions (exit 0, final `Schema applied.`, ≥1 `work-item-merge: workspace=`, no `copy skipped`); today only `applySchema({workItemMerge:true})` and a fake-client `migrate.test.ts` cover it.
  - P5-F3: `restore-ggf.sh` leaves `cutover-state/<date>` markers; a same-`--date` retry after restore skips the merge and loops on verify. Move the state dir aside on restore or print "retry with a new --date".
  - P5-F4: make `cutover-snapshot.js snapshot` fail closed (exit 1 → point-1 abort) when preconditions don't hold: a live card with NULL key or NULL status, a live card with NULL column, or a tracker row already having `migrated_to_id`. Otherwise verify can false-fail after commit and force a full restore.
  - P5-F12 (Minor, user-approved retry 2026-10-08): `cutover-ggf.sh --self-check` leaks 6 `cutover-merge.*` temp files per run (`mktemp -t` at ~line 661, via the stubbed `run_f`). Clean them up inside `self_check` (or point TMPDIR at the self-check tmp dir). Pre-existing, not caused by the P5-F11 fix.
  - P5-F11 fix landed (retry 2026-10-08): `check_date_policy` restored-archive probe is now a glob loop; T17 `cutover-ggf.sh` sha256 is now `74b5ef917c7c…` (see `reviews/T17-review.json` `reviewed_files`). Re-hash before rehearsal.

## Pre-rehearsal carried items — done 2026-10-08 (user-ordered before T18)
- P5-F2 done: `d2fb026` (real-Postgres env-gate test). P5-F4 done: `96287e3` (snapshot fails closed; new files live in `server/src/lib/` because the feature-module guard rejects new files in `scripts/`). P5-F12 done (host file). P5-F3: no change needed for the successful-restore path (covered by the P5-F10/F11 work); see M1 for the failed-archive gap.
- Audit (Opus, read-only): AUDIT_FINDINGS, no Critical/Important, 3 Minors skipped by the user and carried here:
  - M1 `cutover-ggf.sh` `check_date_policy` / `restore-ggf.sh` `archive_state`: if the archive `mv` fails and the state dir holds only `merge_started`, a same-`--date` retry lands in IN-FLIGHT and advises "restore the FINAL dump" although the site was already reopened (would drop writes since restore). Fix: also refuse when `$STATE_DIR/restored` exists; add a self-check case. Operator rule until fixed: after any restore, ALWAYS use a NEW `--date`; if the "State archived" line is missing, archive the dir by hand.
  - M2 point-1 text and checklist do not mention "Cutover snapshot precondition failed"; NULL column/status or already-set `migrated_to_id` will abort on every retry. Add a "fix the data first" line.
  - M3 no self-check for a failing snapshot (rc != 0 -> FAILURE POINT 1, no `merge_started`, prints `--from-phase d`).
- T17 host-file hash after this round: `cutover-ggf.sh` sha256 `eed251105540fcab08b1cbe1460b02e1c3f942844df7141be540a6fc290a9d34` (others unchanged). Re-hash before rehearsal.
- T18 must record the four snapshot precondition counts on the production copy (live cards with NULL key / NULL status / NULL column; tracker rows with `migrated_to_id`). ~273 old `cutover-merge.*` files sit in the macOS temp dir from earlier self-check runs; safe to delete.

## T18 result — 2026-10-08 (user approved the dump and the read-only host checks)
- Rehearsal on a production dump (316 KB custom-format, DB 13 MB, streamed to local scratch, never written on the host; dump + scratch DB deleted, scratch dir removed). Counts/timings are in `deploy/CUTOVER-CHECKLIST.md` (local only): workspaces 37; cards 486 -> 666 (+180); tracker_items 180 (all migrated); card_events 1944 -> 2474 (+530); tracker_events 530. Snapshot preconditions all 0. Migrate #1 1.25 s (9 workspace notices, no `copy skipped`, `Schema applied.` last), verify exit 0 / 0 mismatches 0.56 s, migrate #2 0.39 s no-op, verify still matches. No assertion fired.
- Host read-only checks: ubuntu, bash 5.1, passwordless sudo, `/` free 1671 MB (>= MIN_FREE_MB 1024), compose v5.3.1, dotenv present in the running image, maintenance dir present, nginx -t ok, new compose differs from the current only by `BACKGROUND_JOBS: 'on'`.
- Not covered (belongs to T19): `compose run` with the NEW image and trailing lines after `Schema applied.`; nginx maintenance mode on the host; disk headroom for the image tarball + new 438 MB image (1.7 GB free now).
- Watch item: `/health` `workItemsListLatency` p95 171 ms (p50 80 ms, only 5 samples) on the pre-merge path vs the ADR threshold p95 > 100 ms (Phase E re-evaluation). Re-read after cutover.
- `CUTOVER-CHECKLIST.md` sha256 is now `ffa8f16ff422…` (rehearsal record added); other T17 host hashes unchanged.
