# EXECUTION PLAN — Agent Tool System (Foundation + Web Search)

**Date:** 2026-06-15
**Spec:** docs/pocket/spec/2026-06-15-agent-tool-system/web-search-tool-foundation.md
**Status:** draft
**Total tasks:** 7

---

## Execution Overview

### Recommended Order
```
T1, T2 (parallel) → T3, T4 (parallel, after T1) → T5 (after T2,T4) → T6 → T7
```

> Dependency order above is **recommended** — the pocket skill enforces actual parallelism and sequencing.

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T1, T2 | start (both prereq) |
| Group B | T3, T4 | T1 completes |

### Constraints Reminder
**Architecture:** May touch `server/src/agent/{llm,service,routes}.ts`, `server/src/db/agent-schema.sql`, `server/src/realtime.ts`, `client/src/types.ts` + client card UI. Must NOT touch `server/src/core/` pure modules, human board CRUD, or `card_events`/Activity Feed. Patterns: DI (tools injected, mock `execute` in tests); agent output → `agent_card_outputs` never `card_events`; template-agnostic (no hardcoded `research-report` in tool logic); thin abstraction over Anthropic native `tool_use`; must run on real Anthropic AND MiMo (degrade to no-tools if endpoint lacks `tool_use`).
**Out-of-scope (no task may implement):** sandboxed code execution; async/long-running tools; tool caching; tool marketplace / user-authored tools; "board as tool"; write/destructive confirmation UI.
**Assumptions at risk:** structured-error enum finalization; new `agent_tool_calls` table shape; tool-step interleaving with the 200ms token batch; MiMo `tool_use` support (degrade path covers it); single global `TAVILY_API_KEY`.
**Sequencing:** `[depends: TN]` is recommended; pocket enforces actual blocking.

### File Structure Map
```
Rule R1 (per-column tool gating):
  Create: server/src/agent/tools/types.ts          (created by: T1)
  Create: server/src/agent/tools/registry.ts       (created by: T1)
  Modify: server/src/agent/templates.ts            (T2)
  Modify: server/src/db/agent-schema.sql           (T2)
  Test:   server/src/agent/tools/registry.test.ts  (T1)
  Test:   server/src/agent/templates.test.ts       (T2)

Rule R2 (search budget) + R3 (retry/structured error) + R7/R8 (result hygiene):
  Create: server/src/agent/tools/webSearch.ts       (created by: T3)
  Test:   server/src/agent/tools/webSearch.test.ts  (T3)
  Modify: server/src/agent/llm.ts                    (T4 — budget enforcement in loop)
  Test:   server/src/agent/llm.test.ts               (T4)

Rule R4 (trace vs official output) + tool loop:
  Modify: server/src/agent/llm.ts                    (T4)
  Test:   server/src/agent/llm.test.ts               (T4)

Rule R5 (persistence + replay) + R6 (governance/persistence boundary):
  Modify: server/src/agent/service.ts                (T5)
  Modify: server/src/realtime.ts                     (T5 — BoardEvent union + tool events)
  Modify: server/src/db/agent-schema.sql             (T2 — agent_tool_calls table)
  Modify: server/src/agent/routes.ts                 (T6 — getColumns tools/budget, getBoardById trace replay, insertToolCall dep)
  Test:   server/src/agent/service.test.ts           (T5)

Client trace UI (R4 surfacing + R5 replay):
  Modify: client/src/types.ts                        (T7 — AgentEvent union + tool fields)
  Modify: client/src/context/BoardContext.tsx        (T7 — collect tool events)
  Create: client/src/components/ToolTrace.tsx        (created by: T7)
  Modify: client/src/components/ContextPanel.tsx     (T7 — render trace)
  Test:   client/src/components/ToolTrace.test.tsx   (T7)
```

---

## Pocket Packets

---

### Task 1: Tool interface + registry foundation [prereq]

## OBJECTIVE
Define the provider-agnostic `Tool` contract and a registry that resolves tool names to definitions and builds Anthropic `tools` params. Pure module, no DB/network.

Files:
- Create: `server/src/agent/tools/types.ts`
- Create: `server/src/agent/tools/registry.ts`
- Test: `server/src/agent/tools/registry.test.ts`

Steps:
1. Write failing test for: registry resolves a known tool name and builds an Anthropic tool definition; unknown names are ignored.
   File: `server/src/agent/tools/registry.test.ts`
   Test verifies: Given a registry with a mock tool `web_search`, When `resolveTools(["web_search","nope"])` is called, Then it returns `[mockTool]` (unknown dropped); When `toAnthropicToolDefs([mockTool])`, Then it returns `[{name, description, input_schema}]`.
   ```ts
   // server/src/agent/tools/registry.test.ts
   import { describe, it, expect, vi } from "vitest";
   import { createToolRegistry, toAnthropicToolDefs } from "./registry.js";
   import type { Tool } from "./types.js";

   const mockTool: Tool = {
     name: "web_search",
     description: "Search the web",
     inputSchema: {
       type: "object",
       properties: { query: { type: "string" } },
       required: ["query"],
     },
     riskTier: "read-only",
     execute: vi.fn(async () => ({ ok: true, content: "result" })),
   };

   describe("createToolRegistry.resolveTools", () => {
     it("resolves a known tool name to its definition", () => {
       const registry = createToolRegistry([mockTool]);
       expect(registry.resolveTools(["web_search"])).toEqual([mockTool]);
     });

     it("drops unknown tool names without throwing", () => {
       const registry = createToolRegistry([mockTool]);
       expect(registry.resolveTools(["web_search", "nope"])).toEqual([mockTool]);
     });

     it("returns [] for an empty name list", () => {
       const registry = createToolRegistry([mockTool]);
       expect(registry.resolveTools([])).toEqual([]);
     });
   });

   describe("toAnthropicToolDefs", () => {
     it("maps each Tool to {name, description, input_schema}", () => {
       expect(toAnthropicToolDefs([mockTool])).toEqual([
         {
           name: "web_search",
           description: "Search the web",
           input_schema: mockTool.inputSchema,
         },
       ]);
     });

     it("does not leak execute/riskTier into the Anthropic def", () => {
       const [def] = toAnthropicToolDefs([mockTool]);
       expect(def).not.toHaveProperty("execute");
       expect(def).not.toHaveProperty("riskTier");
       expect(def).not.toHaveProperty("inputSchema");
     });
   });
   ```
2. Run test — verify FAIL: `npx vitest run src/agent/tools/registry.test.ts` (from `server/`). Expected: module not found / export missing.
3. Implement minimal code:
   File: `server/src/agent/tools/types.ts` — export `type ToolRiskTier = "read-only" | "write" | "destructive";` and `interface Tool { name: string; description: string; inputSchema: Record<string, unknown>; riskTier: ToolRiskTier; execute(input: Record<string, unknown>): Promise<ToolResult>; }` and `interface ToolResult { ok: boolean; content: string; errorCode?: string; }` and a `ToolEvent` type `{ phase: "started"|"result"|"failed"|"reasoning"; toolName?: string; query?: string; resultCount?: number; errorCode?: string; attempt?: number; text?: string; }` (the `"reasoning"` phase carries interim assistant text in `text`; `toolName` optional for reasoning events).
   File: `server/src/agent/tools/registry.ts` — `createToolRegistry(tools: Tool[])` returning `{ resolveTools(names: string[]): Tool[]; }`, plus pure helper `toAnthropicToolDefs(tools: Tool[]): Array<{name; description; input_schema}>` mapping `inputSchema` → `input_schema`.
4. Run test — verify PASS: `npx vitest run src/agent/tools/registry.test.ts`.
5. Commit: `git add server/src/agent/tools/types.ts server/src/agent/tools/registry.ts server/src/agent/tools/registry.test.ts` then `git commit -m "feat(agent-tools): add Tool interface and registry foundation"`.

## REFERENCES LOADED
docs/pocket/spec/2026-06-15-agent-tool-system/web-search-tool-foundation.md — rule R1, design Option C
server/src/agent/service.ts — existing DI factory pattern (deps object) to mirror for tool injection
server/src/agent/templates.ts — TemplateColumn shape that will carry tool names

## WHY THIS APPROACH
Complexity: lightweight
Justification: 2 small pure files defining a contract; no branching beyond name filtering. Shared-interface prereq — anchors T3 and T4 so they don't diverge.

## SANDWICH CONTEXT
[CRITICAL: Tool is provider-agnostic — types.ts must NOT import the Anthropic SDK or @tavily/core. Coupling lives only in the loop (T4) and webSearch (T3).]
You are implementing the tool interface + registry for the Agent Tool System.
Spec: docs/pocket/spec/2026-06-15-agent-tool-system/web-search-tool-foundation.md
Design decision: Option C — dedicated tools/ module, tools injected via DI.
Files in scope: server/src/agent/tools/types.ts, registry.ts, registry.test.ts — no other files.
Test framework: vitest (server, ^2.1.8), co-located *.test.ts, ESM `.js` import specifiers.
Available after: none (prereq).
Architecture rule: pure module, no DB/network/SDK imports in types.ts.
[RESTATE: types.ts stays SDK-free; provider coupling is isolated to T3/T4.]

## DELIVERABLE
Given a registry built with a mock read-only tool, When `resolveTools(["web_search"])`, Then it returns that tool.
Given names including an unknown tool, When `resolveTools`, Then unknown names are dropped (no throw).
Given a list of tools, When `toAnthropicToolDefs`, Then each maps to `{name, description, input_schema}`.
[must-not] Given types.ts, When imported, Then it must NOT pull in `@anthropic-ai/sdk` or `@tavily/core`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have: Tool/ToolResult/ToolEvent/ToolRiskTier exported; registry resolve + Anthropic-def mapping; tests written before implementation.
Must-not-have: any SDK/network import in types.ts; tool marketplace/user-authored loading; caching.
Open question risks: structured-error enum not finalized → expose `errorCode` as `string` (not a closed enum) so T3 can populate it.
Red flags: importing SDK into types.ts → STOP.

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, commit created.
Escalate when: a consumer needs a field not in the interface (report NEEDS_CONTEXT before widening).

---

### Task 2: DB schema + template tool assignment [prereq] [parallel: T1]

## OBJECTIVE
Extend the data model so tools and per-column budget are data-driven, and assign `web_search` to the research-specialist column in the research-report template.

Files:
- Modify: `server/src/db/agent-schema.sql`
- Modify: `server/src/agent/templates.ts`
- Test: `server/src/agent/templates.test.ts`

Steps:
1. (Structural [no-tdd]) Add to `server/src/db/agent-schema.sql` (additive, idempotent):
   `ALTER TABLE columns ADD COLUMN IF NOT EXISTS tools TEXT[] NOT NULL DEFAULT '{}';`
   `ALTER TABLE columns ADD COLUMN IF NOT EXISTS tool_budget INTEGER;`  (nullable → loop uses default 3 when null)
   New table:
   ```sql
   CREATE TABLE IF NOT EXISTS agent_tool_calls (
     id          SERIAL PRIMARY KEY,
     board_id    INTEGER NOT NULL REFERENCES agent_boards(id) ON DELETE CASCADE,
     column_slug TEXT NOT NULL,
     tool_name   TEXT NOT NULL,
     input       JSONB,
     result      TEXT,
     error_code  TEXT,
     attempt     INTEGER NOT NULL DEFAULT 1,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_board ON agent_tool_calls(board_id);
   ```
   Verify: `npm run db:migrate` runs without error (or `grep -c "agent_tool_calls" server/src/db/agent-schema.sql` == expected).
2. Write failing test for: research-report template gives research-specialist `tools: ["web_search"]` and other columns `[]`.
   File: `server/src/agent/templates.test.ts`
   Test verifies: Given `getTemplate("research-report")`, When inspecting columns, Then `research-specialist.tools` deep-equals `["web_search"]` and `editor.tools` deep-equals `[]` (or undefined → normalize via `?? []`).
   ```ts
   // server/src/agent/templates.test.ts
   import { describe, it, expect } from "vitest";
   import { getTemplate } from "./templates.js";

   describe("research-report template tool assignment", () => {
     const template = getTemplate("research-report")!;
     const bySlug = (slug: string) =>
       template.columns.find((c) => c.slug === slug)!;

     it("gives the research-specialist column web_search", () => {
       expect(bySlug("research-specialist").tools).toEqual(["web_search"]);
     });

     it("gives non-research columns no tools", () => {
       // others omit `tools` or set [] — normalize so either is accepted
       expect(bySlug("editor").tools ?? []).toEqual([]);
       expect(bySlug("writer").tools ?? []).toEqual([]);
       expect(bySlug("analysis-specialist").tools ?? []).toEqual([]);
       expect(bySlug("qa-guardian").tools ?? []).toEqual([]);
     });
   });
   ```
3. Run test — verify FAIL: `npx vitest run src/agent/templates.test.ts`.
4. Implement: in `server/src/agent/templates.ts` extend `interface TemplateColumn` with `tools?: string[]` and `tool_budget?: number`; set `tools: ["web_search"]` on the `research-specialist` column (others omit/`[]`). Update `insertColumns` SQL in `server/src/agent/routes.ts` ONLY IF needed to persist `tools`/`tool_budget` — NOTE: deferred to T6 to keep this task within templates+schema; here just add `tools` to the in-memory template definition.
5. Run test — verify PASS: `npx vitest run src/agent/templates.test.ts`.
6. Commit: `git add server/src/db/agent-schema.sql server/src/agent/templates.ts server/src/agent/templates.test.ts` then `git commit -m "feat(agent-tools): add per-column tools/budget schema and assign web_search"`.

## REFERENCES LOADED
docs/pocket/spec/...web-search-tool-foundation.md — rule R1, R2 (per-column budget), R5 (trace table)
server/src/db/agent-schema.sql — existing additive ALTER pattern (board_id, slug, reasoning, system_prompt)
server/src/agent/templates.ts — RESEARCH_REPORT_COLUMNS structure

## WHY THIS APPROACH
Complexity: lightweight
Justification: additive schema + one template field; mirrors existing `ALTER TABLE columns ADD COLUMN IF NOT EXISTS` precedent. Prereq because T5/T6 read these columns and the trace table.

## SANDWICH CONTEXT
[CRITICAL: Schema changes are ADDITIVE ONLY — IF NOT EXISTS / nullable defaults. No existing column altered destructively; no data migration.]
You are implementing the data model + template tool assignment for the Agent Tool System.
Spec: docs/pocket/spec/2026-06-15-agent-tool-system/web-search-tool-foundation.md
Design decision: Option C — tool assignment is data-driven per column (template → DB).
Files in scope: server/src/db/agent-schema.sql, server/src/agent/templates.ts, templates.test.ts.
Test framework: vitest (server). Template test is pure (no DB).
Available after: none (prereq).
Architecture rule: template-agnostic — schema/columns must not hardcode research-report; only the template DATA names web_search.
[RESTATE: additive schema only; template-agnostic columns.]

## DELIVERABLE
Given the research-report template, When read, Then research-specialist.tools == ["web_search"] and editor.tools == [].
Given agent-schema.sql, When migrated, Then columns has nullable `tool_budget`, `tools TEXT[] DEFAULT '{}'`, and table `agent_tool_calls` exists.
[must-not] Given the schema change, When applied twice, Then it must NOT error (idempotent).

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have: additive idempotent schema; template field typed and assigned; tests before code.
Must-not-have: destructive schema change; hardcoding research-report in non-template code; persistence wiring (that's T6).
Open question risks: `agent_tool_calls` shape may need tweaks → if T5 needs another field, report NEEDS_CONTEXT.
Rollback note: feature additive — clearing `columns.tools` disables tools with no schema rollback.

## STOP CONDITIONS
Done when: template test passes, migration applies cleanly, commit created.
Escalate when: an existing column would need a destructive change.

---

### Task 3: web_search tool (Tavily) [depends: T1]

## OBJECTIVE
Implement the `web_search` Tool against the T1 interface: Tavily-backed, ≤10 results, ≤3 retries, structured error codes, empty-result and size-cap hygiene.

Files:
- Create: `server/src/agent/tools/webSearch.ts`
- Test: `server/src/agent/tools/webSearch.test.ts`
- Modify: `server/package.json` (add `@tavily/core` dependency)

Steps:
1. Write failing tests for R3/R7/R8:
   File: `server/src/agent/tools/webSearch.test.ts` (mock `@tavily/core`)
   Tests verify:
   - Happy: Given Tavily returns 12 results, When `execute({query})`, Then ≤10 results returned, each content size-capped; `ok:true`.
   - Retry: Given Tavily throws a network error once then succeeds, When `execute`, Then it retries and returns `ok:true`.
   - ENV_VAR_MISSING: Given `TAVILY_API_KEY` unset, When `execute`, Then `ok:false, errorCode:"ENV_VAR_MISSING"` WITHOUT calling Tavily.
   - RATE_LIMIT: Given Tavily throws `Error("Rate limit exceeded")` on all attempts, When `execute`, Then after 3 retries `ok:false, errorCode:"RATE_LIMIT"`.
   - Empty: Given Tavily returns `results:[]`, When `execute`, Then `ok:true, content` states "no results found for <query>".
   ```ts
   // server/src/agent/tools/webSearch.test.ts
   import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

   const mockSearch = vi.fn();
   vi.mock("@tavily/core", () => ({
     tavily: vi.fn(() => ({ search: mockSearch })),
   }));

   function makeResults(n: number) {
     return Array.from({ length: n }, (_, i) => ({
       title: `Title ${i}`,
       url: `https://example.com/${i}`,
       content: "x".repeat(1000), // long snippet to exercise the size cap
     }));
   }

   describe("web_search tool", () => {
     beforeEach(() => {
       mockSearch.mockReset();
       process.env.TAVILY_API_KEY = "test-key";
     });
     afterEach(() => {
       delete process.env.TAVILY_API_KEY;
     });

     it("caps to ≤10 results and size-caps each snippet (R2/R8)", async () => {
       mockSearch.mockResolvedValueOnce({ results: makeResults(12) });
       const { webSearch } = await import("./webSearch.js");
       const result = await webSearch.execute({ query: "fintech" });

       expect(result.ok).toBe(true);
       // never asks Tavily for more than 10
       expect(mockSearch).toHaveBeenCalledWith("fintech", expect.objectContaining({ maxResults: 10 }));
       // at most 10 results surface, and the long snippet is truncated
       const matches = result.content.match(/https:\/\/example\.com\//g) ?? [];
       expect(matches.length).toBeLessThanOrEqual(10);
       expect(result.content).not.toContain("x".repeat(1000));
     });

     it("retries a transient network error then succeeds (R3)", async () => {
       mockSearch
         .mockRejectedValueOnce(new Error("fetch failed"))
         .mockResolvedValueOnce({ results: makeResults(1) });
       const { webSearch } = await import("./webSearch.js");
       const result = await webSearch.execute({ query: "fintech" });

       expect(result.ok).toBe(true);
       expect(mockSearch).toHaveBeenCalledTimes(2);
     });

     it("returns ENV_VAR_MISSING without calling Tavily when key unset (R3)", async () => {
       delete process.env.TAVILY_API_KEY;
       const { webSearch } = await import("./webSearch.js");
       const result = await webSearch.execute({ query: "fintech" });

       expect(result).toMatchObject({ ok: false, errorCode: "ENV_VAR_MISSING" });
       expect(mockSearch).not.toHaveBeenCalled();
     });

     it("returns RATE_LIMIT after exhausting retries (R3)", async () => {
       mockSearch.mockRejectedValue(new Error("Rate limit exceeded"));
       const { webSearch } = await import("./webSearch.js");
       const result = await webSearch.execute({ query: "fintech" });

       expect(result).toMatchObject({ ok: false, errorCode: "RATE_LIMIT" });
       expect(mockSearch).toHaveBeenCalledTimes(3); // ≤3 attempts
     });

     it("does NOT retry an auth error (API_ERROR)", async () => {
       mockSearch.mockRejectedValue(new Error("Invalid API key"));
       const { webSearch } = await import("./webSearch.js");
       const result = await webSearch.execute({ query: "fintech" });

       expect(result).toMatchObject({ ok: false, errorCode: "API_ERROR" });
       expect(mockSearch).toHaveBeenCalledTimes(1); // auth won't fix itself
     });

     it("reports a friendly message on empty results (R7)", async () => {
       mockSearch.mockResolvedValueOnce({ results: [] });
       const { webSearch } = await import("./webSearch.js");
       const result = await webSearch.execute({ query: "obscure topic" });

       expect(result.ok).toBe(true);
       expect(result.content.toLowerCase()).toContain("no results found");
       expect(result.content).toContain("obscure topic");
     });

     it("never throws — any failure surfaces as a structured result", async () => {
       mockSearch.mockRejectedValue(new Error("something weird"));
       const { webSearch } = await import("./webSearch.js");
       await expect(webSearch.execute({ query: "x" })).resolves.toMatchObject({
         ok: false,
       });
     });
   });
   ```
   > Note: this mock resolves/rejects instantly, so the implementation's retry backoff must be either zero in tests or short; if a real `setTimeout` backoff is added, wrap retry waits so they don't slow the suite (e.g. `vi.useFakeTimers()` + `vi.runAllTimersAsync()`), or keep backoff small (≤ a few ms).
2. Run test — verify FAIL: `npx vitest run src/agent/tools/webSearch.test.ts`.
3. Implement: `server/src/agent/tools/webSearch.ts` exporting a `Tool` named `web_search`, riskTier `"read-only"`, inputSchema `{type:"object", properties:{query:{type:"string"}}, required:["query"]}`. `execute`: read `process.env.TAVILY_API_KEY` → if absent return `{ok:false, errorCode:"ENV_VAR_MISSING"}` WITHOUT constructing the client; else call `tavily({apiKey}).search(query, {maxResults: 10})` inside a retry helper (≤3 attempts, small backoff). Error classification — wrap the entire `search()` call in one try/catch (the Tavily SDK throws `Error`; this also catches underlying fetch/timeout rejections that surface through the SDK). Classify on the caught error, case-insensitively, in this order: `/rate.?limit/i` → `RATE_LIMIT`; `/invalid api key|unauthorized|401|403/i` → `API_ERROR`; `/timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|fetch failed|network/i` → `NETWORK_ERROR`; anything else → `UNKNOWN`. Retry only `RATE_LIMIT`, `NETWORK_ERROR`, and `UNKNOWN`; do NOT retry `API_ERROR` (auth won't fix itself). Truncate each result to title+url+snippet (snippet capped, e.g. 300 chars); empty results → friendly "no results found for <query>" content with `ok:true`. Add `@tavily/core` to `server/package.json` deps.
4. Run test — verify PASS: `npx vitest run src/agent/tools/webSearch.test.ts`.
5. Commit: `git add server/src/agent/tools/webSearch.ts server/src/agent/tools/webSearch.test.ts server/package.json` then `git commit -m "feat(agent-tools): add Tavily-backed web_search with retry and structured errors"`.

## REFERENCES LOADED
docs/pocket/spec/...web-search-tool-foundation.md — rules R2 (≤10 results), R3 (retry+structured error), R7 (empty), R8 (size cap)
server/src/agent/tools/types.ts (T1) — Tool/ToolResult interface to implement
Tavily JS docs (context7 /tavily-ai/tavily-js): `tavily({apiKey}).search(query, {maxResults})`; errors thrown as Error with message "Invalid API key"/"Rate limit"

## WHY THIS APPROACH
Complexity: standard
Justification: branching error mapping + retry + hygiene; one file but real judgment on error classification. Library docs fetched (Tavily) — verify the response field is `results` and option is `maxResults`.

## SANDWICH CONTEXT
[CRITICAL: web_search executes server-side ONLY; never expose TAVILY_API_KEY to the client. On any failure after retries it returns a structured ToolResult — it MUST NOT throw out of execute().]
You are implementing the web_search tool for the Agent Tool System.
Spec: docs/pocket/spec/2026-06-15-agent-tool-system/web-search-tool-foundation.md
Design decision: Option C — Cara B (we own the call), Tavily provider.
Files in scope: server/src/agent/tools/webSearch.ts, webSearch.test.ts, server/package.json.
Test framework: vitest; mock `@tavily/core` (do not hit the network in tests).
Available after: T1 (Tool interface).
Architecture rule: implement the T1 Tool interface exactly; errorCode strings drive agent adaptation (T4 loop feeds them back).
[RESTATE: execute() never throws; returns structured ToolResult; key stays server-side.]

## DELIVERABLE
Given Tavily returns >10 results, When execute, Then ≤10 returned and each size-capped (R2/R8).
Given a transient error then success, When execute, Then it retries (≤3) and returns ok:true (R3).
Given TAVILY_API_KEY unset, When execute, Then ok:false errorCode "ENV_VAR_MISSING", Tavily not called (R3).
Given rate-limit on all attempts, When execute, Then ok:false errorCode "RATE_LIMIT" after 3 retries (R3).
Given empty results, When execute, Then ok:true with explicit "no results found" content (R7).
[must-not] Given any failure, When execute, Then it must NOT throw (returns structured result).

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have: ≤10 results, ≤3 retries, structured errorCode, empty + size-cap handling; tests before code; mocked Tavily.
Must-not-have: caching results; calling Tavily when key missing; throwing out of execute; exposing the key.
Open question risks: exact Tavily error message strings → match case-insensitively and fall back to API_ERROR/UNKNOWN. Library API: verify `maxResults`/`results` against installed @tavily/core version.
Red flags: network call in tests → DONE_WITH_CONCERNS.

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, commit created.
Escalate when: installed @tavily/core API differs from docs (report NEEDS_CONTEXT).

---

### Task 4: Tool execution loop in executeCard [depends: T1] [parallel: T3]

## OBJECTIVE
Make `executeCard` agentic: when the model returns `stop_reason: "tool_use"`, execute the requested tools (injected), enforce the per-card budget, emit tool events via a callback, feed `tool_result` back, and loop until a final text turn. Only the final turn's text is the returned output. No tools → today's single-shot path unchanged.

Files:
- Modify: `server/src/agent/llm.ts`
- Test: `server/src/agent/llm.test.ts`

Steps:
1. Write failing tests (mock `@anthropic-ai/sdk` stream → finalMessage):
   File: `server/src/agent/llm.test.ts`
   Tests verify:
   - Loop: Given a tool turn (`stop_reason:"tool_use"` with a `web_search` block) then an `end_turn` text turn, When `executeCard(..., tools:[mockTool], budget:3, onToolEvent)`, Then mockTool.execute is called once, `onToolEvent` fires started+result, and the returned `output` is ONLY the final turn's text (R4).
   - Budget: Given the model keeps requesting tool_use beyond budget=1, When executeCard, Then the 2nd request is not executed and the model is told the limit is reached; final output still produced (R2).
   - Adapt on failure: Given mockTool returns `ok:false, errorCode:"RATE_LIMIT"`, When executeCard, Then the structured error is fed back as tool_result, `onToolEvent` fires failed, and executeCard returns a final output (no throw) (R3).
   - Degrade: Given `tools:[]` (or undefined), When executeCard, Then it behaves exactly as today (single stream, no tools param) (R1/Scenario 5).
   ```ts
   // server/src/agent/llm.test.ts — ADD these to the existing file
   // (the existing `vi.mock("@anthropic-ai/sdk", ...)` with mockCreate/mockStream
   //  and the `./templates.js` mock at the top of the file are reused as-is).
   import type { Tool, ToolEvent } from "./tools/types.js";

   // Build a fake stream turn: text deltas (async-iterable) + a finalMessage().
   function makeTurn(opts: {
     text?: string;
     stopReason: "tool_use" | "end_turn";
     toolUse?: { id: string; name: string; input: Record<string, unknown> };
   }) {
     const content: unknown[] = [];
     if (opts.text) content.push({ type: "text", text: opts.text });
     if (opts.toolUse)
       content.push({ type: "tool_use", ...opts.toolUse });
     return {
       async *[Symbol.asyncIterator]() {
         if (opts.text)
           yield {
             type: "content_block_delta",
             delta: { type: "text_delta", text: opts.text },
           };
       },
       finalMessage: vi
         .fn()
         .mockResolvedValue({ stop_reason: opts.stopReason, content }),
     };
   }

   function mockTool(execute: Tool["execute"]): Tool {
     return {
       name: "web_search",
       description: "Search the web",
       inputSchema: { type: "object", properties: { query: { type: "string" } } },
       riskTier: "read-only",
       execute,
     };
   }

   describe("executeCard tool loop", () => {
     beforeEach(() => {
       mockStream.mockReset();
     });

     it("executes a tool then returns ONLY the final turn's text (R4)", async () => {
       // turn 1: model asks for the tool; turn 2: model writes the answer
       mockStream
         .mockReturnValueOnce(
           makeTurn({
             text: "let me search", // interim reasoning — must NOT be in output
             stopReason: "tool_use",
             toolUse: { id: "tu_1", name: "web_search", input: { query: "x" } },
           }),
         )
         .mockReturnValueOnce(
           makeTurn({ text: "Final answer.", stopReason: "end_turn" }),
         );

       const execute = vi.fn(async () => ({ ok: true, content: "search hit" }));
       const events: ToolEvent[] = [];
       const { executeCard } = await import("./llm.js");

       const result = await executeCard(
         "prompt",
         "intent",
         [],
         false,
         vi.fn(),
         [mockTool(execute)],
         3,
         (e: ToolEvent) => events.push(e),
       );

       expect(execute).toHaveBeenCalledTimes(1);
       expect(events.map((e) => e.phase)).toEqual(
         expect.arrayContaining(["started", "result"]),
       );
       // R4: only the final (non-tool_use) turn is the official output
       expect(result.output).toBe("Final answer.");
       expect(result.output).not.toContain("let me search");
     });

     it("refuses tool calls past the budget but still produces a final answer (R2)", async () => {
       // budget=1: first tool_use is executed, the model asks again, second is refused.
       mockStream
         .mockReturnValueOnce(
           makeTurn({
             stopReason: "tool_use",
             toolUse: { id: "tu_1", name: "web_search", input: { query: "a" } },
           }),
         )
         .mockReturnValueOnce(
           makeTurn({
             stopReason: "tool_use",
             toolUse: { id: "tu_2", name: "web_search", input: { query: "b" } },
           }),
         )
         .mockReturnValueOnce(
           makeTurn({ text: "Done within budget.", stopReason: "end_turn" }),
         );

       const execute = vi.fn(async () => ({ ok: true, content: "hit" }));
       const { executeCard } = await import("./llm.js");

       const result = await executeCard(
         "prompt", "intent", [], false, vi.fn(),
         [mockTool(execute)], 1, vi.fn(),
       );

       // budget counts model-issued requests, not retries → only 1 execution
       expect(execute).toHaveBeenCalledTimes(1);
       expect(result.output).toBe("Done within budget.");
     });

     it("feeds a structured tool error back and finishes without throwing (R3)", async () => {
       mockStream
         .mockReturnValueOnce(
           makeTurn({
             stopReason: "tool_use",
             toolUse: { id: "tu_1", name: "web_search", input: { query: "x" } },
           }),
         )
         .mockReturnValueOnce(
           makeTurn({ text: "Recovered.", stopReason: "end_turn" }),
         );

       const execute = vi.fn(async () => ({
         ok: false,
         content: "rate limited",
         errorCode: "RATE_LIMIT",
       }));
       const events: ToolEvent[] = [];
       const { executeCard } = await import("./llm.js");

       const result = await executeCard(
         "prompt", "intent", [], false, vi.fn(),
         [mockTool(execute)], 3, (e: ToolEvent) => events.push(e),
       );

       expect(events.some((e) => e.phase === "failed" && e.errorCode === "RATE_LIMIT")).toBe(true);
       expect(result.output).toBe("Recovered."); // no throw, final answer produced
     });

     it("degrades to the single-shot path when tools are empty (R1)", async () => {
       mockStream.mockReturnValueOnce(
         makeTurn({ text: "Plain answer.", stopReason: "end_turn" }),
       );
       const { executeCard } = await import("./llm.js");
       const onToken = vi.fn();

       // called the legacy way (no tools args) → identical to today
       const result = await executeCard("prompt", "intent", [], false, onToken);

       expect(mockStream).toHaveBeenCalledTimes(1);
       expect(mockStream.mock.calls[0][0]).not.toHaveProperty("tools");
       expect(result.output).toBe("Plain answer.");
       expect(onToken).toHaveBeenCalledWith("Plain answer.");
     });
   });
   ```
2. Run test — verify FAIL: `npx vitest run src/agent/llm.test.ts`.
3. Implement: extend `executeCard` signature additively to accept `tools: Tool[] = []`, `toolBudget = 3`, and `onToolEvent?: (e: ToolEvent) => void` (keep existing params/behavior; mirror the `_reasoning` additive-param precedent). When `tools.length === 0` → existing single-shot path. Otherwise build a message array; loop: `client.messages.stream({..., tools: toAnthropicToolDefs(tools)})`, stream text deltas via existing `onToken` ONLY for the turn that becomes final (buffer per-turn; interim turns' text is emitted via `onToolEvent({phase:"reasoning", text})` — this is the single event stream T7 consumes, no separate callback), `await finalMessage()`; if `stop_reason === "tool_use"`: for each `tool_use` block, if budget remaining → call `tool.execute(input)` (emit started/result|failed), else synthesize a "search limit reached" tool_result; append assistant message + a user message with `tool_result` blocks; decrement budget per executed request; continue. Stop when `stop_reason !== "tool_use"`; return that turn's text as `output`. Cap total loop iterations defensively at `toolBudget + 1`.
   Note: "final turn text only" — accumulate each assistant turn's text; the LAST turn (non-tool_use) is the official output; earlier turns' text is interim reasoning (forwarded for the trace, not concatenated into output).
4. Run test — verify PASS: `npx vitest run src/agent/llm.test.ts`.
5. Commit: `git add server/src/agent/llm.ts server/src/agent/llm.test.ts` then `git commit -m "feat(agent-tools): add tool-use execution loop with budget to executeCard"`.

## REFERENCES LOADED
docs/pocket/spec/...web-search-tool-foundation.md — rules R2, R3, R4; Scenario 1,2,4,5
server/src/agent/llm.ts — existing executeCard stream + finalMessage + onToken/200ms batching context; `_reasoning` additive-param precedent
server/src/agent/tools/types.ts (T1) — Tool/ToolEvent; registry.toAnthropicToolDefs
Anthropic SDK docs (context7 /anthropics/anthropic-sdk-typescript): `stop_reason:"tool_use"`; finalMessage content has `{type:"tool_use", id, name, input}`; feed back assistant msg + user msg with `tool_result` blocks `{type:"tool_result", tool_use_id, content}`; build loop manually (do NOT use beta toolRunner)

## WHY THIS APPROACH
Complexity: standard
Justification: multi-turn loop with budget + failure branching in a hot path; mocked-SDK tests with judgment on turn accounting. Loop owns streaming so it lives in the LLM layer (Option C).

## SANDWICH CONTEXT
[CRITICAL: Only the FINAL (non-tool_use) assistant turn becomes `output`. Interim reasoning text must NOT be concatenated into the card output. Tool failure must NOT hard-halt — feed the structured error back and let the model finish.]
You are implementing the tool-use loop in executeCard for the Agent Tool System.
Spec: docs/pocket/spec/2026-06-15-agent-tool-system/web-search-tool-foundation.md
Design decision: Option C — client-side loop, tools injected, manual loop (not beta toolRunner).
Files in scope: server/src/agent/llm.ts, llm.test.ts — no service.ts/routes.ts here.
Test framework: vitest; mock `@anthropic-ai/sdk` (mockStream/finalMessage), inject a mock Tool.
Available after: T1 (Tool interface). Uses a mock tool in tests, not webSearch.
Architecture rule: signature change additive (defaults preserve old callers); empty tools → unchanged single-shot path; standard tool_use shape (MiMo-compatible; degrade if unsupported).
[RESTATE: final turn = output; tool failure feeds back, never halts.]

## DELIVERABLE
Given a tool turn then a text turn, When executeCard with tools+budget, Then tool executes once, onToolEvent fires, output == final turn text only (R4).
Given budget exhausted, When the model requests another tool, Then it's refused and a final answer is still produced (R2).
Given a tool returns a structured error, When executeCard, Then the error is fed back, onToolEvent failed fires, and a final output returns without throwing (R3).
Given tools empty/undefined, When executeCard, Then behavior is identical to today (R1).
[must-not] Given interim reasoning turns, When building output, Then they must NOT be concatenated into the official output.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have: budget enforced (counts model-issued requests, not retries); structured-error feed-back; final-turn-only output; degrade path; tests before code.
Must-not-have: using beta toolRunner; halting the card on tool failure; concatenating interim text into output; async/long-running handling.
Open question risks: interleaving tool steps with the 200ms onToken batch → only stream the FINAL turn's tokens via onToken; route interim text through onToolEvent. MiMo may not support tool_use → if SDK rejects `tools`, degrade to no-tools and report DONE_WITH_CONCERNS.
Red flags: output contains interim reasoning → STOP.

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, commit created.
Escalate when: turn-accounting cannot satisfy "final-turn-only" with the SDK's finalMessage shape (report NEEDS_CONTEXT).

---

### Task 5: Wire service.ts — resolve tools, emit SSE, persist trace [depends: T2, T4]

## OBJECTIVE
In `runPipeline`/`triggerExecution`, resolve each column's tools+budget (from columns data) via the registry, pass them and an `onToolEvent` into `executeCard`; translate tool events into SSE via `publishEvent` (extend the server `BoardEvent` union); persist each tool call to `agent_tool_calls`; keep saving only the final output to `agent_card_outputs`.

Files:
- Modify: `server/src/agent/service.ts`
- Modify: `server/src/realtime.ts` (extend `BoardEvent` union with tool events)
- Test: `server/src/agent/service.test.ts`

Steps:
1. Write failing tests (inject deps — no real DB/SDK):
   File: `server/src/agent/service.test.ts`
   Tests verify:
   - Given a column with `tools:["web_search"]` and an injected `executeCard` that invokes its `onToolEvent`, When `runPipeline` runs, Then `publishEvent` is called with `agent.tool.started`/`agent.tool.result` events AND an injected `insertToolCall` dep is called (R5).
   - Given a tool event, When published, Then only the final output is written to `insertOutput` (agent_card_outputs), never to card_events (R6).
   - Given a column with `tools:[]`, When runPipeline runs, Then executeCard is called with empty tools and no tool events fire (R1).
   ```ts
   // server/src/agent/service.test.ts — ADD this block to the existing file.
   // Reuses the existing DEFAULT_BOARD const and the vi.useFakeTimers() pattern
   // already established in the `runPipeline` describe block above.

   describe("runPipeline tool wiring", () => {
     beforeEach(() => vi.useFakeTimers());
     afterEach(() => vi.useRealTimers());

     // A single research column that carries a tool + budget.
     const TOOL_COLUMNS: ColumnInfo[] = [
       {
         columnId: 10,
         columnSlug: "research-specialist",
         systemPrompt: "Research: {original_intent}",
         reasoning: false,
         tools: ["web_search"],
         toolBudget: 3,
       } as ColumnInfo,
     ];

     function buildToolService(overrides: Partial<AgentBoardServiceDeps> = {}) {
       const deps: AgentBoardServiceDeps = {
         getBoard: vi.fn().mockResolvedValue(DEFAULT_BOARD),
         getColumns: vi.fn().mockResolvedValue(TOOL_COLUMNS),
         // executeCard receives (sys, intent, prev, reasoning, onToken, tools, budget, onToolEvent)
         executeCard: vi.fn(
           async (
             _sys: string, _intent: string, _prev: string[], _reasoning: boolean,
             _onToken: (t: string) => void,
             _tools?: unknown[], _budget?: number,
             onToolEvent?: (e: Record<string, unknown>) => void,
           ) => {
             onToolEvent?.({ phase: "started", toolName: "web_search", query: "x" });
             onToolEvent?.({ phase: "result", toolName: "web_search", resultCount: 5 });
             return { output: "research done" };
           },
         ),
         insertOutput: vi.fn().mockResolvedValue(undefined),
         insertCard: vi.fn().mockResolvedValue(undefined),
         insertToolCall: vi.fn().mockResolvedValue(undefined),
         updateBoard: vi.fn().mockResolvedValue(undefined),
         publishEvent: vi.fn().mockResolvedValue(undefined),
         toolRegistry: { resolveTools: vi.fn((names: string[]) => names) },
         ...overrides,
       } as AgentBoardServiceDeps;
       return { service: createAgentBoardService(deps), deps };
     }

     it("translates tool events to SSE and persists each tool call (R5)", async () => {
       const { service, deps } = buildToolService();

       const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
       await vi.runAllTimersAsync();
       await promise;

       const published = (deps.publishEvent as ReturnType<typeof vi.fn>).mock.calls.map(
         (c) => c[1] as Record<string, unknown>,
       );
       expect(published.some((e) => e.type === "agent.tool.started")).toBe(true);
       expect(published.some((e) => e.type === "agent.tool.result")).toBe(true);
       expect(deps.insertToolCall).toHaveBeenCalledWith(
         expect.objectContaining({ columnSlug: "research-specialist", toolName: "web_search" }),
       );
     });

     it("writes the final output to agent_card_outputs only — never card_events (R6)", async () => {
       const { service, deps } = buildToolService();

       const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
       await vi.runAllTimersAsync();
       await promise;

       expect(deps.insertOutput).toHaveBeenCalledWith(
         expect.objectContaining({ columnSlug: "research-specialist", output: "research done" }),
       );
       // No card_events dep exists on the service; assert nothing tries to write one.
       const published = (deps.publishEvent as ReturnType<typeof vi.fn>).mock.calls.map(
         (c) => c[1] as Record<string, unknown>,
       );
       expect(published.every((e) => !String(e.type).startsWith("card."))).toBe(true);
     });

     it("passes empty tools and fires no tool events when a column has no tools (R1)", async () => {
       const events: Record<string, unknown>[] = [];
       const { service, deps } = buildToolService({
         getColumns: vi.fn().mockResolvedValue([
           {
             columnId: 10,
             columnSlug: "research-specialist",
             systemPrompt: "Research: {original_intent}",
             reasoning: false,
             tools: [],
             toolBudget: null,
           } as ColumnInfo,
         ]),
         executeCard: vi.fn(
           async (
             _s: string, _i: string, _p: string[], _r: boolean,
             _t: (x: string) => void, tools?: unknown[],
           ) => {
             expect(tools ?? []).toEqual([]); // resolved to empty
             return { output: "no-tool output" };
           },
         ),
         publishEvent: vi.fn(async (_wid, e) => { events.push(e); }),
       });

       const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
       await vi.runAllTimersAsync();
       await promise;

       expect(deps.executeCard).toHaveBeenCalled();
       expect(events.some((e) => String(e.type).startsWith("agent.tool."))).toBe(false);
     });
   });
   ```
   > Note: `toolRegistry`, `insertToolCall`, and `ColumnInfo.tools/toolBudget` are the new DI seams added in Step 3; `executeCard` is asserted positionally (8 args) to match the T4 signature.
2. Run test — verify FAIL: `npx vitest run src/agent/service.test.ts`.
3. Implement: extend `ColumnInfo` with `tools: string[]` and `toolBudget: number | null`; in `getColumns` consumers, resolve `Tool[]` via an injected `toolRegistry` dep (default = real registry with web_search); pass `tools`, `toolBudget ?? 3`, and an `onToolEvent` callback into `deps.executeCard`. The callback calls `deps.publishEvent` with `{type:"agent.tool.started"|"agent.tool.result"|"agent.tool.failed", columnSlug, toolName, query?, resultCount?, errorCode?, attempt?}` and `deps.insertToolCall?.({boardId, columnSlug, toolName, input, result, errorCode, attempt})`. Add `insertToolCall` to `AgentBoardServiceDeps` (optional). Extend `BoardEvent` union in `server/src/realtime.ts` with the three tool event types + optional fields. Keep final-output persistence to `agent_card_outputs` only.
4. Run test — verify PASS: `npx vitest run src/agent/service.test.ts`.
5. Commit: `git add server/src/agent/service.ts server/src/realtime.ts server/src/agent/service.test.ts` then `git commit -m "feat(agent-tools): wire tool resolution, SSE tool events, and trace persistence in service"`.

## REFERENCES LOADED
docs/pocket/spec/...web-search-tool-foundation.md — rules R1, R5, R6
server/src/agent/service.ts — runPipeline/triggerExecution loop, deps injection, 200ms token batching, insertOutput
server/src/realtime.ts — BoardEvent union (PublishableEvent = Omit<BoardEvent,"at">), publishEvent signature
server/src/agent/tools/registry.ts (T1), llm.ts executeCard new signature (T4)

## WHY THIS APPROACH
Complexity: standard
Justification: orchestration touching service + realtime union; DI seams already exist. Producer side of the event-driven flow.

## SANDWICH CONTEXT
[CRITICAL: Agent/tool output persists to agent_card_outputs and agent_tool_calls ONLY — never card_events (human Activity Feed must stay clean).]
You are wiring tool resolution + SSE + trace persistence into the agent service.
Spec: docs/pocket/spec/2026-06-15-agent-tool-system/web-search-tool-foundation.md
Design decision: Option C — service resolves per-column tools and translates tool events to SSE.
Files in scope: server/src/agent/service.ts, server/src/realtime.ts, service.test.ts.
Test framework: vitest; service tests use injected deps (no real DB/SDK/registry — inject mocks).
Available after: T2 (schema/columns), T4 (executeCard signature).
Architecture rule: DI everywhere; tool registry injected (default real); output to agent_card_outputs, trace to agent_tool_calls, never card_events.
[RESTATE: never write tool/agent data to card_events.]

## DELIVERABLE
Given a column with web_search and an executeCard that emits tool events, When runPipeline runs, Then publishEvent fires agent.tool.* and insertToolCall persists the call (R5).
Given a run completes, When persisting, Then only final output → agent_card_outputs; nothing → card_events (R6).
Given a column with no tools, When runPipeline runs, Then executeCard gets empty tools and no tool events fire (R1).
[must-not] Given any tool/agent write, When it occurs, Then it must NOT touch card_events.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have: per-column tool resolution via injected registry; SSE tool events; trace persistence; final-output-only to agent_card_outputs; tests before code.
Must-not-have: writes to card_events; touching core/ modules; changing human board CRUD.
Open question risks: agent_tool_calls field shape (from T2) → if a needed field is missing, report NEEDS_CONTEXT to T2 owner.
Rollback note: columns with empty tools → no tool events, behavior reverts.

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, commit created.
Escalate when: a tool write would otherwise land in card_events (STOP).

---

### Task 6: Routes — read tools/budget, persist + replay trace [depends: T5]

## OBJECTIVE
Wire the real DB deps: `getColumns` selects `tools`/`tool_budget`; `insertColumns` persists template `tools`/`tool_budget`; implement the real `insertToolCall`; `getBoardById` returns the stored tool trace per column for replay (R5) without re-running tools.

Files:
- Modify: `server/src/agent/routes.ts`
- Test: `server/src/agent/routes.ts` covered via existing route/integration patterns (assert query shape) — add focused unit assertions where feasible.

Steps:
1. Write failing test for trace replay shape (use existing route test harness / a thin query-shape test):
   Test verifies: Given a board with rows in `agent_tool_calls`, When the read-only trace replay runs, Then it returns a single flat `toolTrace` array: `Array<{columnSlug, toolName, query?, resultCount?, errorCode?, attempt?, createdAt}>` (ordered by created_at; the client groups by columnSlug), it queries with the board id, and NO tool is executed.
   ```ts
   // server/src/agent/routes.test.ts
   // The GET-board handler is wired into the Express app and has no supertest
   // harness in this repo, so the replay logic is extracted into a small
   // exported, pool-injectable read-only helper that the route calls and the
   // test drives directly (query-shape test). This keeps the route handler thin
   // and the trace logic unit-testable without booting Express.
   import { describe, it, expect, vi } from "vitest";
   import { getToolTrace } from "./routes.js"; // implementer EXPORTS this in Step 3

   describe("getToolTrace (read-only replay)", () => {
     it("returns the flat trace ordered by created_at, scoped to the board", async () => {
       const rows = [
         {
           column_slug: "research-specialist",
           tool_name: "web_search",
           input: { query: "fintech" },
           result: "…",
           error_code: null,
           attempt: 1,
           created_at: "2026-06-15T10:00:00Z",
         },
       ];
       const fakeDb = { query: vi.fn(async () => ({ rows })) };

       const trace = await getToolTrace(fakeDb as any, 42);

       // scoped to the board id
       expect(fakeDb.query).toHaveBeenCalledWith(expect.any(String), [42]);
       const sql = fakeDb.query.mock.calls[0][0] as string;
       expect(sql).toMatch(/agent_tool_calls/i);
       expect(sql).toMatch(/board_id\s*=\s*\$1/i);
       expect(sql).toMatch(/order by\s+created_at/i);

       // flat shape the client expects (groups by columnSlug itself)
       expect(trace).toEqual([
         expect.objectContaining({
           columnSlug: "research-specialist",
           toolName: "web_search",
           query: "fintech",
           attempt: 1,
           createdAt: "2026-06-15T10:00:00Z",
         }),
       ]);
     });

     it("is read-only — issues exactly one SELECT and executes no tool", async () => {
       const fakeDb = { query: vi.fn(async () => ({ rows: [] })) };
       const trace = await getToolTrace(fakeDb as any, 1);

       expect(trace).toEqual([]);
       expect(fakeDb.query).toHaveBeenCalledTimes(1);
       expect((fakeDb.query.mock.calls[0][0] as string).toLowerCase()).not.toContain("insert");
     });
   });
   ```
   > Note: this drives the replay through an exported `getToolTrace(db, boardId)` helper (pool injected for the test, defaulting to the real pool in the route). The GET-board handler calls it and attaches the result as `board.toolTrace`. The `getColumns`/`insertColumns`/`insertToolCall` realDeps SQL changes are exercised indirectly here via the same pool-injection pattern if the implementer chooses to extract them; at minimum the trace replay is unit-tested.
2. Run test — verify FAIL.
3. Implement in `server/src/agent/routes.ts`: extend `getColumns` SELECT to include `tools, tool_budget` and map to `ColumnInfo`; extend `insertColumns` INSERT to persist `tools` (TEXT[]) and `tool_budget`; add real `insertToolCall` dep (`INSERT INTO agent_tool_calls ...`); in the `GET .../boards/:id` handler, query `agent_tool_calls WHERE board_id=$1 ORDER BY created_at` and attach as a single flat `board.toolTrace` array of `{columnSlug, toolName, query?, resultCount?, errorCode?, attempt?, createdAt}` (the client groups by columnSlug). Read-only replay — never invoke a tool here.
4. Run test — verify PASS.
5. Commit: `git add server/src/agent/routes.ts` (+ test file) then `git commit -m "feat(agent-tools): persist tool assignments and expose tool trace for replay"`.

## REFERENCES LOADED
docs/pocket/spec/...web-search-tool-foundation.md — rules R1, R5
server/src/agent/routes.ts — realDeps (getColumns, insertColumns, getBoardById columns+cards assembly), pool.query patterns
server/src/agent/service.ts (T5) — insertToolCall dep contract; ColumnInfo.tools/toolBudget

## WHY THIS APPROACH
Complexity: standard
Justification: DB query wiring across several realDeps + a replay assembly; follows existing pool.query/getBoardById patterns.

## SANDWICH CONTEXT
[CRITICAL: getBoardById is history replay — it must NEVER trigger tool execution or re-run a pipeline. Read stored agent_tool_calls only.]
You are wiring the real DB deps and trace replay for the Agent Tool System.
Spec: docs/pocket/spec/2026-06-15-agent-tool-system/web-search-tool-foundation.md
Design decision: Option C — trace persisted in agent_tool_calls, replayed read-only.
Files in scope: server/src/agent/routes.ts (+ its test).
Test framework: vitest; follow existing agent route/integration test patterns.
Available after: T5 (insertToolCall contract, ColumnInfo shape), T2 (columns.tools/tool_budget, agent_tool_calls).
Architecture rule: additive route changes; replay is read-only; workspace ownership guards unchanged (requireWorkspaceMember).
[RESTATE: replay reads stored trace; never executes tools.]

## DELIVERABLE
Given columns rows with tools/tool_budget, When getColumns runs, Then ColumnInfo carries tools[] and toolBudget.
Given template insert, When insertColumns runs, Then tools and tool_budget are persisted.
Given a board with stored tool calls, When GET board, Then toolTrace is returned and no tool executes (R5).
[must-not] Given a board reopen, When fetched, Then it must NOT re-run any search.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have: tools/budget read+persisted; insertToolCall real impl; trace replay read-only; workspace guard intact; tests before code.
Must-not-have: executing tools during replay; touching card_events or human CRUD.
Open question risks: trace shape is LOCKED to a flat board-level `toolTrace` array (client groups by columnSlug) — do not change without updating T7.
Rollback note: additive — safe to leave columns empty.

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, commit created.
Escalate when: replay would require executing a tool (STOP).

---

### Task 7: Client — tool event types, collection, collapsible trace UI [depends: T6]

## OBJECTIVE
Surface tool activity to the user: extend the client `AgentEvent` union, collect tool events + stored trace in `BoardContext`, and render a collapsible, Camel-styled trace in the card detail panel — collapsed by default, expandable, replayable from stored trace on board reopen.

Files:
- Modify: `client/src/types.ts` (extend `AgentEvent` union + tool fields)
- Modify: `client/src/context/BoardContext.tsx` (collect `agent.tool.*` events; ingest `toolTrace` on board load)
- Create: `client/src/components/ToolTrace.tsx`
- Modify: `client/src/components/ContextPanel.tsx` (render `<ToolTrace>`)
- Test: `client/src/components/ToolTrace.test.tsx`

GATE (blocking, before any test or code): Read `docs/pocket/rule/creative-brief.md` in full — it is the design-system authority (colors, typography, spacing, components). Do NOT write the test or the component until this is read. The trace must use Camel styling, never claude.ai styling. Skipping this gate is a task violation.

Steps:
1. Write failing test for ToolTrace (props shape locked to T6: `steps: Array<{columnSlug, toolName, query?, resultCount?, errorCode?, attempt?, createdAt?}>`, plus live `reasoning` text items):
   File: `client/src/components/ToolTrace.test.tsx`
   Test verifies: Given a list of tool steps `[{toolName:"web_search", query:"X", resultCount:10}]`, When `<ToolTrace steps={...}/>` renders, Then it is collapsed by default showing a summary ("web_search · X · 10 results"), and expands to show detail on click; a step with `errorCode` shows a failed state.

   PRECONDITION (test infra — implementer must satisfy BEFORE this test can run): the client workspace has NO DOM test stack today. The implementer must, as part of Step 3 (or a dedicated chore before it):
   - add dev deps to `client/`: `@testing-library/react`, `@testing-library/dom`, `jsdom`;
   - set `test.environment: "jsdom"` AND widen `test.include` to `src/**/*.test.{ts,tsx}` in `client/vitest.config.ts` (currently only `src/**/*.test.ts`, so a `.tsx` test is NOT picked up).
   This is a test-first task: write the test below, watch it FAIL (initially because the harness/component are missing), then implement.
   ```tsx
   // client/src/components/ToolTrace.test.tsx
   import { describe, it, expect } from "vitest";
   import { render, screen, fireEvent } from "@testing-library/react";
   import { ToolTrace } from "./ToolTrace";

   describe("ToolTrace", () => {
     it("renders collapsed by default with a one-line summary", () => {
       render(
         <ToolTrace steps={[{ toolName: "web_search", query: "X", resultCount: 10 }]} />,
       );
       // collapsed summary: toolName · query · resultCount
       expect(screen.getByText(/web_search/)).toBeTruthy();
       expect(screen.getByText(/X/)).toBeTruthy();
       expect(screen.getByText(/10/)).toBeTruthy();
     });

     it("expands to show step detail on click", () => {
       render(
         <ToolTrace steps={[{ toolName: "web_search", query: "X", resultCount: 10 }]} />,
       );
       // detail not visible while collapsed
       expect(screen.queryByTestId("tool-trace-detail")).toBeNull();
       fireEvent.click(screen.getByRole("button"));
       expect(screen.getByTestId("tool-trace-detail")).toBeTruthy();
     });

     it("shows a failed state when a step carries an errorCode", () => {
       render(
         <ToolTrace
           steps={[{ toolName: "web_search", query: "X", errorCode: "RATE_LIMIT" }]}
         />,
       );
       expect(screen.getByText(/RATE_LIMIT/)).toBeTruthy();
     });

     it("renders nothing when there are no steps", () => {
       const { container } = render(<ToolTrace steps={[]} />);
       expect(container.textContent).toBe("");
     });
   });
   ```
   > Note: `screen.getBy*` truthiness assertions are used instead of `@testing-library/jest-dom` matchers (e.g. `toBeInTheDocument`) to avoid pulling in another dep — `getBy*` already throws if the element is absent. The component must expose a clickable toggle (`role="button"`) and a `data-testid="tool-trace-detail"` wrapper for the expanded section. Replay (R5): the same `steps` prop is fed from the stored `toolTrace` on board load, so no separate test path is needed — rendering from props IS the replay.
2. Run test — verify FAIL: `npx vitest run src/components/ToolTrace.test.tsx` (from `client/`).
3. Implement: extend `AgentEvent.type` union in `client/src/types.ts` with `"agent.tool.started" | "agent.tool.result" | "agent.tool.failed"` and optional fields `toolName?, query?, resultCount?, errorCode?, attempt?`; in `BoardContext.tsx` accumulate tool events (the existing `setAgentEvents` already captures them — derive a per-column step list) and ingest `toolTrace` from the board fetch for replay; create `ToolTrace.tsx` (collapsible, Camel-styled per creative-brief) showing summary + expandable detail and a failed state (errorCode); render it in `ContextPanel.tsx` for the selected card/column.
4. Run test — verify PASS.
5. Commit: `git add client/src/types.ts client/src/context/BoardContext.tsx client/src/components/ToolTrace.tsx client/src/components/ContextPanel.tsx client/src/components/ToolTrace.test.tsx` then `git commit -m "feat(agent-tools): add collapsible tool trace UI and event handling"`.

## REFERENCES LOADED
docs/pocket/spec/...web-search-tool-foundation.md — rules R4 (trace surfacing), R5 (replay)
docs/pocket/rule/creative-brief.md — design-system authority (MANDATORY for UI)
client/src/types.ts — AgentEvent union to extend
client/src/context/BoardContext.tsx — setAgentEvents / onmessage SSE handling; board fetch where toolTrace arrives
client/src/components/ContextPanel.tsx — card detail panel render location

## WHY THIS APPROACH
Complexity: standard
Justification: new component + state derivation + union change across 4 client files; UI judgment bound by creative-brief.

## SANDWICH CONTEXT
[CRITICAL: UI MUST follow docs/pocket/rule/creative-brief.md (Camel design system). Do not copy claude.ai styling; match Camel colors/typography/spacing.]
You are implementing the client tool-trace UI for the Agent Tool System.
Spec: docs/pocket/spec/2026-06-15-agent-tool-system/web-search-tool-foundation.md
Design decision: Option C — collapsible, persistent, replayable trace; final output stays the card body.
Files in scope: client/src/types.ts, context/BoardContext.tsx, components/ToolTrace.tsx, components/ContextPanel.tsx, ToolTrace.test.tsx.
Test framework: vitest (client, ^4.1.8) + existing client testing setup.
Available after: T6 (toolTrace payload shape, SSE tool event fields).
Architecture rule: client-only changes; consume the event/trace contract from T5/T6; do not change server.
[RESTATE: Camel styling per creative-brief; trace separate from card output.]

## DELIVERABLE
Given tool steps, When ToolTrace renders, Then collapsed summary shows toolName · query · resultCount; expands on click (R4).
Given a failed step with errorCode, When rendered, Then a failed state is shown.
Given a reopened board with stored toolTrace, When the card opens, Then the trace re-renders without any network search (R5).
[must-not] Given the trace, When rendered, Then it must NOT be merged into the official card output body.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have: AgentEvent union extended; collapsible Camel-styled trace; replay from stored trace; tests before code; creative-brief consulted.
Must-not-have: server changes; merging trace into card output; localStorage/sessionStorage usage.
Open question risks: exact toolTrace grouping from T6 → adapt component props to received shape; if mismatch, report NEEDS_CONTEXT.
Red flags: ignoring creative-brief / claude.ai styling → DONE_WITH_CONCERNS.

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, commit created.
Escalate when: the T6 trace payload shape can't drive the UI (report NEEDS_CONTEXT).

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|-----------------|
| T1 | Tool interface + registry | prereq | lightweight | resolveTools + Anthropic def mapping; types.ts SDK-free |
| T2 | Schema + template assignment | prereq | lightweight | research-specialist.tools==[web_search]; additive idempotent schema |
| T3 | web_search (Tavily) | T1 | standard | ≤10 results, ≤3 retries, structured errors, empty/size hygiene, never throws |
| T4 | Tool-use loop in executeCard | T1 | standard | final-turn-only output; budget enforced; failure feeds back; degrade w/o tools |
| T5 | Service wiring (SSE + trace) | T2, T4 | standard | agent.tool.* events + trace persisted; output→agent_card_outputs not card_events |
| T6 | Routes (persist + replay) | T5 | standard | tools/budget read+persisted; toolTrace replay read-only |
| T7 | Client collapsible trace UI | T6 | standard | collapsed summary→expand; replay from stored trace; Camel-styled |
