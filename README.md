<div align="center">
  <img src="client/public/logo.png" alt="Camel Kanban logo" width="128" />

  # Camel Kanban

  A kanban board for small dev teams, built around the six essential kanban
  practices: visualize workflow, WIP limits, flow management, explicit
  policies, feedback loops, and continuous improvement.

  ![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?style=flat-square&logo=typescript)
  ![React](https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react)
  ![Express](https://img.shields.io/badge/Express-5-000000?style=flat-square&logo=express)
  ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169e1?style=flat-square&logo=postgresql)
  ![Redis](https://img.shields.io/badge/Redis-7-dc382d?style=flat-square&logo=redis)
</div>

---

## Overview

Camel Kanban is a full-stack, multi-user kanban board designed for small development teams. It combines drag-and-drop card management with real-time collaboration, flow metrics, and WIP limit enforcement — all the practices that make kanban work.

**Key capabilities:**

- Drag-and-drop board with columns, cards, and WIP limits
- Real-time presence and live board updates via SSE + Redis Pub/Sub
- Flow metrics dashboard with weekly trend charts (throughput, lead time, cycle time)
- Optimistic locking for conflict-free multi-user editing
- Activity feed tracking all create/update/move/delete actions
- Team authentication with bcrypt and session cookies

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS v4 |
| Backend | Express 5 + TypeScript |
| Database | PostgreSQL 16 (Docker) |
| Real-time | Redis 7 (Docker) — presence tracking + Pub/Sub fan-out to SSE |
| Tests | Vitest (core business logic: positioning, WIP limits, flow metrics) |

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Docker](https://www.docker.com/) (for PostgreSQL and Redis)

### Quick start

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

Open http://localhost:5173 and create an account (username + password).

> [!TIP]
> Run `make help` to see all available targets. You can also reset the database with `make db-reset` or do a hard reset with `make db-reset-hard` (destructive — removes volumes).

## Project structure

```
camel-kanban/
├── client/              # React frontend (Vite, Tailwind CSS v4)
│   └── src/
│       ├── api.ts       # Typed fetch wrapper for all API calls
│       ├── types.ts     # Shared TypeScript interfaces
│       ├── pages/       # Board, Dashboard, Activity pages
│       ├── components/  # ColumnView, CardView, ContextPanel, etc.
│       ├── context/     # BoardContext (SSE, state, toast)
│       └── layout/      # AppLayout with collapsible sidebar
├── server/              # Express 5 backend (TypeScript)
│   └── src/
│       ├── index.ts     # Express app setup: CORS, cookie-parser, routes
│       ├── auth.ts      # bcrypt auth, requireAuth middleware, session cookie
│       ├── routes.ts    # All board API routes under requireAuth
│       ├── realtime.ts  # Redis Pub/Sub fan-out to SSE clients
│       └── core/        # Pure functions: position, WIP, metrics
├── docker-compose.yml   # PostgreSQL 16 + Redis 7
└── package.json         # npm workspaces monorepo root
```

## Essential kanban features

| Practice | How it works |
|----------|--------------|
| Visualize workflow | Board with columns and drag-and-drop cards |
| WIP limits | Per-column limit; server rejects moves past the limit (HTTP 409) |
| Manage flow | Flow metrics: lead time, cycle time, throughput, WIP count |
| Explicit policies | Editable policy text under each column header |
| Feedback loops | Metrics bar in the header, recomputed on every change |
| Continuous improvement | WIP limits and policies are editable in place |

## Team collaboration

Camel is multi-user. All board routes require a signed-in session (cookie-based, bcrypt-hashed passwords, 30-day expiry).

| Feature | How it works |
|---------|--------------|
| Auth | Register/login with username + password; session cookie (`httpOnly`) |
| Presence | Heartbeat every 25s → Redis key with 60s TTL; header shows who's online |
| Real-time updates | Mutations publish to Redis Pub/Sub → fan-out to clients over SSE |
| Optimistic locking | Cards carry a `version`; a stale write returns HTTP 409 and the client refreshes |
| Activity feed | Every create/update/move/delete is recorded with its actor and shown on the Activity page |

> [!TIP]
> If Redis is down the app degrades gracefully: the board still works, presence shows only yourself, and live updates fall back to in-process fan-out (single server instance only).

## Pages

The client is a multi-page SPA (React Router, client-side routing) with a collapsible sidebar. Deep links and browser back/forward work.

| Page | Route | What's there |
|------|-------|--------------|
| Board | `/board` | Full-width kanban board with drag-and-drop |
| Dashboard | `/dashboard` | Weekly KPI cards and 8-week trend charts (throughput, lead time, cycle time, WIP) |
| Activity | `/activity` | Full team activity feed |

The SSE connection and board state live above the router, so navigation never drops the live connection or reloads board data. The Dashboard page (Recharts) is code-split and loads on first visit.

## Scripts

Run `make help` for the full list. Common targets:

| Command | What it does |
|---------|--------------|
| `make install` | Install all dependencies |
| `make dev` | Run server and client together |
| `make dev-server` | Run server only |
| `make dev-client` | Run client only |
| `make test` | Run unit tests |
| `make build` | Type-check and build both workspaces |
| `make lint` | Run ESLint |
| `make services-up` | Start PostgreSQL + Redis via Docker |
| `make db-migrate` | Apply `server/src/db/schema.sql` |
| `make db-seed` | Seed demo columns and cards |
| `make db-reset` | Stop → start → migrate → seed |
| `make logs` | Tail Docker Compose logs |

## Configuration

The server reads the following environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgres://camel:camel@localhost:5432/camel_kanban` | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `PORT` | `3001` | Server port |

## Testing

Unit tests cover the core business logic (pure functions with no DB/Express dependencies):

```sh
# Run all tests
npm test

# Server tests only
npm run test --workspace=server

# Client tests only
npm run test --workspace=client

# Single test file
npx vitest run src/core/position.test.ts
```

## Architecture decisions

- **Fractional positions**: Cards and columns use float positions (midpoint insertion). If spacing falls below `MIN_SPACING = 1e-9`, a rebalance is triggered.
- **Optimistic locking**: Cards carry a `version` field; stale writes return HTTP 409 and the client re-fetches.
- **Real-time**: Redis Pub/Sub → SSE fan-out. If Redis is unreachable, the app degrades to in-process fan-out (single-server only, no presence).
- **WIP limits**: Enforced server-side; client receives HTTP 409 on violation.
- **Activity log**: Every create/update/move/delete writes a `card_events` row via `recordActivity()`.
- **Dashboard code splitting**: `DashboardPage` is `lazy()`-imported so Recharts stays out of the initial bundle.
