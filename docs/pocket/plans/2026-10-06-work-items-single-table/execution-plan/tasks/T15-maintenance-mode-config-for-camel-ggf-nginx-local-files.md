# Task T15 — Maintenance mode config for camel-ggf nginx (local files)

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 15: Maintenance mode config for camel-ggf nginx (local files) [prereq]

## OBJECTIVE
Bring the live `camel-ggf` nginx config onto this machine as local, uncommitted files (one read-only `cat`) and add a flag-file maintenance mode with a local `nginx -t` check. **No remote write happens in this task**; the rehearsal on the host is T25.

[no-tdd — structural task]

Steps:
1. Fetch the live config read-only: `ssh camel-ggf 'cat /etc/nginx/sites-enabled/camel'` (sites-enabled file observed with `server_name <camel host> _;`, `/api/`, `/`, static assets). Save it twice: `deploy/nginx/camel-ggf.conf.live` (never edited) and `deploy/nginx/camel-ggf.conf` (the working copy). Do NOT change behavior yet. This file is host-specific: it stays local and is never committed.
2. Add maintenance mode: flag file `/var/www/camel-maintenance/ON`; when present, `/api/` returns `503` with JSON `{"error":"maintenance"}` and `Retry-After: 600`; `/api/events` (SSE) returns `503`; all other paths serve `deploy/maintenance/index.html` with status 503; `error_page 502 503 504` serves the same page for the camel vhost only. Because the host also runs another app (`pengamatan`) and the vhost has a catch-all `server_name _`, scope every directive to the camel server block and verify the other vhost is untouched.
3. Verify locally: `docker run --rm -v "$PWD/deploy/nginx/camel-ggf.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine nginx -t` (use a local copy with `proxy_pass` upstream stubbed if nginx cannot resolve it).
4. Add these patterns to `.gitignore`: `deploy/*-ggf.sh`, `deploy/nginx/*ggf*`, `deploy/maintenance/`, `deploy/CUTOVER-CHECKLIST.md`. Verify with `git check-ignore -v` on each path (each must print its rule) and `git status --short deploy` must show nothing new. Commit ONLY `.gitignore`: `git commit -m "chore(git): ignore host-specific deploy files"`. Keep a private backup of the ignored files outside the repo.

## REFERENCES LOADED
Spec — Story 3 scenario "Maintenance during the window"; Implementation Notes (maintenance, 502/503/504); Plan Overview (nginx not in repo; no api subdomain on ggf)
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: shared production host with another application; error here affects unrelated users.

## SANDWICH CONTEXT
[CRITICAL: Do not modify any nginx server block other than the camel one; this task performs no remote write (the only remote command is a read-only `cat`).]
You are implementing maintenance mode for the camel-ggf host.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B (cutover tooling)
Files in scope: deploy/nginx/camel-ggf.conf (new, local only), deploy/maintenance/index.html (new, local only), .gitignore (the only committed change)
Available after: none (independent)
Architecture rule: public repo: no secrets, hostnames beyond those already in the repo, or customer names
[RESTATE: Camel server block only; user approval for remote writes.]

## DELIVERABLE
Given the new config, When `nginx -t` runs locally, Then it passes
Given the flag-file location, When read in the config, Then /api returns JSON 503 with Retry-After, SSE returns 503, other paths serve the maintenance page, and 502/503/504 map to the page for the camel server block only
Given a diff of `deploy/nginx/camel-ggf.conf` against the untouched copy `deploy/nginx/camel-ggf.conf.live`, When reviewed, Then only the camel server block differs

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `nginx -t` green locally; an untouched copy of the live file is kept as `deploy/nginx/camel-ggf.conf.live` (local only, matched by the ignore pattern) before any edit, and is the diff baseline and the T25 restore reference
Must-not-have:
  - Changing TLS, upstream or other vhosts; committing secrets
Open question risks:
  - Whether TLS terminates upstream of this nginx is unverified (config listens on 80) → NEEDS_CONTEXT
Rollback note:
  - Nothing was applied to the host; delete the local files, or restore `deploy/nginx/camel-ggf.conf` from `deploy/nginx/camel-ggf.conf.live`.
Red flags:
  - `nginx -t` fails or the diff touches another server block → STOP

## STOP CONDITIONS
Done when: local `nginx -t` green and the diff against `deploy/nginx/camel-ggf.conf.live` touches only the camel server block
Uncertain when: the live config differs from what the repo expects
Escalate when: the captured file shows TLS or upstream settings that need a decision
