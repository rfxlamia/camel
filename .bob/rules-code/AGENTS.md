# AGENTS.md — Code Mode

This file provides coding-specific guidance for agents working in this repository.

## Non-Obvious Coding Rules

**Module system**: Server uses `NodeNext` (ESM) — MUST use `.js` extensions in imports even for `.ts` files. Client uses bundler resolution (no extensions).

**Fractional positioning**: `MIN_SPACING = 1e-9` triggers rebalance. Don't use integer positions when working with card/column ordering.

**Activity logging**: Every mutation MUST call `recordActivity()` to write `card_events` (not automatic). This is required for audit trail.

**Optimistic locking**: Cards have `version` field. Stale writes return HTTP 409 (not 500). Always handle version conflicts.

**Workspace limit**: Hard cap of 10 workspaces per user (enforced in `server/src/routes/helpers.ts` and `client/src/lib/workspaceSwitcher.ts`). Don't bypass this limit.

**Real-time degradation**: Redis Pub/Sub → SSE. Gracefully degrades to in-process fan-out if Redis unreachable (not an error state). Don't treat Redis unavailability as fatal.

**Client typecheck**: `noUnusedLocals` and `noUnusedParameters` enabled — unused imports WILL fail typecheck. Clean up imports.

**Biome overrides**: Test files can use `noExplicitAny` and empty blocks. React hooks rules (`useExhaustiveDependencies`, `useHookAtTopLevel`) enforced ONLY in `client/src/`.

**Subproject isolation**: `camel-lottie/` excluded from monorepo lint, has own `package.json`. Don't apply root lint rules there.

**Database migrations**: `make db-migrate` applies BOTH `schema.sql` AND `agent-schema.sql` (not separate commands).

**Integration tests**: Require `RUN_LLM_IT=1` env var AND running DB. Not run by default `make test`.

**Single test execution**: Run from repo root with full path: `npx vitest run server/src/core/position.test.ts`