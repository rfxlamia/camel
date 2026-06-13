# Tech Debt Audit — Camel Kanban

**Date:** 2026-06-13  
**Scope:** Full monorepo (`server/`, `client/`, schema, infra config)  
**Scoring:** Priority = (Impact + Risk) × (6 − Effort), where each dimension is 1–5 (Effort inverted: lower = higher priority)

---

## Summary

| # | Item | Category | Priority |
|---|------|----------|----------|
| 1 | CORS `origin: true` in production | Infrastructure | **35** |
| 2 | No HTTP-layer integration tests for routes | Test | **27** |
| 3 | `lookupMembership` called redundantly per request | Code | **24** |
| 4 | Manual ad-hoc input validation (no schema library) | Code | **21** |
| 5 | No structured logging or health-depth monitoring | Infrastructure | **21** |
| 6 | Test helpers exported from production `routes.ts` | Code | **20** |
| 7 | Redis has no reconnection logic | Architecture | **20** |
| 8 | Expired sessions never purged from DB | Infrastructure | **20** |
| 9 | `vitest` major-version mismatch across workspaces | Dependency | **15** |
| 10 | `routes.ts` 1,439-line monolith | Architecture | **14** |
| 11 | `BoardContext` god object (30+ values) | Code | **12** |
| 12 | Schema.sql as migration file — no rollback | Architecture | **12** |
| 13 | No client component tests | Test | **12** |
| 14 | Logo uploads on local disk, no cleanup | Infrastructure | **10** |

---

## Findings

### 1 — CORS `origin: true` in production
**Category:** Infrastructure · Impact: 2 · Risk: 5 · Effort: 1 · **Priority: 35**

`server/src/index.ts` sets `cors({ origin: true, credentials: true })`. This reflects every origin and pairs it with `Access-Control-Allow-Credentials: true`, meaning any domain can make credentialed requests to the API. In production this allows malicious sites to read authenticated user data via the session cookie.

**Fix:** Set `origin` to an allowlist (e.g., `process.env.CORS_ORIGIN?.split(",")`) and add the allowed production domain. Effort is minimal — one line change with an env var. Should be done before the app is publicly accessible.

---

### 2 — No HTTP-layer integration tests for routes
**Category:** Test · Impact: 5 · Risk: 4 · Effort: 3 · **Priority: 27**

All server tests cover pure functions (`core/position`, `core/metrics`, `core/wip`) or in-memory service stubs (`createWorkspaceIntegrationHarness`). The actual Express routes — their auth middleware, SQL queries, HTTP status codes, and error paths — are completely untested. A bug in `requireAuth`, a wrong SQL column name, or a missing `workspace_id` filter would only surface in production.

**Fix:** Add `supertest` and a test DB (or Postgres container in CI). Write route integration tests for the most critical flows: auth, board CRUD, move (WIP enforcement), and workspace membership. The `createRealtimeHub` factory pattern already makes the realtime layer injectable, which helps.

---

### 3 — `lookupMembership` called redundantly per request
**Category:** Code · Impact: 3 · Risk: 3 · Effort: 2 · **Priority: 24**

Nearly every route handler issues `await lookupMembership(req.user!.id, workspaceId)` as its authorization step. Complex handlers call it 2–3 times (e.g., `POST /members` calls `lookupMembership` for the actor, then again for the target inside `createWorkspaceAccessService`). Each call is a separate round-trip to the DB.

**Fix:** Move the membership lookup into a scoped middleware: `requireWorkspaceMember(workspaceId)` that attaches `req.workspaceMembership` and short-circuits with 404 if missing. Route handlers consume `req.workspaceMembership` without querying again.

---

### 4 — Manual ad-hoc input validation (no schema library)
**Category:** Code · Impact: 3 · Risk: 4 · Effort: 3 · **Priority: 21**

Every route handler hand-rolls input validation with `typeof x !== "string"`, `Number.isInteger(x)`, `x.trim() === ""` etc. The pattern is inconsistent: some routes use `parseWorkspaceId()`, others inline `Number(req.params.workspaceId)` with a separate integer check. Edge cases are easy to miss (e.g., `description` accepted as any type via `description ?? ""`).

**Fix:** Introduce [Zod](https://zod.dev/) (already a common dependency in the ecosystem). Define request schemas per route and call `schema.parse(req.body)` at the top. Validation errors automatically return 400 with structured messages. Start with the most-used routes (card create/update/move).

---

### 5 — No structured logging or health-depth monitoring
**Category:** Infrastructure · Impact: 3 · Risk: 4 · Effort: 3 · **Priority: 21**

The error handler does `console.error(err)` with no request ID, no log level, and no structured format. The `/health` endpoint returns `{ ok: true }` regardless of DB or Redis connectivity. When an incident occurs there is no way to correlate a user-visible error back to a specific request or timeframe.

**Fix:** (a) Add `pino` for structured JSON logging — attach a `requestId` header (nanoid) at middleware level, log it on every error. (b) Deepen `/health` to probe the DB (`SELECT 1`) and Redis (`PING`) and return their status. This enables load-balancer health checks to actually detect degraded states.

---

### 6 — Test helpers exported from production `routes.ts`
**Category:** Code · Impact: 3 · Risk: 2 · Effort: 2 · **Priority: 20**

`createWorkspaceIntegrationHarness`, `legacyWorkspaceRouteMatrix`, and their supporting types are defined in and exported from `server/src/routes.ts` — the same file as all the Express route handlers. This couples test infrastructure to production code, inflates the bundle of anything importing `routes`, and makes it harder to tree-shake or reason about what's public API.

**Fix:** Move the harness and matrix to `server/src/test/workspaceHarness.ts` (or a `__tests__` directory). Update the test import paths. The pure service factories (`createScopedBoardService`, `createWorkspaceAccessService`) that the harness depends on can stay in `routes.ts` or move to their own module.

---

### 7 — Redis has no reconnection logic
**Category:** Architecture · Impact: 2 · Risk: 3 · Effort: 2 · **Priority: 20**

In `realtime.ts`, `publisher` and `subscriber` are created once at module load. On error, `redisAvailable` is flipped to `false` and `activeHub` keeps using null publisher (local fan-out). But there is no retry or reconnection loop. If Redis restarts or has a transient network blip, the app stays in degraded mode until the process is restarted.

**Fix:** The `redis` client v4 supports `socket: { reconnectStrategy }`. Configure exponential backoff on reconnect and, once reconnected, re-run `connectRedis()` to swap `activeHub` back to the Redis-backed instance.

---

### 8 — Expired sessions never purged from DB
**Category:** Infrastructure · Impact: 2 · Risk: 3 · Effort: 2 · **Priority: 20**

Sessions are written with an `expires_at` and checked on each request (`WHERE expires_at > now()`), but they are never deleted. Over time the `sessions` table accumulates unbounded rows. This degrades `requireAuth` query performance as the table grows and wastes storage.

**Fix:** Add a periodic cleanup query (e.g., on app startup and every 24 hours): `DELETE FROM sessions WHERE expires_at < now()`. Alternatively, use `pg_cron` if available. Effort is a few lines.

---

### 9 — `vitest` major-version mismatch across workspaces
**Category:** Dependency · Impact: 1 · Risk: 2 · Effort: 1 · **Priority: 15**

`client/package.json` depends on `vitest@^4.1.8` while `server/package.json` uses `vitest@^2.1.8`. The two workspaces run the same test command (`npm test`) but against different vitest major versions. This can cause subtle API differences (config options, reporter formats) and makes version management harder.

**Fix:** Align both workspaces on the same vitest major version. Likely the server should be bumped to v4 (verify config compatibility). Then hoist `vitest` to the monorepo root `devDependencies`.

---

### 10 — `routes.ts` is a 1,439-line monolith
**Category:** Architecture · Impact: 4 · Risk: 3 · Effort: 4 · **Priority: 14**

All board API routes — workspaces, members, invites, columns, cards, move, metrics, activity, presence, SSE — live in a single file. Only `settings` was extracted. This causes: frequent merge conflicts on that file, difficulty finding specific logic, and an all-or-nothing import for tests.

**Fix:** Extract route families into sub-routers following the pattern already established by `routes/settings.ts`:
- `routes/workspaces.ts` — workspace CRUD + membership + invites
- `routes/board.ts` — columns + cards + move
- `routes/metrics.ts` — flow metrics + history
- `routes/activity.ts` — activity feed
- `routes/presence.ts` — heartbeat + SSE

The shared helpers (`lookupMembership`, `parseWorkspaceId`, `recordActivity`) move to `routes/shared.ts`. `routes.ts` becomes a thin router that mounts sub-routers. Do this incrementally — one sub-router at a time.

---

### 11 — `BoardContext` is a god object (30+ values)
**Category:** Code · Impact: 4 · Risk: 2 · Effort: 4 · **Priority: 12**

`BoardContext.tsx` is a single context provider that manages: workspace list, active workspace, invitation state, board columns, metrics, activity, presence, toasts, settings, unsaved-edit tracking, and workspace-switch confirmation. Any state change anywhere re-renders all consumers. As the app grows this becomes a performance and testability problem.

**Fix:** Split into focused contexts: `WorkspaceContext` (workspace list, invites, create/switch), `BoardDataContext` (columns, metrics, activity), `UIContext` (toast, unsaved edits), `SettingsContext`. This is a larger refactor — defer until it causes measurable performance issues, but avoid adding more state to the existing context in the meantime.

---

### 12 — `schema.sql` doubles as a migration system
**Category:** Architecture · Impact: 2 · Risk: 4 · Effort: 4 · **Priority: 12**

All schema changes are appended to `schema.sql` as `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` and `DO $$` PL/pgSQL blocks. There is no migration versioning, no rollback path, and ordering depends on file position. The `DO $$` blocks that enforce `NOT NULL` silently skip the constraint if any row has a NULL value, meaning the enforcement may never fire on a real DB with legacy data.

**Fix:** Adopt a proper migration tool (e.g., `node-pg-migrate` or `golang-migrate`). Freeze `schema.sql` as the baseline, then write all future changes as numbered up/down migration files. This is a medium-effort change to the developer workflow. The current system is acceptable for a small team but will become painful when two developers write concurrent schema changes.

---

### 13 — No client component tests
**Category:** Test · Impact: 3 · Risk: 3 · Effort: 4 · **Priority: 12**

Client tests cover only pure utility functions (`cardPanel`, `title`, `workspaceSelection`, `workspaceSwitcher`). The actual React components — `BoardPage`, `ContextPanel`, `CardView`, `ColumnView`, `PresenceBar`, `Toast` — have zero coverage. UI regressions in the drag-and-drop flow, optimistic update handling, or conflict resolution UI can only be caught manually.

**Fix:** Add `@testing-library/react` and write tests for the highest-risk components first: `ContextPanel` (conflict resolution flow), `CardView` (WIP badge display), and `Toast` (deduplication/timing). Don't aim for full coverage immediately — focus on behaviour that can't be caught by TypeScript alone.

---

### 14 — Logo uploads stored on local disk with no cleanup of old files
**Category:** Infrastructure · Impact: 2 · Risk: 3 · Effort: 4 · **Priority: 10**

`UPLOADS_DIR` points to `client/public/uploads` inside the repo. This means uploaded logos: (a) don't survive a fresh deploy or container restart, (b) accumulate old logo files (only the current logo is served; previous filenames are abandoned), and (c) won't work in a horizontally-scaled deployment.

**Fix:** Short-term: ensure the settings update handler reliably deletes the previous logo file (currently marked "best-effort"). Medium-term: move uploads to object storage (S3/R2/Cloudflare). The route handler is already isolated in `routes/settings.ts`, so the storage backend can be swapped without touching other code.

---

## Remediation Plan

### Phase 1 — Security & Stability (1–2 weeks, alongside feature work)

These have high risk and low effort. Do them now.

1. **CORS allowlist** — one-line fix + env var. Ship before any public URL is shared.
2. **Expired session purge** — add a startup + 24-hour cleanup query.
3. **Redis reconnection strategy** — configure `reconnectStrategy` on the redis client.
4. **vitest version alignment** — bump server to v4, hoist to root.

### Phase 2 — Test Coverage (2–4 weeks)

The absence of route integration tests is the biggest ongoing risk. Every schema change or route edit is untested at the HTTP layer.

5. **Route integration tests** — add `supertest`, a test DB, and cover auth, CRUD, move, and workspace membership. Aim for the 10 most-used endpoints first.
6. **Move test helpers out of `routes.ts`** — low effort, unblocks cleaner imports in tests.
7. **Structured logging + deep `/health`** — add `pino`, request IDs, and DB/Redis health probes.

### Phase 3 — Maintainability (1–2 sprints, planned)

These are higher effort and should be scoped as dedicated tasks.

8. **`lookupMembership` middleware** — refactor to `requireWorkspaceMember` middleware.
9. **Zod input validation** — introduce schema validation starting with card and move routes.
10. **Extract sub-routers from `routes.ts`** — one sub-router per sprint, starting with `workspaces.ts`.
11. **Client component tests** — add `@testing-library/react`, cover `ContextPanel` and conflict flow.

### Phase 4 — Architecture (backlog)

These require more planning and can wait until the team hits the pain point.

12. **Migration tooling** — evaluate `node-pg-migrate`; freeze `schema.sql` as baseline.
13. **Logo uploads to object storage** — only necessary when deploying to production containers.
14. **`BoardContext` split** — only prioritize when rendering performance becomes measurable.
