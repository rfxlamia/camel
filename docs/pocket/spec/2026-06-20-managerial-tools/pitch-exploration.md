# Pitch Exploration: managerial-tools

Date: 2026-06-20 | Project: camel-kanban | Status: pitch-only

---

## Problem Statement

Small dev teams using Camel cannot automate repetitive managerial workflows (status reports, standup summaries, retrospectives) because the agent lacks tools to query board data. Current agent only has `web_search` and `create_file` — no access to metrics, activity feed, or historical trends that drive managerial reporting.

## Root Tension

Need flexible data access for diverse managerial templates vs maintaining architectural consistency (dependency injection pattern already established in agent service).

## Key Constraints

- **Target user:** Small dev teams (not enterprise) — filter out budget tracking, resource allocation, multi-project management
- **Architecture:** Agent service uses dependency injection, tool registry, sequential pipeline columns
- **Available data:** `metrics.ts` (cycle time, throughput, flow efficiency), `card_events` (activity feed), weekly history buckets
- **Existing tools:** `web_search`, `create_file` — new `query_board_data` tool needed
- **Template priority:** Status report (highest frequency) → standup → retrospective → sprint planning
- **Pipeline shape:** Sequential columns with tool budget (validated by research report)

---

## Brainstorming Methods Used

### Question Storming — deep

Key insights:

- Foundation tool (`query_board_data`) is non-negotiable prerequisite for all managerial templates
- Data availability is the gating factor — Camel has infrastructure but no agent tool to query
- Small teams need configurable templates, not rigid formats
- Output format flexibility matters (markdown now, PDF/email/Slack later)

### First Principles Thinking — creative

Key insights:

- Managers need data for decision-making — data must be accurate, relevant, timely
- Repetitive work consumes high-value time — automation must save significant hours
- Every team is unique — templates must be flexible, not rigid
- Start with highest-frequency use case, then expand

### Six Thinking Hats — structured

Key insights:

- **White (Facts):** Camel has metrics.ts, card_events table, 1 existing template, tool registry architecture
- **Yellow (Benefits):** Saves 5-10 hrs/week, consistent formatting, data-driven insights
- **Black (Risks):** Data may be incomplete, templates may be too rigid, dependency on unbuilt tool
- **Green (Creativity):** Template chaining (standup → status → retro), notification integration

### Analogical Thinking — creative

Key insights:

- BI tools pattern: Data source → Transformation → Visualization → Distribution
- CI/CD pattern: Build → Test → Deploy → Monitor (pipeline with gates)
- Email marketing pattern: Trigger → Content Generation → Personalization → Delivery
- Common universal pattern: data layer → processing layer → presentation layer → distribution layer

---

## Advisor Synthesis

All methods converge on `query_board_data` as the prerequisite foundation tool. Small team filter is critical — enterprise patterns should be discarded in favor of high-frequency, low-ceremony workflows. Pipeline architecture (sequential columns) is validated by analogical thinking across multiple domains. Incremental delivery (status report first) aligns with "start with highest frequency" principle from First Principles thinking.

---

## Spike Results

**Unknown resolved:** Should `query_board_data` query DB directly or go through existing API endpoints?

**Finding:**

- Existing API endpoints ready: `GET /metrics`, `GET /metrics/history`, `GET /activity`, `GET /cards/:id/activity`
- All require `requireWorkspaceMember` middleware (authentication)
- Agent service uses dependency injection — no direct DB or HTTP calls in current architecture
- Tools registered via `ToolRegistry` with `execute(input) → ToolResult`

**Implication:** Three options identified:

- **Option A:** Direct DB query — fast but breaks dependency injection pattern
- **Option B:** HTTP call to existing API — reuses endpoints but adds HTTP overhead and auth complexity
- **Option C:** Internal service function — clean architecture, testable, no HTTP overhead (recommended)

---

## Approach Directions

### Direction A: Single Monolithic Tool

`query_board_data` returns all data at once: metrics, activity history, and weekly trends in a single response.
- **Simplicity** — one tool, one call, all data available
− **Over-fetching** — agent gets large data even when only metrics needed; token-inefficient

### Direction B: Modular Tools (3 separate)

`query_metrics`, `query_activity`, `query_history` — each returns specific data type.
- **Flexibility** — agent only fetches what's needed, token-efficient
− **Complexity** — 3 tools means 3 registrations, 3 descriptions, agent must know which to use when

### Direction C: Configurable Single Tool

`query_board_data` with `data_types: string[]` parameter — user/agent selects metrics, activity, history, or combination.
- **Balance** — one tool but flexible; default returns all, can filter as needed
− **Schema design** — needs clear parameter enum definition (`metrics`, `activity`, `history`)

---

## Open Questions for pocket-grinding

- [ ] Which approach direction (B or C) better serves small team use cases? Validate with GWT scenarios.
- [ ] What specific metrics are most useful for each template type (status report vs standup vs retro)?
- [ ] How should tool handle missing data (e.g., no completed cards yet, empty activity feed)?
- [ ] Should templates be configurable (different report formats) or one-size-fits-all initially?
- [ ] What's the right tool budget for managerial templates (current default is 3)?

---

## Recommended Direction

Direction C (Configurable Single Tool) — provides balance between simplicity (one tool) and flexibility (parameter-based filtering) that small teams need, while keeping token usage efficient. However, Direction B (Modular Tools) remains viable if grinding reveals that template-specific data needs are distinct enough to warrant separation.

---

## Handoff Context (for pocket-grinding)

When pocket-grinding reads this doc:

- Start with this problem statement (Phase 1 context)
- Use Direction C as working hypothesis, but validate Direction B as alternative in Phase 5 Design Proposals
- Treat Open Questions above as Phase 3 Discovery targets
- Do NOT treat Approach Directions as final architecture — validate through GWT first
- Priority: Status report template first (highest industry frequency, clearest data sources)
- Foundation: `query_board_data` tool must be built before any template implementation
