# Task T24 — Deploy Phase A to camel-ggf (main agent only)

**Phase:** 3
**Depends:** T1, T2, T3, T4, T5, T6, T14, T23, T25
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 24: Deploy Phase A to camel-ggf (main agent only) [depends: T1, T2, T3, T4, T5, T6, T14, T23, T25]

## OBJECTIVE
Deploy the additive Phase A work to production and prove, before any Phase B code exists, that the expand migration, the new SQL file in the image and the build id all work on the real host. **Main agent only, never delegate to a subagent; the user must be present and give an explicit go-ahead before every remote write.**

[no-tdd — structural task]

Steps:
1. Scope check: `git log --oneline origin/main..HEAD` shows only Phase A tasks (T1-T6, T14, T23); also re-run the read-only data checks on the host (count only, no names): duplicate `(workspace_id, key_number)` in `cards`, tracker/card key overlaps per workspace, and live cards with NULL `key_number` must all return 0; `grep -n "migrated_to_id IS NULL" server/src/db/work-item-merge.sql` returns nothing (no copy block yet); run `npm run test`, `npm run typecheck`, `npm run lint`, `make check`, and `RUN_INTEGRATION=1 npm run test:integration:routes --workspace=server`; all green.
2. With the user's go-ahead: take a `pg_dump --format=custom` backup on the host, verify it by restoring into a scratch database and running a row-count query, and record the path and counts. Abort here if either fails.
3. Retag the running image `camel-server:pre-phase-a-<YYYYMMDD>` and copy `/var/www/camel` to `/var/www/camel.pre-phase-a-<YYYYMMDD>`.
4. Deploy with `deploy/deploy-ggf.sh` (stamps `BUILD_ID`). Watch `docker logs camel-server` for `Schema applied.`.
5. Verify read-only: the health response carries the new build id; SQL shows `cards.column_id` nullable (`is_nullable = 'YES'`), the unique key index exists, `tracker_items.migrated_to_id` exists, row counts equal the step 2 counts, and the reference workspace still shows its Tracker and Board counts in the UI. No errors in the logs for 15 minutes.
6. Tell the team to refresh their tabs once (tabs opened before this deploy do not contain the reload hook). Extend `deploy/CUTOVER-CHECKLIST.md` (created by T25) with a "Phase A deployed" section (timestamp, build id, backup path, retag names, counts; no customer names). The checklist is local only and is not committed.

## REFERENCES LOADED
Spec — Rollback Plan; Plan Overview stage gates; `deploy/deploy-ggf.sh`, `deploy/docker-compose.ggf.yml`
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: a real stage boundary: it proves production-only mechanics (image contents, migration on real data, build id) one step at a time instead of all on cutover day.

## SANDWICH CONTEXT
[CRITICAL: Only Phase A code may be deployed; if the duplicate-key pre-check raises `work-item-merge: duplicate card keys`, the container will not start: redeploy the retagged image and report; never edit production data to make it pass.]
You are deploying Phase A of the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B (additive part only)
Files in scope: deploy/CUTOVER-CHECKLIST.md
Available after: T1-T6, T14, T23, T25
Architecture rule: public repo hygiene (no secrets, no customer names)
[RESTATE: Phase A only; explicit user go-ahead for each remote write.]

## DELIVERABLE
Given the Phase A build, When deployed, Then `Schema applied.` is logged, the health build id changed, `column_id` is nullable, the unique index and `migrated_to_id` exist, and counts are unchanged
Given a failed backup verification, Then nothing is deployed
Given a pre-check duplicate-key failure, Then the maintenance page shows, the old image is redeployed and the issue is reported

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Backup verified restorable before the deploy
Must-not-have:
  - Any Phase B code; the copy block; production data edits; delegation to a subagent
Open question risks:
  - Disk space and sudo requirements on the host are unverified → NEEDS_CONTEXT
Rollback note:
  - Redeploy `camel-server:pre-phase-a-<date>` and restore `/var/www/camel.pre-phase-a-<date>`; the expand changes are additive and harmless to old code.
Red flags:
  - Row counts differ after deploy → STOP and report

## STOP CONDITIONS
Done when: all verification checks pass and the team has been told to refresh
Uncertain when: the migration log lacks `Schema applied.`
Escalate when: counts differ or the container fails to start
