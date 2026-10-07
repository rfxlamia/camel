# Task T17 — Cutover and restore scripts plus checklist

**Phase:** 5
**Depends:** T14, T15, T16
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 17: Cutover and restore scripts plus checklist [depends: T14, T15, T16]

## OBJECTIVE
Write the scripted cutover for `camel-ggf` (extending `deploy-ggf.sh`) and a restore script, plus a dated, resumable checklist.

[no-tdd — structural task]

Steps:
1. Create `deploy/cutover-ggf.sh` (`set -euo pipefail`) with ordered, individually re-runnable phases: (a) preflight (disk space, `docker compose ps`, nginx flag path writable, old image id recorded); (b) `pg_dump` custom-format backup to a timestamped path on the host and **verified restorable** by restoring into a scratch database and running a row-count query; abort before any change if either fails; (c) retag the running image `camel-server:pre-merge-<date>` and copy `/var/www/camel` to `/var/www/camel.pre-merge-<date>`; (d) take the snapshot via `docker exec camel-server node dist/scripts/cutover-snapshot.js snapshot <file>`; (e) enable the maintenance flag; stop the server container; (f) build/load the new image (reuse `deploy-ggf.sh` steps) and start with `BACKGROUND_JOBS=off`; migration runs at start; a failing migration leaves the app down behind the maintenance page and prints the redeploy-old-image command; (g) run `verify`; on success restart with jobs on (SSE connections drop with the restart), disable the flag; on failure keep maintenance on and print the restore command; (h) confirm the build id served by `/health` changed (T23 hook makes open tabs reload); write the cutover timestamp and the "Contract not before" date (+14 days) to `deploy/CUTOVER-CHECKLIST.md` output (local copy).
2. Create `deploy/restore-ggf.sh`: restores the backup (path argument), redeploys the retagged old image and old client dist, runs `docker compose up -d`, disables nothing until a health check passes; prints elapsed time since cutover (advisory 15-minute window, not enforced).
3. Create `deploy/CUTOVER-CHECKLIST.md` if it is absent (T25 normally creates it first; it is local only and not in git, so check before assuming), then extend it (no secrets): ordered checklist with checkboxes, the two failure points (inside the DO block: redeploy old image, no restore; after reopening: restore backup, edits since are lost), and the dates.
4. Verify without touching production: `bash -n deploy/cutover-ggf.sh deploy/restore-ggf.sh` and `shellcheck` if available; dry-run mode `--dry-run` prints every command without executing. These files are local only (ignored since T15): do not commit or `git add -f` them; keep a private backup.

## REFERENCES LOADED
Spec — Story 3, Rollback Plan, Appendix B.6–B.8; `deploy/deploy-ggf.sh`, `deploy/docker-compose.ggf.yml`
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: shell with irreversible steps; correctness comes from ordering, abort-before-change, and rehearsal in T18.

## SANDWICH CONTEXT
[CRITICAL: Nothing in this task may be executed against production; scripts are written and statically checked only. The backup must be proven restorable before any change.]
You are implementing cutover tooling for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B (cutover tooling)
Files in scope: deploy/cutover-ggf.sh, deploy/restore-ggf.sh, deploy/CUTOVER-CHECKLIST.md, deploy/docker-compose.ggf.yml (add `BACKGROUND_JOBS: ${BACKGROUND_JOBS:-on}` to the server environment)
Available after: T14, T15, T16
Architecture rule: host-specific files stay local and uncommitted; no secrets; remote commands use `sudo docker` like `deploy-ggf.sh`
[RESTATE: Static checks only; backup verified restorable.]

## DELIVERABLE
Given `--dry-run`, When run, Then every phase prints its commands in order and the script exits 0 without side effects
Given a failing backup verification, Then the script aborts before stopping any service

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Each phase is idempotent or guarded against being run twice
Must-not-have:
  - Remote execution; secrets in the repo; deleting the old image or old client dist
Open question risks:
  - Host user, sudo requirements and disk space on `camel-ggf` unverified → NEEDS_CONTEXT (T18 verifies)
Rollback note:
  - See `restore-ggf.sh`; two documented failure points.
Red flags:
  - Any command that runs remote without `--execute` → STOP

## STOP CONDITIONS
Done when: `bash -n` passes, `--dry-run` output reviewed, checklist complete
Uncertain when: compose service names differ on the host
Escalate when: restore cannot be made one-command

## Carried from Phase 3 phase-level pass (P3-F3/P3-F4, user-approved 2026-10-07)
- The merge copy block is gated: it only runs when the migration process has `WORK_ITEM_MERGE=on` (or `applySchema(client, { workItemMerge: true })`). The normal container start (`/entrypoint.sh` → `node migrate.js`) never sets it, because `docker-compose.prod.yml` lists env vars explicitly.
- Therefore `deploy/cutover-ggf.sh` phase (f) MUST, after the server is stopped and before the new image is started, run the gated one-off migrate:
  `docker compose -f docker-compose.prod.yml --env-file .env.production run --rm -e WORK_ITEM_MERGE=on --entrypoint node server /app/server/dist/db/migrate.js`
- The script MUST abort (and go to restore) if that output contains `work-item-merge: copy skipped` or contains no `work-item-merge: workspace=` notice. Only then `up -d`; the entrypoint's ungated migrate is then a harmless no-op.
- Never add `WORK_ITEM_MERGE` to `.env.production` or to the compose `environment:` block.
- Add a script-level test or dry-run check that greps the script for the gated command and the abort conditions.
- (P3-F5) Since 5b2d572, `migrate()` prints every Postgres NOTICE verbatim to stdout. Notices are emitted as they arrive, even if the transaction later rolls back, so the script must ALSO require exit code 0 and a final `Schema applied.` line before trusting the per-workspace notices. Verified on a scratch DB 2026-10-07: gate off → `work-item-merge: copy skipped (WORK_ITEM_MERGE not enabled)` + `Schema applied.`.
- If the script pipes the one-off run output (e.g. through `tee`), use `set -o pipefail` or check the run's own exit status so the exit-code-0 requirement is not lost. Normal starts also print benign DDL notices (e.g. `already exists, skipping`); only the `work-item-merge:` lines matter.
