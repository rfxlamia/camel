# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
# Install all dependencies (monorepo root)
npm install

# Start dev servers (server :3001, client :5173)
npm run dev
npm run dev:server   # server only
npm run dev:client   # client only

# Database
npm run db:up        # start PostgreSQL (5432) + Redis (6379) via Docker
npm run db:migrate   # apply server/src/db/schema.sql
npm run db:seed      # seed demo data (no-op if already seeded)

# Tests
npm test                                    # both workspaces
npm run test --workspace=server            # server only
npm run test --workspace=client            # client only
npx vitest run src/core/position.test.ts   # single test file (from server/ or client/)

# Lint & build
npm run lint
npm run build
```

## Architecture

This is an npm monorepo with two workspaces: `client/` (React) and `server/` (Express).

### Server (`server/src/`)

| File / Dir | Role |
|---|---|
| `index.ts` | Express app setup: CORS, cookie-parser, mounts `/api/auth` and `/api` |
| `auth.ts` | bcrypt auth, `requireAuth` middleware, session cookie (30-day) |
| `routes.ts` | All board API routes under `requireAuth`; calls core logic and `recordActivity` |
| `realtime.ts` | Redis Pub/Sub fan-out to SSE clients; graceful degradation if Redis is down |
| `db/pool.ts` | `pg` connection pool; reads `DATABASE_URL` env var |
| `db/schema.sql` | Source of truth for DB schema — migrate with `db:migrate` |
| `core/position.ts` | Fractional positioning (float midpoints) for card/column ordering |
| `core/wip.ts` | WIP limit enforcement (returns violation errors to routes) |
| `core/metrics.ts` | Lead time, cycle time, throughput, WIP computations |

The `core/` modules are pure functions with no DB/Express dependencies — the only server logic covered by unit tests.

### Client (`client/src/`)

| File / Dir | Role |
|---|---|
| `main.tsx` / `App.tsx` | Entry; session check → `BoardProvider` → `RouterProvider` |
| `context/BoardContext.tsx` | Single shared context: columns, metrics, activity, presence, SSE connection, toast |
| `layout/AppLayout.tsx` + `Sidebar.tsx` | Shell with collapsible sidebar; SSE and board state live here, never torn down on navigation |
| `pages/BoardPage.tsx` | Full kanban board with @dnd-kit drag-and-drop |
| `pages/DashboardPage.tsx` | Lazy-loaded; Recharts KPI cards and 8-week trend charts |
| `pages/ActivityPage.tsx` | Team activity feed |
| `components/ContextPanel.tsx` | Card detail panel; route-driven via `/board/card/:cardId` |
| `components/ColumnView.tsx` / `CardView.tsx` | Kanban column and card rendering |
| `api.ts` | Typed fetch wrapper for all API calls |
| `types.ts` | Shared TypeScript interfaces |

### Key design decisions

- **Fractional positions**: cards and columns use float positions (midpoint insertion). If spacing falls below `MIN_SPACING = 1e-9`, a rebalance is triggered.
- **Optimistic locking**: cards carry a `version` field; stale writes return HTTP 409 and the client re-fetches.
- **Real-time**: Redis Pub/Sub → SSE fan-out. If Redis is unreachable, the app degrades to in-process fan-out (single-server only, no presence).
- **WIP limits**: enforced server-side; client receives HTTP 409 on violation.
- **Activity log**: every create/update/move/delete writes a `card_events` row via `recordActivity()` in `routes.ts`.
- **Dashboard code splitting**: `DashboardPage` is `lazy()`-imported so Recharts stays out of the initial bundle.

## UI/UX

Load `docs/pocket/rule/creative-brief.md` before making any UI/design decisions. It is the design-system authority for colors, typography, spacing, and components.
