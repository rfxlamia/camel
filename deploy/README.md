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
guaranteed.
