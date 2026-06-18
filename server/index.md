# Server Directory Index

Express 5 + TypeScript backend for Camel Kanban. PostgreSQL 16 + Redis 7.

## Files

- **[index.ts](./src/index.ts)** - Express app setup: CORS, cookie-parser, mounts auth, api, and agent routers
- **[auth.ts](./src/auth.ts)** - bcrypt auth, `requireAuth` middleware, session cookie (30-day)
- **[routes.ts](./src/routes.ts)** - Board API routes (cards, columns, metrics, presence) under `requireAuth`
- **[realtime.ts](./src/realtime.ts)** - Redis Pub/Sub fan-out to SSE; degrades to in-process if Redis down
- **[package.json](./package.json)** - Dependencies: express, pg, redis, anthropic-ai/sdk, bcryptjs, tavily
- **[tsconfig.json](./tsconfig.json)** - TypeScript config (NodeNext module system, ESM)
- **[.env.example](./.env.example)** - Environment variable template

## Subdirectories

### src/core/

Pure functions — the only server logic with unit tests.

- **[position.ts](./src/core/position.ts)** - Fractional positioning: float midpoints for card/column ordering
- **[wip.ts](./src/core/wip.ts)** - WIP limit enforcement; returns HTTP 409 on violation
- **[metrics.ts](./src/core/metrics.ts)** - Flow metrics computation (cycle time, throughput, flow efficiency)

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

### src/routes/

Additional route modules.

- **[settings.ts](./src/routes/settings.ts)** - Board settings API (board_name, logo_path) with file upload support

## Test Files

- **[position.test.ts](./src/core/position.test.ts)** - Unit tests for fractional positioning
- **[wip.test.ts](./src/core/wip.test.ts)** - Unit tests for WIP limit checks
- **[metrics.test.ts](./src/core/metrics.test.ts)** - Unit tests for flow metrics
- **[auth.test.ts](./src/auth.test.ts)** - Auth middleware tests
- **[realtime.test.ts](./src/realtime.test.ts)** - Realtime/SSE tests
- **[routes.test.ts](./src/agent/routes.test.ts)** - Agent routes tests
- **[service.test.ts](./src/agent/service.test.ts)** - Agent service tests
- **[llm.test.ts](./src/agent/llm.test.ts)** - LLM layer tests
- **[templates.test.ts](./src/agent/templates.test.ts)** - Template rendering tests
- **[pipeline.integration.test.ts](./src/agent/pipeline.integration.test.ts)** - Integration tests (opt-in via `RUN_LLM_IT=1`)
