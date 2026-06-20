# AGENTS.md — Plan Mode

This file provides architectural context for agents working in this repository.

## Non-Obvious Architectural Constraints

**Fractional positioning system**: Cards/columns use float positions with midpoint insertion. `MIN_SPACING = 1e-9` triggers rebalance. This avoids reindexing on every move but requires careful handling.

**Optimistic locking pattern**: Cards have `version` field. Stale writes return HTTP 409 (not 500). This prevents lost updates in concurrent editing scenarios.

**Real-time degradation strategy**: Redis Pub/Sub → SSE with graceful degradation to in-process fan-out if Redis unreachable. Redis unavailability is NOT an error state — system continues functioning.

**Activity logging requirement**: Every mutation MUST explicitly call `recordActivity()` to write `card_events`. This is NOT automatic — forgetting this breaks audit trail.

**Workspace capacity enforcement**: Hard cap of 10 workspaces per user enforced in both `server/src/routes/helpers.ts` and `client/src/lib/workspaceSwitcher.ts`. This is a business constraint, not a technical limitation.

**Module system split**: Server uses `NodeNext` (ESM) requiring `.js` extensions in imports even for `.ts` files. Client uses bundler resolution (no extensions). This asymmetry is intentional.

**Database migration coupling**: `make db-migrate` applies BOTH `schema.sql` AND `agent-schema.sql` in a single command. These are not separate migration systems.

**Subproject isolation**: `camel-lottie/` is a standalone subproject with its own `package.json`, excluded from monorepo lint. It has different build/lint rules.

**Client typecheck strictness**: `noUnusedLocals` and `noUnusedParameters` enabled — unused imports WILL fail typecheck. This is stricter than typical React projects.

**Integration test opt-in**: Integration tests require `RUN_LLM_IT=1` env var AND running DB. Not run by default with `make test` to avoid CI failures.