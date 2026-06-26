# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Non-Obvious Patterns

**Module system**: Server uses `NodeNext` (ESM) — MUST use `.js` extensions in imports even for `.ts` files. Client uses bundler resolution (no extensions).

**Fractional positioning**: `MIN_SPACING = 1e-9` triggers rebalance. Don't use integer positions.

**Database migrations**: `make db-migrate` applies BOTH `schema.sql` AND `agent-schema.sql` (not separate commands).

**Integration tests**: Require `RUN_LLM_IT=1` env var AND running DB. Not run by default `make test`.

**Running tests**: Always use `npm run test` from repo root. Do NOT use `npx vitest run` directly — it skips important setup.
**Single test execution**: Run from repo root with full path: `npm run test -- server/src/core/position.test.ts`

**Client typecheck**: `noUnusedLocals` and `noUnusedParameters` enabled — unused imports WILL fail typecheck.

**Biome overrides**: Test files can use `noExplicitAny` and empty blocks. React hooks rules (`useExhaustiveDependencies`, `useHookAtTopLevel`) enforced ONLY in `client/src/`.

**Workspace limit**: Hard cap of 10 workspaces per user (enforced in `server/src/routes/helpers.ts` and `client/src/lib/workspaceSwitcher.ts`).

**Real-time degradation**: Redis Pub/Sub → SSE. Gracefully degrades to in-process fan-out if Redis unreachable (not an error state).

**Optimistic locking**: Cards have `version` field. Stale writes return HTTP 409 (not 500).

**Activity logging**: Every mutation MUST call `recordActivity()` to write `card_events` (not automatic).

**UI design authority**: `docs/pocket/rule/creative-brief.md` is the source of truth for colors (OKLCH), typography (Work Sans), spacing. Load before making UI decisions.

**Subproject isolation**: `camel-lottie/` excluded from monorepo lint, has own `package.json`. Don't apply root lint rules there.

## Pocket Enterprise

```
enterprise: false
branch_strategy: branch
create_pr: false
```
