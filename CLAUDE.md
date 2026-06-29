# Camel Kanban

A kanban board for micro teams, built around the six essential kanban practices: visualize workflow, WIP limits, flow management, explicit policies, feedback loops, and continuous improvement — with an integrated LLM agent pipeline for research and reporting.

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS v4 |
| Backend | Express 5 + TypeScript (NodeNext ESM) |
| Database | PostgreSQL 16 (Docker) |
| Real-time | Redis 7 (Docker) — presence tracking + Pub/Sub fan-out to SSE |
| LLM | Anthropic SDK (Claude / MiMo-compatible endpoints) + Tavily web search |
| Auth | bcrypt + session cookies, Better Auth (Google/GitHub OAuth) |
| Tests | Vitest (core business logic: positioning, WIP limits, flow metrics, agent) |
| Lint | Biome |

## Project Structure

```
camel-kanban/
├── client/              # React frontend (Vite, Tailwind CSS v4)
│   └── src/
│       ├── api.ts       # Typed fetch wrapper for all API calls
│       ├── types.ts     # Shared TypeScript interfaces
│       ├── pages/       # Board, Dashboard, Agent, Activity, Settings
│       ├── components/  # ColumnView, CardView, ContextPanel, AgentChat, etc.
│       ├── hooks/       # useAgentBoard, useAgentChat
│       ├── context/     # BoardContext (SSE, state, toast)
│       └── layout/      # AppLayout with collapsible sidebar
├── server/              # Express 5 backend (TypeScript, NodeNext ESM)
│   └── src/
│       ├── index.ts     # Express app setup: CORS, cookie-parser, routes
│       ├── auth.ts      # bcrypt + Better Auth, rate limiting, session cookie
│       ├── routes.ts    # All board API routes under requireAuth
│       ├── realtime.ts  # Redis Pub/Sub fan-out to SSE clients
│       ├── core/        # Pure functions: position, WIP, metrics
│       ├── agent/       # LLM pipeline: templates, tools, streaming
│       └── db/          # Pool, migrations, seed, Redis client
├── docker-compose.yml   # PostgreSQL 16 + Redis 7
└── package.json         # npm workspaces monorepo root
```

## Development Guidelines

### Module System

- **Server**: Uses `NodeNext` (ESM) — MUST use `.js` extensions in imports even for `.ts` files
- **Client**: Uses bundler resolution (no extensions in imports)

### Fractional Positioning

Cards and columns use float positions (midpoint insertion). If spacing falls below `MIN_SPACING = 1e-9`, a rebalance is triggered. Never use integer positions.

### Database

- Single migration file: `server/src/db/schema.sql`
- Agent schema: `server/src/db/agent-schema.sql`
- Run `make db-migrate` to apply BOTH schemas
- Use `IF NOT EXISTS` for idempotent migrations

### Real-time System

Redis Pub/Sub → SSE fan-out. Gracefully degrades to in-process fan-out if Redis unreachable (not an error state).

### Optimistic Locking

Cards have a `version` field. Stale writes return HTTP 409 (not 500). Clients must send the version they last saw.

### Activity Logging

Every mutation MUST call `recordActivity()` to write `card_events` (not automatic).

### Workspace Limit

Hard cap of 10 workspaces per user (enforced in `server/src/routes/helpers.ts` and `client/src/lib/workspaceSwitcher.ts`).

### UI Design Authority

`docs/pocket/rule/creative-brief.md` is the source of truth for colors (OKLCH), typography (Work Sans), spacing. Load before making UI decisions.

### Subproject Isolation

`camel-lottie/` excluded from monorepo lint, has own `package.json`. Don't apply root lint rules there.

## Testing

### Run Tests

```bash
# All tests (server + client)
npm test

# Server tests only
npm run test --workspace=server

# Client tests only
npm run test --workspace=client

# Single test file (from repo root)
npm run test -- server/src/core/position.test.ts

# Watch mode
make test-watch

# Integration tests (requires running DB + Redis)
RUN_LLM_IT=1 npm run test:integration --workspace=server
```

### Test Patterns

- Unit tests cover core business logic (pure functions with no DB/Express dependencies)
- Tests live alongside source files (`*.test.ts`, `*.test.tsx`)
- Biome allows `any` types and empty blocks in test files
- Client tests use `@testing-library/react`

## Common Commands

| Command | Description |
|---------|-------------|
| `make install` | Install all dependencies |
| `make dev` | Run server and client together |
| `make dev-server` | Run server only |
| `make dev-client` | Run client only |
| `make test` | Run unit tests |
| `make build` | Type-check and build both workspaces |
| `make lint` | Run Biome |
| `make services-up` | Start PostgreSQL + Redis via Docker |
| `make db-migrate` | Apply database schema |
| `make db-seed` | Seed demo data |
| `make db-reset` | Stop → start → migrate → seed |
| `make logs` | Tail Docker Compose logs |

## Environment Setup

### Required Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | *(required)* | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | *(required)* | Anthropic API key (or compatible endpoint key) |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `PORT` | `3001` | Server port |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_BASE_URL` | *(unset)* | Custom LLM endpoint URL (e.g. MiMo) |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` | Model override |
| `TAVILY_API_KEY` | *(unset)* | Tavily API key for agent web search |
| `OAUTH_ENABLED` | `false` | Enable Google/GitHub OAuth |

### Quick Start

```sh
# 1. Install dependencies
make install

# 2. Start PostgreSQL + Redis
make services-up

# 3. Apply schema and seed demo data
make db-migrate
make db-seed

# 4. Run server (:3001) and client (:5173)
make dev
```

## Key Files

| File | Purpose |
|------|---------|
| `server/src/core/position.ts` | Fractional positioning logic |
| `server/src/core/wip.ts` | WIP limit enforcement |
| `server/src/core/metrics.ts` | Flow metrics calculation |
| `server/src/realtime.ts` | SSE + Redis Pub/Sub |
| `server/src/agent/service.ts` | LLM pipeline orchestration |
| `server/src/db/schema.sql` | Database schema |
| `client/src/api.ts` | Typed API client |
| `client/src/context/BoardContext.tsx` | Board state + SSE |
| `docs/pocket/rule/creative-brief.md` | UI design authority |

## Architecture Decisions

- **Fractional positions**: Float positions with midpoint insertion; rebalance when spacing < 1e-9
- **Optimistic locking**: `version` field on cards; HTTP 409 on stale writes
- **Real-time**: Redis Pub/Sub → SSE; graceful degradation to in-process fan-out
- **WIP limits**: Server-side enforcement; HTTP 409 on violation
- **Activity log**: Every mutation writes `card_events` via `recordActivity()`
- **Dashboard code splitting**: `DashboardPage` is `lazy()`-imported
- **Agent pipeline**: Multi-column sequential execution with extended thinking
- **Soft delete**: Cards marked with `deleted_at`, not removed
- **Auth security**: Rate limiting, session fixation prevention, bcrypt hashing
- **Env validation**: Zod schema at startup; missing required vars crash immediately
