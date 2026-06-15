# Agent Tool System (Foundation + Web Search) — Wire service.ts — resolve tools, emit SSE, persist trace (Phase 2 of 2)

**Date:** 2026-06-15
**Original plan:** docs/pocket/plans/2026-06-15-agent-tool-system/execution-plan.md
**Prerequisite:** Phase 1 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T5, T6, T7}
**Unlocks next:** All phases complete — proceed to final validation

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

T5: Wire service.ts — resolve tools, emit SSE, persist trace [depends: T2, T4]
T6: Routes — read tools/budget, persist + replay trace [depends: T5]
T7: Client — tool event types, collection, collapsible trace UI [depends: T6]

---

## Pocket Packets

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

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to (none — all phases complete) ONLY after this gate passes.
