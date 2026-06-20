# query_board_data Tool + status-report Template

**Date:** 2026-06-20
**Status:** approved
**Author:** pocket-grinding session
**Spec path:** docs/pocket/spec/2026-06-20-managerial-tools/query-board-data-and-status-report.md

---

## Summary

Small dev teams using Camel cannot automate managerial reporting because the agent has no way to read board data — its only tools are `web_search` and `create_file`. This spec adds a read-only `query_board_data` tool that exposes workspace flow data (metrics, activity, weekly history) to the agent, and a first consumer: a two-column `status-report` template that answers "are we on track?" and saves a markdown artifact. `query_board_data` is the non-negotiable foundation for all future managerial templates (standup, retro), which are deferred.

---

## Context

### Current State
- Agent tools implement a single `Tool` contract: `{ name, description, inputSchema, riskTier, execute(input) → ToolResult }` where `ToolResult = { ok: boolean; content: string; errorCode?: string }`.
- Two wiring patterns exist: **context-free** tools are registered statically (`defaultToolRegistry = createToolRegistry([webSearch])` in `agent/routes.ts`); **context-bound** tools are built per-board at runtime inside `runPipeline` (`makeCreateFile({ boardId, workspaceId, documentContent, insertArtifact })`), with DB access injected through service `deps`.
- `core/metrics.ts` already provides pure functions — `computeFlowMetrics`, `computeMetricsHistory`, `formatDuration` — that the HTTP routes (`routes/metrics.ts`, `routes/activity.ts`) merely wrap (workspace-scoped SQL → compute → JSON).
- Templates are pure data (`TemplateColumn[]`). Only `research-report` exists (5 sequential columns). Default `tool_budget` is 3.
- `classifyIntent` maps an intent to a `templateId`. A pre-approval clarification flow exists for `pending` boards.

### Problem / Motivation
The agent cannot ground managerial reports in real data, so it would have to invent figures. The infrastructure (metrics, `card_events`, weekly history) exists but is reachable only over authenticated HTTP routes, which the DI-based agent service does not call.

### Related Areas
- `server/src/agent/tools/` (new `queryBoardData.ts`; mirror `createFile.ts`)
- `server/src/agent/service.ts` (`runPipeline` tool-build block; `AgentBoardServiceDeps`; `createBoard`)
- `server/src/agent/routes.ts` (`realDeps` — inject the data-fetch dep)
- `server/src/agent/templates.ts` (new `status-report` template + registry entry)
- `server/src/agent/llm.ts` (`classifyIntent` examples; missing-period clarification)
- `server/src/core/metrics.ts` (reused, **not modified**)

---

## Scope

### In-Scope
- `query_board_data`: read-only, workspace-scoped tool returning flow data to the agent.
- Configurable data selection via `data_types: ("metrics"|"activity"|"history")[]`, plus optional `windowDays` and `weeks`.
- Reuse of `core/metrics.ts` pure functions; **no new metric math**.
- DI wiring through the `create_file` (context-bound) pattern; `workspaceId` server-bound.
- One `status-report` template (2 sequential columns) as the first consumer.
- Empty / missing-data handling (no completed cards, empty activity feed).
- Missing-period clarification at board creation (blocks before approval).
- `classifyIntent` recognizes status-report intents.

### Out-of-Scope
- `standup` / `retrospective` / `sprint-planning` templates — later increments.
- Enterprise concerns (budget tracking, resource allocation, multi-project) — wrong target user.
- New output formats (PDF / email / Slack) — markdown artifact only, via existing `create_file`.
- New DB schema, migrations, or metric definitions.
- Direct DB query or HTTP call from inside the tool — spike rejected both.
- Any change to `core/metrics.ts` math, the `card_events` / `agent_card_outputs` separation, the HTTP route handlers, or the `Tool` / `ToolResult` contract shape.

---

## Architecture Constraints

- **Layers this work may touch:** `agent/tools/*`, `agent/service.ts` (deps + `runPipeline` tool-build + `createBoard`), `agent/routes.ts` (deps wiring), `agent/templates.ts`, `agent/llm.ts` (classifier examples + clarification).
- **Layers this work must NOT touch:** `core/metrics.ts` math, `card_events` / `agent_card_outputs` separation, HTTP route handlers, the `Tool` / `ToolResult` contract.
- **Patterns that must be followed:** `ToolResult` contract; runtime DI for context-bound tools; `riskTier: "read-only"`; sequential pipeline columns; pure compute functions injected, not re-implemented.
- **Architecture validation result:** PASS.

---

## Stories + Scenarios

### Story 1: query_board_data tool
> As the status-report agent, I want to read my workspace's flow data, so that I can ground the report in real metrics instead of guessing.

**Rule 1.1 — Server-bound, read-only scoping**
- Example A: LLM attempts to pass `workspaceId=99` → schema has no such field; query runs against the board's own workspace only.

```gherkin
Scenario: Fetch metrics + history for an active workspace
  Given a board executing in workspace 7 with completed cards
  When  the agent calls query_board_data with data_types=["metrics","history"]
  Then  ok=true and content includes throughput, avgLeadTimeMs, avgCycleTimeMs,
        wipCount, and 8 weekly history buckets for workspace 7

Scenario: Workspace is server-bound
  Given the tool is built for the board in workspace 7
  When  the agent's tool call includes any workspace/board identifier argument
  Then  that argument is ignored and only workspace 7 data is returned
```

**Rule 1.2 — Configurable data selection, reusing core/metrics.ts**
- Example B: `data_types=["metrics","history"]` on an active workspace → throughput, avg lead/cycle (ms), wipCount + 8 weekly buckets. Omitting `data_types` returns all three.

**Rule 1.3 — Empty data never errors**
- Example C: brand-new workspace, no done cards → `completedCount:0`, `hasData:false`, `avgLeadTimeMs:null`, `throughput:0`, `activity:[]`.

```gherkin
Scenario: Empty workspace returns honest no-data signal
  Given workspace 12 has zero completed cards and an empty activity feed
  When  the agent calls query_board_data with data_types=["metrics","activity"]
  Then  ok=true, completedCount=0, hasData=false, metric averages are null,
        and activity is an empty list (no error)
```

**Rule 1.4 — Out-of-range window params are clamped**
- Example D: `weeks=500` → clamped to 26 (matches the route's 1–26 bound).

```gherkin
Scenario: Out-of-range window is clamped
  Given the agent requests weeks=500
  When  query_board_data executes
  Then  it clamps to weeks=26 and returns ok=true
```

**Rule 1.5 — Infra failure surfaces as a tool error**
- Example E: the injected data-fetch function throws → `ok:false`, `errorCode:"DB_ERROR"`.

```gherkin
Scenario: Database failure surfaces as a tool error
  Given the underlying data fetch throws
  When  query_board_data executes
  Then  ok=false and errorCode="DB_ERROR"
```

### Story 2: status-report template
> As a small-team lead, I want an automated status report, so that I know whether we're on track without compiling metrics by hand.

**Rule 2.1 — Two-column shape compatible with the existing artifact path**
- Analyst column: `tools:["query_board_data"]`, `reasoning:true`, `output_key:"editor_output"`, writes the report body in the `## Revised Document` shape.
- QA/Persist column: `tools:["create_file"]`, emits `PASS | NEEDS REVISION` (qa-guardian style).
- Confirmed against `runPipeline`: after the loop it finds the `create_file` column, requires `parseQaVerdict === "pass"`, then extracts the `## Revised Document` from the `output_key:"editor_output"` column. During the QA column's run, `create_file` is built with `documentContent` from `accumulator["editor_output"]`, which the Analyst populated. No engine change required.

**Rule 2.2 — Answers "are we on track?"**
- Example A: throughput up 5→8/wk, cycle time 3.1d→2.4d → verdict "on track, improving".

```gherkin
Scenario: On-track report from real metrics
  Given workspace 7 with rising throughput and falling cycle time over 8 weeks
  And   an approved status-report board whose intent specifies "last 2 weeks"
  When  the pipeline runs
  Then  the Analyst calls query_board_data, writes a Revised Document with the
        real figures and an "on track" verdict, QA returns PASS, and a markdown
        artifact is saved
```

**Rule 2.3 — Missing period blocks at creation**
- Example B: intent "give me a status report" (no period) → clarification asks for the period; board stays pending.

```gherkin
Scenario: Missing period blocks at creation
  Given a status-report intent with no resolvable time period
  When  the board is created
  Then  createBoard returns a clarification question asking for the period,
        the board stays pending, and no pipeline runs until the user supplies
        a period and approves
```

**Rule 2.4 — Honest no-data report still passes**
- Example C: new workspace, no done cards → report states "insufficient completed work to assess flow", reports WIP if any; QA verdict PASS.

```gherkin
Scenario: Honest report when there is no data
  Given a newly created workspace with no completed cards
  When  the status-report pipeline runs
  Then  the report states completed work is insufficient to assess flow,
        reports WIP if any, invents no metrics, and QA returns PASS
```

**Rule 2.5 — No fabricated metrics**
- Example D: tool returns `avgCycleTimeMs=null` → report says "cycle time not yet measurable", not a number.

```gherkin
Scenario: Agent must not fabricate unmeasurable metrics
  Given query_board_data returns avgCycleTimeMs=null
  When  the Analyst writes the report
  Then  it states cycle time is not yet measurable rather than a number
```

---

## Acceptance Criteria

```
ACCEPTANCE CRITERIA — query_board_data tool + status-report template
Date: 2026-06-20 | Scope confirmed: yes

Rule: Server-bound read-only scoping
  ✓ Given a board in workspace 7, When query_board_data runs, Then only
    workspace 7 data is returned
  ✗ Given the LLM passes a workspaceId/board id argument, When the tool runs,
    Then the argument is ignored (schema exposes no such field)

Rule: Configurable data selection
  ✓ Given data_types=["metrics","history"], When the tool runs, Then content
    includes flow metrics + 8 weekly buckets via core/metrics.ts pure fns
  ✓ Given data_types omitted, When the tool runs, Then all three data types
    are returned

Rule: Empty data never errors
  ✓ Given a workspace with no completed cards, When the tool runs, Then
    ok=true, completedCount=0, hasData=false, averages null, activity []

Rule: Window param clamping
  ✓ Given weeks=500, When the tool runs, Then it clamps to 26 and ok=true

Rule: Infra failure
  ✗ Given the injected fetch throws, When the tool runs, Then ok=false and
    errorCode="DB_ERROR"

Rule: status-report shape + artifact
  ✓ Given an approved status-report board with a period, When the 2-column
    pipeline runs, Then a markdown artifact is saved via the existing
    editor_output + QA-PASS + create_file path

Rule: Missing-period clarification
  ✓ Given an intent with no resolvable period, When the board is created,
    Then createBoard returns a clarification question and the board stays
    pending (no pipeline run) until a period is supplied

Rule: Honesty
  ✓ Given no completed cards, When the report is written, Then it states
    insufficient data and QA returns PASS
  ✗ Given avgCycleTimeMs=null, When the report is written, Then it must NOT
    state a cycle-time number

OUT-OF-SCOPE (remind pocket-planning):
  - standup / retrospective / sprint-planning templates
  - enterprise features (budget, resource, multi-project)
  - PDF / email / Slack output formats
  - new DB schema, migrations, or metric definitions
  - direct DB / HTTP calls inside the tool
```

---

## Design Decision

**Chosen option:** Option A — Configurable single tool (pitch Direction C).

**Summary:** One `query_board_data` tool with `data_types: ("metrics"|"activity"|"history")[]` plus optional `windowDays`/`weeks`, context-bound via `makeQueryBoardData({ workspaceId, fetchCardTimestamps, fetchActivityEvents })` built in `runPipeline` like `create_file`. `content` is `JSON.stringify` of a structured object so the agent can reliably distinguish `null` (unmeasurable) from `0`. The tool calls `computeFlowMetrics` / `computeMetricsHistory`; no SQL/HTTP inside it.

**Rejected options:**
- Option B (three modular tools): rejected because the core "on track?" report needs metrics + history, which would cost two tool turns against the default budget of 3, plus triple the registration/description/test surface and add agent routing decisions.

**Key tradeoffs accepted:**
- Possible over-fetch when the agent omits `data_types` — a cost concern, not correctness; bounded by small payloads + prompt guidance.
- `data_types` enum must be clearly described in the inputSchema so the agent selects correctly.

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| `content` encoding: JSON vs prose | assumed: JSON.stringify of a structured object | Agent misreads null vs 0 → wrong "no data" handling |
| Out-of-range window handling | assumed: clamp to bounds (weeks 1–26) rather than error | Wasted budget turn if the tool errored instead |
| Tool budget per column | assumed: default 3 is adequate (Analyst ~1–2 calls) | Budget exhaustion mid-report if a column needs more |
| classifyIntent recognizing status-report | in-scope task: add classifier examples | Intent misrouted to research-report or rejected |

---

## Implementation Notes

- `makeQueryBoardData` must be injected only when a column's `tools` includes `"query_board_data"`, mirroring the `create_file` block in `runPipeline`. Wire a `fetchCardTimestamps(workspaceId)` (and `fetchActivityEvents(workspaceId, limit)`) dep into `realDeps` in `routes.ts`, backed by the same workspace-scoped SQL the metrics/activity routes use.
- The tool reads `cards` (for metrics/history) and `card_events` (for activity). It must **not** read `agent_card_outputs`.
- The Analyst system prompt must output the `## Revised Document` section (and the QA column the PASS/NEEDS-REVISION verdict) so the unchanged `extractRevisedDocument` / `parseQaVerdict` artifact path persists the report.
- Missing-period clarification belongs at `createBoard` / `classifyIntent` time (board stays `pending`), because pipeline columns are non-interactive.

---

## Rollback Plan

- Remove the `makeQueryBoardData` injection block from `runPipeline` and the `status-report` entry from the template registry — the tool is read-only and adds no persistent state.
- Revert the `classifyIntent` examples and the `createBoard` missing-period branch.
- No DB migration to undo; no data cleanup required.
