# Camel

A kanban board for small dev teams. Built around the six essential kanban
practices: visualize workflow, WIP limits, flow management, explicit
policies, feedback loops, and continuous improvement.

## Stack

- **Frontend:** React + TypeScript + Vite + Tailwind CSS v4 (`client/`)
- **Backend:** Express 5 + TypeScript (`server/`)
- **Database:** PostgreSQL 16 (Docker) — data layer: auth, cards, activity feed
- **Real-time:** Redis 7 (Docker) — presence tracking + Pub/Sub fan-out to SSE
- **Tests:** Vitest (core business logic: positioning, WIP limits, flow metrics)

## Getting started

```sh
# 1. Install dependencies
npm install

# 2. Start PostgreSQL + Redis (Docker)
npm run db:up

# 3. Apply schema and seed demo data
npm run db:migrate
npm run db:seed

# 4. Run server (:3001) and client (:5173)
npm run dev
```

Open http://localhost:5173 and create an account (username + password).

## Team collaboration

Camel is multi-user. All board routes require a signed-in session
(cookie-based, bcrypt-hashed passwords, 30-day expiry).

| Feature | How it works |
|---|---|
| Auth | Register/login with username + password; session cookie (`httpOnly`) |
| Presence | Heartbeat every 25s → Redis key with 60s TTL; header shows who's online |
| Real-time updates | Mutations publish to Redis Pub/Sub → fan-out to clients over SSE |
| Optimistic locking | Cards carry a `version`; a stale write returns HTTP 409 and the client refreshes |
| Activity feed | Every create/update/move/delete is recorded with its actor and shown in the side panel |

If Redis is down the app degrades gracefully: the board still works,
presence shows only yourself, and live updates fall back to in-process
fan-out (single server instance).

## Essential kanban features

| Practice | Where |
|---|---|
| Visualize workflow | Board with columns and drag-and-drop cards |
| WIP limits | Per-column limit; server rejects moves past the limit (HTTP 409) |
| Manage flow | Flow metrics: lead time, cycle time, throughput, WIP count |
| Explicit policies | Editable policy text under each column header |
| Feedback loops | Metrics bar in the header, recomputed on every change |
| Continuous improvement | WIP limits and policies are editable in place |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run server and client together |
| `npm test` | Run unit tests (server core logic) |
| `npm run db:up` | Start PostgreSQL (5432) + Redis (6379) via Docker Compose |
| `npm run db:migrate` | Apply `server/src/db/schema.sql` |
| `npm run db:seed` | Seed demo columns and cards (no-op if data exists) |
| `npm run build` | Type-check and build both workspaces |

## Configuration

The server reads `DATABASE_URL` (defaults to
`postgres://camel:camel@localhost:5432/camel_kanban`), `REDIS_URL`
(defaults to `redis://localhost:6379`), and `PORT` (defaults to `3001`).
