# Production deployment

## Agent spend kill switch

`AGENT_SPEND_KILL_SWITCH` controls whether the server accepts new work that would
start an agent/LLM request. It is read when the server starts, not dynamically:
changing `.env.production` alone does not change a running process. The default is
`false` (off). Set it to `true` in `.env.production` to deny newly entered
spend-bearing work, or set it back to `false` to allow that work again.

Apply either value by recreating the server container from the `deploy/`
directory:

```sh
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --force-recreate server
```

The in-process guard blocks new spend-bearing work after startup; it does not
cancel work that has already started. Applying the setting recreates/restarts the
server container and may interrupt active runs. In-flight continuity is not
guaranteed. At startup, the server marks any remaining `running` agent boards as
`failed` without removing their cards, attachments, outputs, conversation history,
tool traces, or artifact. After spend is enabled again, the owner can explicitly
retry a failed attempt. Retry creates a **new board attempt** with the same intent,
conversation history, and execution configuration, but no previous results or
cards; the failed attempt remains accessible. Repeating the retry request returns
the same direct successor without launching it again. This read-only replay is
allowed even while spend is disabled; creating a new attempt is not.

An interruption can occur after an external tool has already taken effect. Retry
starts fresh and may repeat that effect: neither automatic resume nor exactly-once
external execution is guaranteed. Recovery assumes **exactly one server process
per database**: the production Compose file
defines one `server` service, and it must not be scaled or run concurrently against
the same database. A multi-instance deployment needs per-run ownership/lease
coordination before using this recovery behavior.
