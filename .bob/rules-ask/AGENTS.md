# AGENTS.md — Ask Mode

This file provides documentation context for agents working in this repository.

## Non-Obvious Documentation Context

**UI design authority**: `docs/pocket/rule/creative-brief.md` is the source of truth for colors (OKLCH), typography (Work Sans), spacing. Load before making UI decisions.

**Module system**: Server uses `NodeNext` (ESM) — imports require `.js` extensions even for `.ts` files. Client uses bundler resolution (no extensions). This is counterintuitive but required.

**Database migrations**: `make db-migrate` applies BOTH `schema.sql` AND `agent-schema.sql` in a single command (not separate migrations).

**Real-time architecture**: Redis Pub/Sub → SSE with graceful degradation to in-process fan-out. Redis unavailability is NOT an error state.

**Workspace limit**: Hard cap of 10 workspaces per user enforced in both `server/src/routes/helpers.ts` and `client/src/lib/workspaceSwitcher.ts`.

**Subproject isolation**: `camel-lottie/` is a standalone subproject with its own `package.json`, excluded from monorepo lint. Don't apply root lint rules there.

**Integration tests**: Require `RUN_LLM_IT=1` env var AND running DB. Not run by default with `make test`.

**Fractional positioning**: Cards/columns use float positions with `MIN_SPACING = 1e-9` triggering rebalance (not integer positions).

**Activity logging**: Every mutation MUST explicitly call `recordActivity()` to write `card_events` (not automatic).

**Optimistic locking**: Cards have `version` field. Stale writes return HTTP 409 (not 500).