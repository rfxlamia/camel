# Agent Tool System — Foundation + Web Search (Tavily)

**Date:** 2026-06-15
**Status:** draft
**Author:** pocket-grinding session
**Spec path:** docs/pocket/spec/2026-06-15-agent-tool-system/web-search-tool-foundation.md
**Source pitch:** uploads/pitch-exploration.md (Direction C — Hybrid: Native Tool Use + Thin Abstraction Layer)

---

## Summary

Camel agents today can only "think" (generate text from model memory) — they cannot "act" on the real world. This spec adds the **first slice of an agent tool system**: a thin, provider-agnostic tool abstraction, a client-side tool-execution loop inside `executeCard`, and one read-only tool — `web_search` backed by Tavily — to validate the agentic-kanban concept end-to-end. Tool activity is shown to the user as a collapsible, auditable trace; only the agent's final turn becomes the card's official output.

---

## Context

### Current State
- Agent pipeline: `routes.ts → service.ts (createAgentBoardService, DI factory) → llm.ts (executeCard)`.
- `executeCard` calls `client.messages.stream()` with `model/max_tokens/system/messages` — **no `tools` parameter**; it is a single-shot stream with no tool/function calling.
- `runPipeline()` in `service.ts` iterates columns sequentially (`for` loop, `await` per card). Tokens are batched every 200ms via `setInterval` → `publishEvent` SSE (`agent.card.started|token|done|failed`). On any error **or empty output**, it sets `execution_status='failed'` and **halts the whole pipeline**.
- Output persists to `agent_card_outputs (board_id, column_slug, card_index, output, thinking)`; a preview card row is inserted into `cards`. Agent output never writes to `card_events` (human Activity Feed stays clean).
- `columns` table already carries per-column `slug`, `reasoning`, `system_prompt` (added via additive `ALTER`). No `tools` column yet.
- `llm.ts`: `NATIVE = false` when `ANTHROPIC_BASE_URL` is set (MiMo-compatible endpoint); Anthropic-only thinking/cache_control are gated off for MiMo. SDK `@anthropic-ai/sdk ^0.104.1`.
- Only one template exists (`research-report`); per project memory, templates are slated to become user-authored plugins → tool system must stay template-agnostic.

### Problem / Motivation
Without tools the agent is a chatbot pinned to a board: strong at reasoning, helpless at execution. Users cannot delegate real research because there is no mechanism for the agent to interact with the world beyond the board. The core tension is **capability vs. safety** — enough tooling to be useful, with governance and transparency so it stays trustworthy.

### Related Areas
`server/src/agent/llm.ts`, `service.ts`, `routes.ts`; `server/src/db/agent-schema.sql`; `server/src/realtime.ts` (SSE); client SSE handling + card UI (`client/src/types.ts`, `BoardContext.tsx`, `ContextPanel.tsx`/`CardView.tsx`). UI styling authority: `docs/pocket/rule/creative-brief.md` (must be consulted for the trace UI).

---

## Scope

### In-Scope
- **Tool abstraction layer** — a thin, provider-agnostic `Tool` interface (`name`, `description`, JSON `inputSchema`, `execute(input)`, `riskTier`) plus a registry, injected via DI (testable without API keys).
- **Client-side tool-execution loop** inside `executeCard`: handle Anthropic `tool_use` stop_reason → execute the tool in our code → feed `tool_result` back → continue until a final text turn (`end_turn`).
- **`web_search` tool** backed by Tavily (single global server env `TAVILY_API_KEY`); read-only.
- **Per-column tool assignment + search budget** stored as data (template-driven): each column has an allowed tool list and a configurable search budget (default 3).
- **Foundational governance model** — per-tool `riskTier` (`read-only` auto-approved / `write` confirm / `destructive` explicit). Only the auto-approve path is exercised by `web_search`; other tiers are designed into the data model only.
- **SSE tool events** — `agent.tool.started`, `agent.tool.result`, `agent.tool.failed`, carrying tool name, query, result count / error code, attempt.
- **Collapsible, persisted, replayable trace** — interim reasoning text + tool steps render in a collapsible panel (Camel-styled); persisted so reopening an old board re-renders the trace without re-running tools.
- **Failure handling** — auto-retry up to 3× per failed call; on exhaustion return a STRUCTURED error to the agent so it adapts (does not hard-halt the card).

### Out-of-Scope
- **Sandboxed code-execution tool** — high-leverage but its own large effort (sandbox + security + async); foundation must not preclude it.
- **Async / long-running tools** — pipeline stays synchronous for this slice.
- **Tool memory / result caching across runs** — tools are stateless; a repeated identical query hits Tavily again and consumes budget.
- **Tool marketplace / user-authored tool definitions** — deferred; the DI abstraction merely prepares for it.
- **"Board as tool"** (agent invoking board CRUD primitives).
- **Write/destructive confirmation UI** — model designed in data only; no approval dialog implemented (`web_search` is safe/read-only).

---

## Architecture Constraints

- **May touch:** `server/src/agent/{llm.ts, service.ts, routes.ts}`, `server/src/db/agent-schema.sql`, `server/src/realtime.ts` SSE events, client SSE handling + card trace UI.
- **Must NOT touch:** `server/src/core/` pure modules (`position`, `wip`, `metrics`), human board CRUD routes, `card_events` / Activity Feed.
- **Patterns to follow:** dependency injection (tools injected, unit-testable via mocked `execute`); agent output to `agent_card_outputs` (never `card_events`); **template-agnostic** (no hardcoded assumption of `research-report`); thin abstraction over Anthropic native `tool_use`; works on both real Anthropic and MiMo-compatible endpoints (graceful degradation if an endpoint lacks `tool_use`).
- **Schema changes additive only** (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).
- **Architecture validation result:** PASS (Phase 6).

---

## Stories + Scenarios

### Story: Agent uses web_search and the user can audit it
> As an agent in a card, I want to call `web_search` when I need real facts, so my output is grounded in current data — not just model memory. As a research-team user, I want to see and audit what the agent searched, transparently.

**Rule R1: Tools are gated per column by the template (data-driven).**
- Example A: column `research-specialist` has tools `[web_search]` → may search.
- Example B: column `editor` has tools `[]` → cannot search; behaves exactly as today.

**Rule R2: Search budget — default 3 per card, configurable per column; ≤10 results per search.**
- Example A: column budget 3 → 3 searches allowed; 4th rejected.
- Example B: template overrides `research-specialist` budget to 5 → 5 allowed.
- Example C: a search that fails then succeeds on retry counts as 1 (budget counts model-issued requests, not retries).

**Rule R3: Tool failure → auto-retry ≤3×; on exhaustion send STRUCTURED error to agent; agent adapts, does not hard-halt.**
- Example A: network error on attempt 1 → retry → attempt 2 OK.
- Example B: `TAVILY_API_KEY` unset → `ENV_VAR_MISSING` after retries → agent writes final caveating the gap.
- Example C: Tavily rate limit → `RATE_LIMIT` → agent adapts.

**Rule R4: Interim reasoning + tool steps → collapsible trace; only the FINAL assistant turn = official card output.**

**Rule R5: Trace is persisted and replayable on board reopen (no re-run).**

**Rule R6: Read-only tools run without confirmation; output goes to `agent_card_outputs`, not `card_events`.**

**Rule R7: Empty Tavily results (`[]`) are returned to the agent as an explicit "no results found" message (no hallucinated data).**

**Rule R8: Each tool result is size-capped before being fed back, to protect the context budget.**

```gherkin
Scenario: Happy path — search then write
  Given column "research-specialist" has tools [web_search] and its card starts
  When  the model returns a tool_use web_search with query "harga kompetitor X"
  Then  our code calls Tavily (depth 10) and returns ≤10 results as tool_result
  And   SSE agent.tool.started then agent.tool.result are published (query + result count)
  And   the model continues, may search again, then writes a final turn
  And   only the final turn text is saved to agent_card_outputs

Scenario: Search budget reached
  Given the card has already issued its allowed number of web_search requests (default 3)
  When  the model requests one more web_search
  Then  the extra request is rejected and the model is told the limit is reached
  And   the model is forced to write its final answer with existing data

Scenario: Tool fails then recovers (retry)
  Given Tavily returns a network error on the first attempt
  When  web_search is invoked
  Then  the system auto-retries (≤3×) and the second attempt succeeds
  And   this search counts as 1 of the budget
  And   agent.tool.result is published after success

Scenario: Tool fails totally — agent adapts
  Given TAVILY_API_KEY is unset (ENV_VAR_MISSING) OR Tavily is rate-limited (RATE_LIMIT)
  When  web_search is invoked and all 3 retries fail
  Then  the tool_result contains a STRUCTURED error code (ENV_VAR_MISSING|RATE_LIMIT|API_ERROR)
  And   SSE agent.tool.failed is published (visible in the trace)
  And   the model does NOT halt — it writes a final answer explaining the limitation
  And   the card finishes with a normal status (not "failed")

Scenario: Column with no tools is unchanged
  Given column "editor" has tools []
  When  its card runs
  Then  executeCard runs exactly as today (no tools param) with no behavior change

Scenario: Empty search results
  Given Tavily returns an empty result array for a query
  When  the tool_result is built
  Then  it states "no results found for <query>" explicitly
  And   the model does not fabricate sources

Scenario: Old board history replay
  Given a completed board with a stored tool trace
  When  the user reopens the board
  Then  the trace (queries + results) re-renders in the collapsible panel
  And   no searches are re-executed
```

---

## Acceptance Criteria

```
ACCEPTANCE CRITERIA — Agent Tool System (Foundation + web_search)
Date: 2026-06-15 | Scope confirmed: yes

Rule R1: Per-column tool gating (data-driven)
  ✓ Given column has tools [web_search], When card runs, Then model may issue web_search
  ✓ Given column has tools [], When card runs, Then executeCard runs as today, no tools offered

Rule R2: Search budget (default 3/card, per-column configurable; ≤10 results)
  ✓ Given budget 3, When model issues a 4th web_search, Then it is rejected and model writes final
  ✓ Given template overrides a column budget, Then that column's budget is used
  ✓ Given a search fails-then-succeeds, Then it counts as exactly 1 toward budget

Rule R3: Failure → retry → structured error → adapt
  ✓ Given a transient error, When web_search runs, Then it auto-retries ≤3× and succeeds if possible
  ✗ Given all retries fail, When web_search runs, Then tool_result carries a STRUCTURED error code
        (ENV_VAR_MISSING|RATE_LIMIT|API_ERROR) and SSE agent.tool.failed fires
  ✓ Given total tool failure, When agent continues, Then it writes a final answer and card status is NOT "failed"

Rule R4: Trace vs official output
  ✓ Given interim reasoning + tool steps, Then they go to the collapsible trace
  ✓ Given the run completes, Then only the final assistant turn is saved as the column output

Rule R5: Persistence + replay
  ✓ Given a completed board with a trace, When reopened, Then the trace re-renders without re-running tools

Rule R6: Governance + persistence boundary
  ✓ Given a read-only tool, When invoked, Then it runs without a confirmation gate
  ✓ Given any agent output, Then it writes to agent_card_outputs, never card_events

Rule R7/R8: Result hygiene
  ✓ Given empty Tavily results, Then tool_result says "no results found" explicitly
  ✓ Given large results, Then each result is size-capped before being fed back

OUT-OF-SCOPE (remind pocket-planning):
  - sandboxed code execution; async/long-running tools; tool caching;
    tool marketplace / user-authored tools; "board as tool";
    write/destructive confirmation UI (model designed in data only)
```

---

## Design Decision

**Chosen option:** Option C — Hybrid: dedicated `tools/` module + client-side loop in `executeCard`, tools injected from `service.ts`.

**Summary:** New `server/src/agent/tools/` holds the `Tool` interface, registry, and `webSearch` (Tavily). `executeCard` owns the multi-turn `tool_use` loop but receives tools (and per-column budget) via DI, so the loop and tools are unit-testable with a mocked `execute`. Tool events surface via an `onToolEvent` callback mirroring the existing `onToken`. The loop uses the standard Messages API `tool_use` format, so it runs on MiMo-compatible endpoints too; if tools are absent/unsupported, `executeCard` degrades to today's single-shot behavior.

**Rejected options:**
- **Option A (loop in llm.ts, tools not isolated):** rejected — couples tool logic to the LLM layer and weakens DI/testability vs. C's dedicated module.
- **Option B (loop in service.ts, llm.ts single-shot):** rejected — moves message-history threading and streaming coordination out of the LLM layer; Scenarios 3 & 4 (our-code retry + structured error) still demand client-side execution, which C provides more naturally without splitting the stream.

**Key tradeoffs accepted:**
- `executeCard` grows in complexity (mitigated: extract the loop into a small helper).
- Minor coupling to Anthropic `tool_use` shape (mitigated: isolated behind the `Tool` interface + loop; standard format keeps MiMo working).

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Exact structured-error enum | assumed: `ENV_VAR_MISSING \| RATE_LIMIT \| API_ERROR \| NETWORK_ERROR \| UNKNOWN` (finalize in planning) | Agent gets a less specific error; cosmetic, low risk |
| Persist trace in new table vs. extend `agent_card_outputs` | assumed: new additive table `agent_tool_calls (board_id, column_slug, tool_name, input, result, error_code, attempt, created_at)` — keeps `output` clean and supports replay | Wrong shape → trace replay/queries awkward; medium, decided in planning |
| How tool steps interleave with 200ms token batching | assumed: tool runs between assistant turns; flush token buffer, emit tool events, then resume streaming next turn | Bad interleaving → jumbled stream UX; medium |
| MiMo endpoint supports `tool_use` | assumed: standard Messages API `tool_use` works; if not, degrade to no-tools | If unsupported and not degraded → errors on MiMo; mitigated by Scenario 5 degrade path |
| Tavily key scoping | assumed: single global server `TAVILY_API_KEY` (same pattern as `ANTHROPIC_API_KEY`), no per-user isolation | Shared results across workspace users; acceptable for read-only search MVP |
| Concurrent board executions / cancel mid-tool | NON-BLOCKING for this slice; existing fire-and-forget runPipeline unchanged | Duplicate runs possible (pre-existing); out of scope here |

---

## Implementation Notes

- Add `TAVILY_API_KEY=` to `server/.env.example` under a new "Agent / Tools" section; document that absence yields `ENV_VAR_MISSING` (graceful, not a crash).
- Thread tools + budget through the existing DI seams: `executeCard` gains a `tools` (and `onToolEvent`) parameter; `service.ts` resolves the per-column tool list + budget from the columns config and passes them in. Keep the existing `_reasoning` param precedent for additive signature changes.
- Extend `columns` schema additively with `tools` (e.g., `TEXT[]` or JSON) and `tool_budget` (`INTEGER`, nullable → default 3).
- Add SSE event types to `client/src/types.ts`: `agent.tool.started | agent.tool.result | agent.tool.failed` with `{ toolName, query?, resultCount?, errorCode?, attempt? }`.
- Cap each Tavily result (e.g., title + URL + snippet, snippet truncated) before feeding back; document the effective context budget on the tool definition.
- Trace UI must follow `docs/pocket/rule/creative-brief.md` (Camel styling), collapsed by default, expandable — modeled on claude.ai's tool-call trace but Camel-branded.
- Preserve the existing halt-on-empty-final-output behavior; tool failure is a different path and must NOT trigger it.

---

## Rollback Plan

- Feature is fully additive and gated by data: with no `tools` assigned to any column and no `TAVILY_API_KEY`, every card runs exactly as today (Scenario 5).
- To disable: clear `tools` from template columns (or unset `TAVILY_API_KEY`) — no schema rollback needed since columns are additive and nullable.
- If the tool loop misbehaves: short-circuit `executeCard` to ignore the `tools` param (single-shot path) — one-line guard, no data migration.
