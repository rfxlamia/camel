# Server Directory Index

Express 5 + TypeScript backend for Camel Kanban. PostgreSQL 16 + Redis 7.

## Files

- **[index.ts](./src/index.ts)** - Express app setup: CORS, cookie-parser, mounts auth, api, and agent routers
- **[auth.ts](./src/auth.ts)** - bcrypt auth, `requireAuth` middleware, session cookie (30-day)
- **[config.ts](./src/config.ts)** - Env var validation via Zod; crashes at startup if required vars missing
- **[routes.ts](./src/routes.ts)** - Main API router; assembles and mounts all sub-routers under `requireAuth`
- **[realtime.ts](./src/realtime.ts)** - Redis Pub/Sub fan-out to SSE; degrades to in-process if Redis down
- **[package.json](./package.json)** - Dependencies: express, pg, redis, anthropic-ai/sdk, bcryptjs, tavily
- **[tsconfig.json](./tsconfig.json)** - TypeScript config (NodeNext module system, ESM)
- **[.env.example](./.env.example)** - Environment variable template

## Subdirectories

### src/core/

Pure functions — the only server logic with unit tests.

- **[cors.ts](./src/core/cors.ts)** - CORS origin allowlist validator from CORS_ORIGIN env var
- **[metrics.ts](./src/core/metrics.ts)** - Flow metrics computation (cycle time, throughput, flow efficiency)
- **[position.ts](./src/core/position.ts)** - Fractional positioning: float midpoints for card/column ordering
- **[wip.ts](./src/core/wip.ts)** - WIP limit enforcement; returns HTTP 409 on violation

### src/db/

Database layer.

- **[pool.ts](./src/db/pool.ts)** - pg pool; reads `DATABASE_URL` or defaults to `postgres://camel:camel@localhost:5432/camel_kanban`
- **[migrate.ts](./src/db/migrate.ts)** - Runs schema.sql and agent-schema.sql in a transaction
- **[seed.ts](./src/db/seed.ts)** - Demo data seeder
- **[migrateHelpers.ts](./src/db/migrateHelpers.ts)** - Workspace migration utilities
- **[schema.sql](./src/db/schema.sql)** - Main DB schema (columns, cards, card_events, workspaces, users)
- **[agent-schema.sql](./src/db/agent-schema.sql)** - Agent subsystem schema (agent_boards, agent_card_outputs)

### src/agent/

LLM pipeline for agentic kanban.

- **[routes.ts](./src/agent/routes.ts)** - Agent board REST endpoints (create board, send message, approve, get outputs)
- **[service.ts](./src/agent/service.ts)** - Pure business logic with dependency injection; fully unit-testable
- **[llm.ts](./src/agent/llm.ts)** - Thin Anthropic SDK wrappers; supports native API and compatible endpoints (MiMo)
- **[templates.ts](./src/agent/templates.ts)** - Agent template definitions with `{placeholder}` system prompts
- **[artifact.ts](./src/agent/artifact.ts)** - Artifact slug generation, filename derivation, byte limits

### src/agent/tools/

Tool registry for LLM function calling.

- **[registry.ts](./src/agent/tools/registry.ts)** - Tool registration and lookup
- **[types.ts](./src/agent/tools/types.ts)** - Tool interface definitions (ToolResult, ToolInputSchema, risk tiers)
- **[webSearch.ts](./src/agent/tools/webSearch.ts)** - Tavily web search tool with error classification
- **[createFile.ts](./src/agent/tools/createFile.ts)** - File creation tool for agent artifacts
- **[trace.ts](./src/agent/tools/trace.ts)** - Tool execution tracing

### src/middleware/

Express middleware.

- **[workspace.ts](./src/middleware/workspace.ts)** - Verifies workspace membership and attaches role to request

### src/routes/

Route modules extracted from routes.ts.

- **[activity.ts](./src/routes/activity.ts)** - GET workspace activity feed from card_events
- **[board.ts](./src/routes/board.ts)** - GET board with human columns and cards
- **[cards.ts](./src/routes/cards.ts)** - CRUD and move for cards; enforces WIP limits and optimistic locking
- **[columns.ts](./src/routes/columns.ts)** - CRUD for kanban columns with fractional positioning
- **[helpers.ts](./src/routes/helpers.ts)** - Shared DB helpers: membership checks, capacity, board service factory
- **[invites.ts](./src/routes/invites.ts)** - Accept and decline workspace invites
- **[members.ts](./src/routes/members.ts)** - Workspace member list, add, and remove
- **[metrics.ts](./src/routes/metrics.ts)** - GET flow metrics and 8-bucket weekly history
- **[presence.ts](./src/routes/presence.ts)** - SSE endpoint, heartbeat, and online user list
- **[settings.ts](./src/routes/settings.ts)** - Board settings API (board_name, logo_path) with file upload support
- **[workspaces.ts](./src/routes/workspaces.ts)** - CRUD for workspaces with membership cap enforcement
- **[EXTRACTION_PLAN.md](./src/routes/EXTRACTION_PLAN.md)** - Plan for splitting handlers out of routes.ts

## Test Files

- **[auth.test.ts](./src/auth.test.ts)** - Auth middleware tests
- **[realtime.test.ts](./src/realtime.test.ts)** - Realtime/SSE tests
- **[routes.integration.test.ts](./src/routes.integration.test.ts)** - Board API integration tests
- **[workspaces.test.ts](./src/workspaces.test.ts)** - Workspace logic tests
- **[cors.test.ts](./src/core/cors.test.ts)** - CORS origin validator tests
- **[position.test.ts](./src/core/position.test.ts)** - Unit tests for fractional positioning
- **[wip.test.ts](./src/core/wip.test.ts)** - Unit tests for WIP limit checks
- **[metrics.test.ts](./src/core/metrics.test.ts)** - Unit tests for flow metrics
- **[workspaceMigration.test.ts](./src/db/workspaceMigration.test.ts)** - Workspace migration helper tests
- **[routes.test.ts](./src/agent/routes.test.ts)** - Agent routes tests
- **[service.test.ts](./src/agent/service.test.ts)** - Agent service tests
- **[llm.test.ts](./src/agent/llm.test.ts)** - LLM layer tests
- **[templates.test.ts](./src/agent/templates.test.ts)** - Template rendering tests
- **[artifact.test.ts](./src/agent/artifact.test.ts)** - Artifact utility tests
- **[pipeline.integration.test.ts](./src/agent/pipeline.integration.test.ts)** - Integration tests (opt-in via `RUN_LLM_IT=1`)
- **[createFile.test.ts](./src/agent/tools/createFile.test.ts)** - createFile tool tests
- **[registry.test.ts](./src/agent/tools/registry.test.ts)** - Tool registry tests
- **[trace.test.ts](./src/agent/tools/trace.test.ts)** - Tool trace parsing tests
- **[webSearch.test.ts](./src/agent/tools/webSearch.test.ts)** - Web search tool tests
- **[settings.test.ts](./src/routes/settings.test.ts)** - Settings route tests
- **[workspaceAccess.test.ts](./src/routes/workspaceAccess.test.ts)** - Workspace access logic tests
