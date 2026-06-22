<div align="center">
  <img src="client/public/logo.png" alt="Camel Kanban logo" width="128" />

# Camel Kanban

  A kanban board for small dev teams, built around the six essential kanban
  practices: visualize workflow, WIP limits, flow management, explicit
  policies, feedback loops, and continuous improvement — with an integrated
  LLM agent pipeline for research and reporting.

  ![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?style=flat-square&logo=typescript)
  ![React](https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react)
  ![Express](https://img.shields.io/badge/Express-5-000000?style=flat-square&logo=express)
  ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169e1?style=flat-square&logo=postgresql)
  ![Redis](https://img.shields.io/badge/Redis-7-dc382d?style=flat-square&logo=redis)
  ![Anthropic](https://img.shields.io/badge/Anthropic-Claude-d4a574?style=flat-square&logo=anthropic)
</div>

---

## Overview

Camel Kanban is a full-stack, multi-user kanban board designed for small development teams. It combines drag-and-drop card management with real-time collaboration, flow metrics, WIP limit enforcement, and an agentic LLM pipeline for automated research and reporting.

**Key capabilities:**

- Drag-and-drop board with columns, cards, and WIP limits
- Multi-workspace with invite-based membership (up to 10 workspaces per user)
- Agentic Kanban — LLM pipeline (Research & Report, Status Report) with streaming and tool use
- Real-time presence and live board updates via SSE + Redis Pub/Sub
- Flow metrics dashboard with weekly trend charts (throughput, lead time, cycle time)
- Optimistic locking for conflict-free multi-user editing
- Card assignees and due dates for team coordination
- Activity feed tracking all create/update/move/delete actions
- Auth with password (bcrypt) or OAuth (Google, GitHub) via Better Auth

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

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Docker](https://www.docker.com/) (for PostgreSQL and Redis)
- `make` — pre-installed on macOS/Linux. On Windows, install via [WSL](https://learn.microsoft.com/en-us/windows/wsl/install), [Chocolatey](https://chocolatey.org/) (`choco install make`), or [Scoop](https://scoop.sh/) (`scoop install make`).

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

Open <http://localhost:5173> and create an account (username + password).

### Agent setup (optional)

The agentic kanban features (Research & Report, Status Report) require an LLM backend. Copy the server env template and fill in the keys:

```sh
cp server/.env.example server/.env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key (or else, must be anthropic compatible for now) |
| `ANTHROPIC_BASE_URL` | No | Custom endpoint URL (e.g. MiMo). Leave unset for real Anthropic |
| `ANTHROPIC_MODEL` | No | Model override  |
| `TAVILY_API_KEY` | No | [Tavily](https://tavily.com) key for the agent's web search tool |

### OAuth setup (optional)

To enable Google/GitHub login, set these in `server/.env`:

```sh
OAUTH_ENABLED=true
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
APP_BASE_URL=http://localhost:3001
CLIENT_URL=http://localhost:5173
```

> [!TIP]
> Run `make help` to see all available targets. You can also reset the database with `make db-reset` or do a hard reset with `make db-reset-hard` (destructive — removes volumes).

## Project structure

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

## Essential kanban features

| Practice | How it works |
|----------|--------------|
| Visualize workflow | Board with columns and drag-and-drop cards |
| WIP limits | Per-column limit; server rejects moves past the limit (HTTP 409) |
| Manage flow | Flow metrics: lead time, cycle time, throughput, WIP count |
| Explicit policies | Editable policy text under each column header |
| Feedback loops | Metrics bar in the header, recomputed on every change |
| Continuous improvement | WIP limits and policies are editable in place |
| Team coordination | Card assignees and due dates |
| Multi-workspace | Separate boards per project/team, invite-based membership |

## Team collaboration

Camel is multi-user. All board routes require a signed-in session (cookie-based, 30-day expiry).

| Feature | How it works |
|---------|--------------|
| Auth | Register/login with username + password, or OAuth (Google/GitHub) via Better Auth |
| Rate limiting | Login failures capped at 5 per 15 min per account; IP-scoped rate limiter on auth endpoints |
| Workspaces | Each user gets a personal workspace on signup; create up to 10 workspaces with invite-based membership |
| Presence | Heartbeat every 25s → Redis key with 60s TTL; header shows who's online |
| Real-time updates | Mutations publish to Redis Pub/Sub → fan-out to clients over SSE |
| Optimistic locking | Cards carry a `version`; a stale write returns HTTP 409 and the client refreshes |
| Activity feed | Every create/update/move/delete is recorded with its actor and shown on the Activity page |

> [!TIP]
> If Redis is down the app degrades gracefully: the board still works, presence shows only yourself, and live updates fall back to in-process fan-out (single server instance only).

## Agentic kanban

An integrated LLM pipeline turns user intent into structured, multi-agent research or status reports.

| Template | Pipeline | What it does |
|----------|----------|--------------|
| Research & Report | Research Specialist → Analysis Specialist → Writer → Editor → QA Guardian | 5-agent chain: gathers facts, extracts insights, writes a polished document, edits for clarity, and QA-validates before persisting |
| Status Report | Analyst → QA Guardian | Queries live board data (flow metrics, activity) and produces a grounded status report |

**How it works:**

1. User describes an intent on the Agent page (e.g. "Research EV market in Indonesia")
2. The server classifies the intent, generates a board of agent columns, and streams execution via SSE
3. Each column runs sequentially — the LLM processes the task with extended thinking, optionally using tools (web search via Tavily, file creation)
4. Outputs accumulate and hand off to the next agent column
5. The QA Guardian validates the final artifact against the original intent
6. Follow-up messages are classified (ASK / REFINE / NEW_DIRECTION / OFF_TOPIC) with scope-guard rules

**Tools available to agents:**

- `web_search` — Tavily-powered web search for factual grounding
- `create_file` — persists the final deliverable as an artifact

> [!NOTE]
> Agent features require `ANTHROPIC_API_KEY` in `server/.env`. The LLM layer supports real Anthropic API and compatible endpoints (e.g. Xiaomi MiMo). Extended thinking is enabled for all agent columns.

## Pages

The client is a multi-page SPA (React Router, client-side routing) with a collapsible sidebar. Deep links and browser back/forward work.

| Page | Route | What's there |
|------|-------|--------------|
| Board | `/board` | Full-width kanban board with drag-and-drop |
| Dashboard | `/dashboard` | Weekly KPI cards and 8-week trend charts (throughput, lead time, cycle time, WIP) |
| Agent | `/agent` | LLM agent interaction — create boards, stream execution, follow-up conversations |
| Activity | `/activity` | Full team activity feed |
| Settings | `/settings` | Board name, logo upload, workspace management |

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
| `make lint` | Run Biome |
| `make services-up` | Start PostgreSQL + Redis via Docker |
| `make db-migrate` | Apply `server/src/db/schema.sql` |
| `make db-seed` | Seed demo columns and cards |
| `make db-reset` | Stop → start → migrate → seed |
| `make logs` | Tail Docker Compose logs |

## Configuration

The server reads the following environment variables (all validated at startup via Zod — missing required vars crash with a clear message):

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | *(required)* | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | *(required)* | Anthropic API key (or compatible endpoint key) |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `PORT` | `3001` | Server port |
| `ANTHROPIC_BASE_URL` | *(unset)* | Custom LLM endpoint URL (e.g. MiMo). Leave unset for real Anthropic |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` | Model override |
| `TAVILY_API_KEY` | *(unset)* | Tavily API key for agent web search |
| `OAUTH_ENABLED` | `false` | Enable Google/GitHub OAuth via Better Auth |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | *(unset)* | Google OAuth credentials |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | *(unset)* | GitHub OAuth credentials |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated allowed CORS origins |

See [`server/.env.example`](server/.env.example) for the full template.

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
- **Agent pipeline**: Multi-column sequential execution with extended thinking. Each column runs as a separate LLM call with accumulated previous outputs. Supports tool use (web search, file creation) with configurable budgets.
- **Soft delete**: Cards are marked with `deleted_at`, not removed, so activity history and foreign keys survive.
- **Auth security**: Login failures capped per account (5 per 15 min), IP-scoped rate limiting, session fixation prevention on login, bcrypt password hashing.
- **Env validation**: Zod schema at startup — missing required vars crash immediately with actionable error messages.
