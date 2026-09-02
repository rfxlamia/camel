# Production debt checks (issue #103)

Public-safe operator notes. **No secrets, hostnames, or IPs belong in this file.**

Nightly GitHub Actions (`debt-checks.yml`) only smoke-tests the collision script against an empty migrated database. **Real collision detection requires a scheduled job on the production host** that runs against the live Postgres instance.

## What runs

| Check | Command (inside API image) | Exit code |
|-------|---------------------------|-----------|
| Key collision | `node /app/server/dist/scripts/check-key-collisions.js` | `1` if any `cards.key_number` overlaps `tracker_items.key_number` in the same workspace |

List latency is already instrumented in the running API (`GET /work-items`); watch structured logs for `work_items_list_slow` and `work_items_list_latency_threshold`, or `GET /health` → `workItemsListLatency`.

## Prerequisites

- Production deploy uses `deploy/docker-compose.prod.yml` and a host-local env file (see `deploy/.env.production.template`).
- `DATABASE_URL` is injected by Compose into the `server` service — **do not put credentials in crontab**.
- Image must include a build that contains `server/dist/scripts/check-key-collisions.js` (shipped with normal `deploy/deploy.sh`).

## Install cron (operator)

1. On the production host, set a deploy directory variable (example only):

   ```bash
   export DEPLOY_DIR=/path/to/camel   # your real path — not committed
   ```

2. Copy the example crontab entry and edit paths:

   ```bash
   cp deploy/debt-check.cron.example /tmp/camel-debt-check.cron
   # Edit DEPLOY_DIR placeholder, then:
   crontab -e   # paste the schedule block
   ```

3. After the next deploy, run once manually and confirm exit `0`:

   ```bash
   cd "$DEPLOY_DIR"
   docker compose -f docker-compose.prod.yml --env-file .env.production \
     run --rm --no-deps --entrypoint node server \
     /app/server/dist/scripts/check-key-collisions.js
   ```

4. On non-zero exit, inspect the log file configured in the crontab example and investigate collisions per [ADR detection gates](../docs/pocket/adr/2026-09-board-tracker-dual-table.md#detection-gates).

## Alerting

This repo does not ship a notification integration. Operators should wire exit `1` to their existing on-call path, for example:

- Email from cron (`MAILTO=` in crontab), or
- `logger` + host log aggregation, or
- A small wrapper script that posts to Slack/PagerDuty (keep webhook URLs **out of git**).

## Security notes (public repo)

- Never commit `.env.production`, database passwords, or webhook URLs.
- Crontab and SSH config live on the server only.
- Maintainer-specific host aliases and concrete SSH steps belong in private operator notes (not this repo).

## Owner

Repo maintainers / issue [#103](https://github.com/rfxlamia/camel/issues/103) assignee.
