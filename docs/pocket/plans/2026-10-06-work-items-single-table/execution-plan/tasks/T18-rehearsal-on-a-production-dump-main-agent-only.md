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
