# Task T6 — Wire production Compose env and operator runbook

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 6: Wire production Compose env and operator runbook [depends: T1] [parallel: T2]

## OBJECTIVE

[no-tdd — structural task]

1. Add `AGENT_SPEND_KILL_SWITCH=false` to the production env template and `AGENT_SPEND_KILL_SWITCH: ${AGENT_SPEND_KILL_SWITCH:-false}` to the server environment in `deploy/docker-compose.prod.yml`.
2. Create `deploy/README.md` documenting that the switch is startup-only, defaults off, how to set true/false in `.env.production`, and exact application command from `deploy/`: `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --force-recreate server`. Explain recreation can interrupt active runs, guard only blocks newly entered work after startup, and do not promise in-flight continuity.
3. Verify rendered Compose config with `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production.template config` and inspect server environment confirms false by default. If placeholders prevent rendering, use a temporary non-secret env file with required values and remove it immediately. Ensure no credentials or generated env files are staged.
4. Commit `docs(deploy): document agent spend kill switch`.

## REFERENCES LOADED

- Spec operational setup, deployment env evidence, and rollback plan.
- `deploy/docker-compose.prod.yml`, `deploy/.env.production.template`, `deploy/deploy.sh`; no `deploy/README.md` exists.
- Docker Compose docs: `https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/` (environment interpolation) and `https://docs.docker.com/reference/cli/docker/compose/up/` (`up` recreation/`--force-recreate`). Context7 unavailable. Compose host version is unpinned; treat v2 behavior as deployment assumption, not a guaranteed repository pin.

## WHY THIS APPROACH

Complexity: lightweight.  
Justification: Explicit env mapping and a short operator runbook; no application behavior or external service integration is introduced.

## SANDWICH CONTEXT

[CRITICAL: Production env must be explicitly passed into the server container; changing the env file alone does not alter a running process.]  
You are documenting and wiring deployment for the Global Agent Spend Kill Switch.  
Spec: `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md`  
Design decision: startup-only environment flag; operators recreate the server container to apply it.  
Files in scope: `deploy/docker-compose.prod.yml`, `deploy/.env.production.template`, `deploy/README.md`; depends on T1 contract and may run parallel with T2.  
Architecture rule: No client or application deployment topology changes beyond forwarding this one env variable.  
[RESTATE: Production env must be explicitly passed into the server container; changing the env file alone does not alter a running process.]

## DELIVERABLE

Compose explicitly forwards the switch with default false, and the runbook documents enable/disable values, startup-only semantics, the server recreation command, and the possibility that recreation interrupts in-flight work.

## QUALITY BAR

Must-have:
- `[no-tdd — structural task]` — this packet changes deployment configuration and operator prose; the validation is rendered Compose config, not application behavior.
- Both values documented; exact compose service recreation command and working directory clear.
- Compose mapping defaults false; no secrets committed.
- Explicitly distinguish in-process guard behavior from effects of container restart.

Must-not-have:
- No runtime toggle, CI call-site guard, or guarantee of in-flight run survival.

Open question risks:
- Docker Compose v2 host version is not pinned; record operational assumption if command behavior differs on the deployment host.

Rollback note:
- Set false in `.env.production` and recreate server; revert deployment/docs changes if needed. Recreation can terminate active runs.

Red flags:
- Relying only on `.env.production` with no service environment mapping → STOP.

## STOP CONDITIONS

Done when rendered Compose config has the default mapping and operator instructions clearly describe enable/disable/recreate semantics.  
Uncertain when the deployed Compose command/version differs materially from documented v2 behavior.  
Escalate before changing deployment topology or adding startup/health mechanisms.
