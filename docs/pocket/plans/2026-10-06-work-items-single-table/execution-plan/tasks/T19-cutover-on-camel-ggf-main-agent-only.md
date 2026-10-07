# Task T19 — Cutover on camel-ggf (main agent only)

**Phase:** 6
**Depends:** T18, T24, T25
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 19: Cutover on camel-ggf (main agent only) [depends: T18, T24, T25]

## OBJECTIVE
Execute the cutover in an off-peak window with the user present. **Main agent only, never delegate to a subagent. Production write: explicit go-ahead is required at the start and at the decision point after reopening.**

[no-tdd — structural task]

Steps:
1. Announce the window to the team (user-owned); confirm backups exist; confirm T15's maintenance rehearsal passed.
2. Run `deploy/cutover-ggf.sh --execute` phase by phase, pausing for the user's go-ahead before phase (e) (maintenance on) and before lifting maintenance.
3. After reopening, the user smoke-tests the Board and Tracker of the reference workspace (78 items, 25 cards); decision window ~15 minutes; if bad, run `deploy/restore-ggf.sh <backup>`.
4. Record the cutover timestamp and the "Contract not before" date (cutover + 14 days) in `deploy/CUTOVER-CHECKLIST.md`; the file is local only and is not committed.
5. Watch `docker logs camel-server` for 30 minutes for errors referencing `tracker_items` or `column_id`.

## REFERENCES LOADED
Spec — Story 3, Rollback Plan; `deploy/CUTOVER-CHECKLIST.md`
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: deep
Justification: the only irreversible step in the plan; needs a human decision point.

## SANDWICH CONTEXT
[CRITICAL: Do not lift maintenance unless both the in-database assertions and the application-level `verify` passed; do not proceed past any failed phase.]
You are executing the cutover for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B
Files in scope: deploy/CUTOVER-CHECKLIST.md
Available after: T18, T24, T25 (T24 deployed at least one day earlier)
Architecture rule: user present; maintenance banner during the window
[RESTATE: Both gates must pass before reopening.]

## DELIVERABLE
Given a verified backup and passing rehearsal, When the cutover runs, Then verify exits 0, maintenance lifts, and the user confirms 78 items / 25 cards on the reference workspace
Given any failure, Then the app stays behind maintenance and the documented recovery runs

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Contract-not-before date written down
Must-not-have:
  - Running Contract tasks; deleting the pre-merge image, client copy or backup
Open question risks:
  - none (bmad confirmed decommissioned)
Rollback note:
  - Inside the block: redeploy old image. After reopening: restore backup; edits since are lost.
Red flags:
  - Any phase fails and the script continues → STOP

## STOP CONDITIONS
Done when: user confirms the smoke test and the 30-minute log watch is clean
Uncertain when: verify output has warnings
Escalate when: restore is needed

## Carried from Phase 3 phase-level pass (P3-F3, user-approved 2026-10-07)
- The cutover must enable the merge explicitly: start the migration with `WORK_ITEM_MERGE=on` (exact mechanism recorded in `deploy/CUTOVER-CHECKLIST.md` once the gate lands). Without it, the copy block is skipped and logs `work-item-merge: copy skipped`.
- Verify in the cutover logs: per-workspace `work-item-merge: workspace=...` notices are present and no `copy skipped` notice appears.
- Until this task runs, production stays on build `8f7f9eb-20261007065202`; see the HAZARD section in `deploy/CUTOVER-CHECKLIST.md`.
- Exact enable command (from the P3-F3 correction audit): `docker compose -f docker-compose.prod.yml --env-file .env.production run --rm -e WORK_ITEM_MERGE=on --entrypoint node server /app/server/dist/db/migrate.js`. `docker-compose.prod.yml` lists env vars explicitly, so `WORK_ITEM_MERGE` is never inherited by normal starts; never add it to `.env.production`.
