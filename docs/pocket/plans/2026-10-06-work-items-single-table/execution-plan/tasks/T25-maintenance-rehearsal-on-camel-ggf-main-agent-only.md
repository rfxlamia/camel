# Task T25 — Maintenance rehearsal on camel-ggf (main agent only)

**Phase:** 2
**Depends:** T15
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 25: Maintenance rehearsal on camel-ggf (main agent only) [depends: T15]

## OBJECTIVE
Rehearse the maintenance mode on the real host in a quiet window so cutover day does not depend on untested nginx behavior. **Main agent only, never delegate to a subagent; the user must be present and give an explicit go-ahead before every remote write.**

[no-tdd — structural task]

Steps:
1. With the user's go-ahead: on `camel-ggf`, copy the live nginx file to a timestamped backup, install `deploy/nginx/camel-ggf.conf` and the maintenance page (`deploy/maintenance/index.html`), then `sudo nginx -t && sudo systemctl reload nginx`.
2. Create the flag file and verify: (a) `curl -i` the site root returns 503 with the maintenance page; (b) the API health path returns JSON 503 with `Retry-After`; (c) the SSE path returns 503; (d) the other application's vhost still answers normally.
3. Stop `camel-server` briefly and confirm that a 502 serves the maintenance page; start it again.
4. Remove the flag; confirm normal operation, including a logged-in page load.
5. Create `deploy/CUTOVER-CHECKLIST.md` with a "Maintenance rehearsal" section (date, results of checks a-d and the 502 check, backup file path; no names). The checklist is local only and is not committed.

## REFERENCES LOADED
Spec — Story 3 scenario "Maintenance during the window"; T15 output
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: the shared host runs another application and the vhost has a catch-all server name; a mistake here affects unrelated users.

## SANDWICH CONTEXT
[CRITICAL: Keep a backup of the previous nginx file, run `nginx -t` before any reload, and restore immediately if any other vhost behaves differently.]
You are rehearsing maintenance mode for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B (cutover tooling)
Files in scope: deploy/CUTOVER-CHECKLIST.md (new, local only)
Available after: T15 (runs BEFORE T24 so a failed Phase A deploy shows the maintenance page instead of a bare 502)
Architecture rule: the camel server block only
[RESTATE: Backup, `nginx -t`, restore on any surprise.]

## DELIVERABLE
Given the flag file, When requests hit the camel vhost, Then 503 page, JSON 503 + Retry-After on the API, 503 on SSE, other vhost unaffected
Given the server stopped and no flag, Then 502 shows the maintenance page
Given the flag removed, Then normal operation

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Backup file path recorded
Must-not-have:
  - Changing TLS or upstream settings; touching other server blocks; delegation to a subagent
Open question risks:
  - TLS termination in front of this nginx is unverified → NEEDS_CONTEXT
Rollback note:
  - Restore the backed-up file, `nginx -t`, reload.
Red flags:
  - `nginx -t` fails or the other application misbehaves → STOP and restore

## STOP CONDITIONS
Done when: all checks pass and the flag is removed
Uncertain when: the live config differs from `deploy/nginx/camel-ggf.conf.live`
Escalate when: the reload affects the other application
