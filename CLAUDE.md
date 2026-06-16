# CLAUDE.md

npm monorepo with two workspaces: `client/` (React 18 + Vite + Tailwind v4) and `server/` (Express 5 + TypeScript). PostgreSQL 16 + Redis 7 via Docker.

## Commands

```sh
npm install                        # install all deps (run from repo root)
make dev                           # start server (:3001) + client (:5173)
make dev-server                    # server only
make dev-client                    # client only

make services-up                   # start PostgreSQL + Redis via Docker
make db-migrate                    # applies schema.sql AND agent-schema.sql
make db-seed                       # seed demo data
make db-reset                      # stop → start → migrate → seed

make test                          # run all tests (server + client)
make typecheck                     # tsc --noEmit on both workspaces
make lint                          # Biome linter (NOT ESLint)

# single test file (from repo root):
npx vitest run server/src/core/position.test.ts
npx vitest run client/src/lib/title.test.ts

# server integration tests (opt-in, needs DB + LLM keys):
RUN_LLM_IT=1 npm run test:integration --workspace=server
```

## Lint & Format

Uses **Biome** (not ESLint). Config at `biome.json`.

- **Tabs** for indentation, **double quotes** for JS/TS strings
- `npm run lint` — check for lint errors
- `npm run lint:fix` — auto-fix (`biome check --write .`)
- `camel-lottie/` is excluded from lint (separate subproject)
- React hooks lint rules (`useExhaustiveDependencies`, `useHookAtTopLevel`) enforced in `client/src/`
- `noExplicitAny` is **off** in test files

## Typecheck

```sh
make typecheck    # runs tsc --noEmit on server/ then client/
```

Run this before committing. The client tsconfig has `noUnusedLocals` and `noUnusedParameters` enabled — unused imports will fail.

## Testing

Tests use **Vitest**. Client tests run in **jsdom** environment.

- Server `core/` modules (position, wip, metrics) are pure functions — the only server logic with unit tests
- Client unit tests: `client/src/**/*.test.{ts,tsx}`
- Integration tests (`pipeline.integration.test.ts`) require `RUN_LLM_IT=1` env var and a running DB
- Test files can use `noExplicitAny` and empty blocks (Biome overrides)

## Architecture

### Server (`server/src/`)

| File / Dir            | Role                                                         |
| --------------------- | ------------------------------------------------------------ |
| `index.ts`            | Express setup: CORS, cookie-parser, mounts `/api/auth`, `/api`, and agent routes |
| `auth.ts`             | bcrypt auth, `requireAuth` middleware, session cookie (30-day) |
| `routes.ts`           | Board API routes under `requireAuth`                         |
| `routes/`             | Additional route modules (settings, workspace access)        |
| `realtime.ts`         | Redis Pub/Sub fan-out to SSE; degrades to in-process if Redis down |
| `agent/`              | LLM pipeline: routes, service, templates, tool registry, web search (Tavily) |
| `core/`               | Pure functions: fractional positioning, WIP limits, flow metrics |
| `db/pool.ts`          | pg pool; reads `DATABASE_URL` or defaults to `postgres://camel:camel@localhost:5432/camel_kanban` |
| `db/schema.sql`       | Main DB schema                                               |
| `db/agent-schema.sql` | Agent subsystem schema (applied by same migrate script)      |

### Client (`client/src/`)

| File / Dir                    | Role                                                         |
| ----------------------------- | ------------------------------------------------------------ |
| `main.tsx` / `App.tsx`        | Entry; session check → `BoardProvider` → `RouterProvider`    |
| `context/BoardContext.tsx`    | Shared context: columns, metrics, activity, presence, SSE, toast |
| `layout/`                     | `AppLayout` + collapsible sidebar; SSE state lives here, survives navigation |
| `pages/BoardPage.tsx`         | Kanban board with @dnd-kit drag-and-drop                     |
| `pages/DashboardPage.tsx`     | Lazy-loaded Recharts KPI cards + 8-week trends               |
| `pages/AgentPage.tsx`         | LLM agent interaction page                                   |
| `components/ContextPanel.tsx` | Card detail panel; route-driven via `/board/card/:cardId`    |
| `api.ts`                      | Typed fetch wrapper for all API calls                        |
| `types.ts`                    | Shared TypeScript interfaces                                 |
| `lib/`                        | Utility modules (workspace switching, validation, agent queue, etc.) |

### Key design decisions

- **Fractional positions**: float midpoints for card/column ordering. `MIN_SPACING = 1e-9` triggers rebalance.
- **Optimistic locking**: cards have `version` field; stale writes return HTTP 409.
- **Real-time**: Redis Pub/Sub → SSE. Graceful degradation to in-process fan-out if Redis unreachable.
- **WIP limits**: server-side enforcement; HTTP 409 on violation.
- **Activity log**: every mutation writes `card_events` via `recordActivity()`.
- **Dashboard code splitting**: `DashboardPage` is `lazy()`-imported.
- **Module system**: server uses `NodeNext` (ESM, `.js` extensions in imports); client uses bundler resolution.

## UI/UX

Load `docs/pocket/rule/creative-brief.md` before making UI/design decisions. It is the design-system authority: colors (OKLCH), typography (Work Sans), spacing, component patterns.

## Other subprojects

`camel-lottie/` — standalone Lottie animation player (Vite + CanvasKit/Skia). Has its own `package.json`, excluded from monorepo lint. See its `README.md` for details.
