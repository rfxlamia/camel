# EXECUTION PLAN — query_board_data Tool + status-report Template

**Date:** 2026-06-20
**Spec:** docs/pocket/spec/2026-06-20-managerial-tools/query-board-data-and-status-report.md
**Status:** draft
**Total tasks:** 6 (T1–T5 unit/wiring; T6 opt-in live-LLM integration)

---

## Execution Overview

### Recommended Order
```
T1, T3, T4 (parallel) → T2 (after T1) → T5 (after T2 + T3 + T4) → T6 (after T2 + T3 + T4 + T5)
```
> T6 is opt-in live-LLM integration (`RUN_LLM_IT`); it adds no production code and is
> skipped by default `make test`. It runs last, once the full path (T2–T5) is assembled.

> Dependency order above is **recommended** — the pocket skill enforces actual
> parallelism and sequencing based on its routing logic.
> **T5 must run after T2** even though it has no logical data dependency: both edit
> `service.ts` (`AgentBoardServiceDeps`), `routes.ts` (`realDeps`), and
> `service.test.ts` — concurrent execution would clobber the shared files.

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T1, T3, T4 | none (all prereq) |
| Group B | T2 | T1 completes |
| Group C | T5 | T2 + T3 + T4 complete (T2 for shared-file safety) |
| Group D | T6 `[integration]` | T2 + T3 + T4 + T5 complete (full path assembled; opt-in RUN_LLM_IT) |

### Constraints Reminder
**Architecture:**
- May touch: `agent/tools/*`, `agent/service.ts` (deps + `runPipeline` tool-build + `createBoard`), `agent/routes.ts` (deps wiring), `agent/templates.ts`, `agent/llm.ts` (classifier + clarification).
- Must NOT touch: `core/metrics.ts` math, `card_events` / `agent_card_outputs` separation, HTTP route handlers (`routes/metrics.ts`, `routes/activity.ts`), the `Tool` / `ToolResult` contract shape.
- Patterns: `ToolResult` contract; runtime DI for context-bound tools (mirror `makeCreateFile`); `riskTier: "read-only"`; sequential pipeline columns; pure compute fns injected, never re-implemented.

**Out-of-scope (no task may touch):**
- standup / retrospective / sprint-planning templates
- enterprise features (budget, resource, multi-project)
- PDF / email / Slack output formats
- new DB schema, migrations, or metric definitions
- direct DB / HTTP calls **inside** the tool (DB access is injected via deps; SQL lives in `routes.ts` realDeps only)

**Assumptions at risk:**
- `content` is `JSON.stringify` of a structured object (so agent distinguishes `null` from `0`).
- Out-of-range window params are clamped (weeks→1–26), not rejected.
- Default `tool_budget` of 3 is adequate for the Analyst column.
- **Period round-trip (T5):** a supplied period folds into `original_intent`, mirroring `confirmRegenerateBoard` (service.ts ~1075). This is the headline open question — confirm at approval gate.
- `windowDays` bound is unspecified by spec — T1 assumes a sane clamp (e.g. 1–365).

**Sequencing:** Dependency order shown is recommended only — the pocket skill enforces actual blocking rules. `[depends: TN]` is not a hard lock unless the task cannot logically proceed without the prerequisite's output.

### File Structure Map

```
Rule 1.x: query_board_data tool
  Create: server/src/agent/tools/queryBoardData.ts          (created by: T1)
  Test:   server/src/agent/tools/queryBoardData.test.ts     (created by: T1)

Rule 1.x → wiring: DI into pipeline + real SQL-backed deps
  Modify: server/src/agent/service.ts (AgentBoardServiceDeps, runPipeline tool-build block)  (T2)
  Modify: server/src/agent/routes.ts (realDeps: fetchCardTimestamps/fetchActivityEvents + register query_board_data)  (T2)
  Test:   server/src/agent/service.test.ts                  (T2)

Rule 2.1: status-report template (2 sequential columns) + registry entry
  Modify: server/src/agent/templates.ts                     (T3)
  Test:   server/src/agent/templates.test.ts                (T3)

classifyIntent recognizes status-report intents
  Modify: server/src/agent/llm.ts (CLASSIFY_SYSTEM_PROMPT)  (T4)
  Test:   server/src/agent/llm.test.ts                      (T4)

Rule 2.3: missing-period clarification at createBoard (board stays pending)
  Modify: server/src/agent/service.ts (createBoard block + pending-branch fold-in)  (T5)
  Modify: server/src/agent/llm.ts (detectReportPeriod) + server/src/agent/routes.ts (wire dep)  (T5)
  Test:   server/src/agent/service.test.ts                  (T5)

Reused, NOT modified:
  server/src/core/metrics.ts (computeFlowMetrics, computeMetricsHistory)
  server/src/agent/artifact.ts (extractRevisedDocument, parseQaVerdict, deriveFilename)
```

---

## Pocket Packets

---

### Task 1: query_board_data read-only tool [prereq]

## OBJECTIVE
Create a context-bound `makeQueryBoardData` factory that returns a `Tool` exposing workspace-scoped flow data to the agent. It composes `computeFlowMetrics` / `computeMetricsHistory` (reused, not re-implemented) over injected fetch functions and returns a `JSON.stringify`'d structured object as `ToolResult.content`. No SQL/HTTP inside the tool.

Files:
- Create: `server/src/agent/tools/queryBoardData.ts`
- Test: `server/src/agent/tools/queryBoardData.test.ts`

Shape:
```ts
export interface QueryBoardDataCtx {
  workspaceId: number; // server-bound; never read from LLM input
  fetchCardTimestamps: (workspaceId: number) => Promise<CardTimestamps[]>;
  fetchActivityEvents: (workspaceId: number, limit: number) => Promise<ActivityItem[]>;
  now?: Date; // injectable for deterministic tests
}
export function makeQueryBoardData(ctx: QueryBoardDataCtx): Tool
```
- `name: "query_board_data"`, `riskTier: "read-only"`.
- `inputSchema`: `data_types` (array enum `"metrics"|"activity"|"history"`, optional), `windowDays` (number, optional), `weeks` (number, optional). **No workspace/board id field** (server-bound scoping).
- `description`: clearly explains the `data_types` enum so the agent selects correctly (design tradeoff).

Steps:
1. Write failing test for Rules 1.1–1.5 (see DELIVERABLE GWT).
   File: `server/src/agent/tools/queryBoardData.test.ts`
   Test verifies (factory + `vi.fn()` injected fetchers, fixed `now`):
   - metrics+history selection returns throughput/avgLeadTimeMs/avgCycleTimeMs/wipCount + 8 weekly buckets
   - omitted `data_types` returns all three sections
   - any id-like arg in input is ignored; `fetchCardTimestamps` called only with `ctx.workspaceId`
   - empty workspace → `ok:true`, `completedCount:0`, `hasData:false`, null averages, `activity:[]`
   - `weeks:500` → clamped to 26 (`history` has 26 buckets), `ok:true`
   - injected fetcher throws → `ok:false`, `errorCode:"DB_ERROR"`

   ```ts
   import { describe, expect, it, vi } from "vitest";
   import type { CardTimestamps } from "../../core/metrics.js";
   import { makeQueryBoardData } from "./queryBoardData.js";

   // Fixed clock so windowed metrics + weekly buckets are deterministic.
   const NOW = new Date("2026-06-20T00:00:00.000Z");
   const DAY = 24 * 60 * 60 * 1000;

   // One completed card (done 1 day ago) → throughput>0 under any default window.
   const doneCards: CardTimestamps[] = [
   	{
   		createdAt: new Date(NOW.getTime() - 3 * DAY),
   		startedAt: new Date(NOW.getTime() - 2 * DAY),
   		doneAt: new Date(NOW.getTime() - 1 * DAY),
   	},
   ];

   function buildCtx(overrides: Record<string, unknown> = {}) {
   	const fetchCardTimestamps = vi.fn(async (_wid: number) => doneCards);
   	const fetchActivityEvents = vi.fn(
   		async (_wid: number, _limit: number) =>
   			[{ id: 1, type: "card.moved" }] as Record<string, unknown>[],
   	);
   	const ctx = {
   		workspaceId: 7,
   		fetchCardTimestamps,
   		fetchActivityEvents,
   		now: NOW,
   		...overrides,
   	};
   	return { ctx, fetchCardTimestamps, fetchActivityEvents };
   }

   describe("query_board_data tool factory", () => {
   	it("has read-only shape with no workspace/board id field in the schema", () => {
   		const { ctx } = buildCtx();
   		const tool = makeQueryBoardData(ctx as never);
   		expect(tool.name).toBe("query_board_data");
   		expect(tool.riskTier).toBe("read-only");
   		expect(tool.inputSchema.type).toBe("object");
   		const props = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
   		expect(props).not.toHaveProperty("workspaceId");
   		expect(props).not.toHaveProperty("boardId");
   	});

   	it("metrics+history selection returns flow metrics + 8 weekly buckets", async () => {
   		const { ctx } = buildCtx();
   		const tool = makeQueryBoardData(ctx as never);
   		const result = await tool.execute({ data_types: ["metrics", "history"] });

   		expect(result.ok).toBe(true);
   		const payload = JSON.parse(result.content);
   		expect(payload.metrics).toMatchObject({
   			throughput: expect.any(Number),
   			wipCount: expect.any(Number),
   		});
   		expect(payload.metrics).toHaveProperty("avgLeadTimeMs");
   		expect(payload.metrics).toHaveProperty("avgCycleTimeMs");
   		expect(payload.history).toHaveLength(8);
   		// Section not requested must be absent.
   		expect(payload.activity).toBeUndefined();
   	});

   	it("omitted data_types returns all three sections", async () => {
   		const { ctx } = buildCtx();
   		const tool = makeQueryBoardData(ctx as never);
   		const payload = JSON.parse((await tool.execute({})).content);
   		expect(payload).toHaveProperty("metrics");
   		expect(payload).toHaveProperty("history");
   		expect(payload).toHaveProperty("activity");
   	});

   	it("ignores any id-like arg and fetches only with ctx.workspaceId", async () => {
   		const { ctx, fetchCardTimestamps } = buildCtx();
   		const tool = makeQueryBoardData(ctx as never);
   		await tool.execute({
   			data_types: ["metrics"],
   			workspaceId: 99,
   			boardId: 99,
   		});
   		expect(fetchCardTimestamps).toHaveBeenCalledWith(7);
   		expect(fetchCardTimestamps).not.toHaveBeenCalledWith(99);
   	});

   	it("empty workspace → ok:true, completedCount:0, hasData:false, null averages, activity:[]", async () => {
   		const { ctx } = buildCtx({
   			fetchCardTimestamps: vi.fn(async () => [] as CardTimestamps[]),
   			fetchActivityEvents: vi.fn(async () => [] as Record<string, unknown>[]),
   		});
   		const tool = makeQueryBoardData(ctx as never);
   		const result = await tool.execute({ data_types: ["metrics", "activity"] });

   		expect(result.ok).toBe(true);
   		const payload = JSON.parse(result.content);
   		expect(payload.metrics.completedCount).toBe(0);
   		expect(payload.metrics.hasData).toBe(false);
   		// null must survive JSON.stringify (distinguishable from 0).
   		expect(payload.metrics.avgLeadTimeMs).toBeNull();
   		expect(payload.metrics.avgCycleTimeMs).toBeNull();
   		expect(payload.activity).toEqual([]);
   	});

   	it("clamps weeks=500 to 26 buckets and returns ok:true", async () => {
   		const { ctx } = buildCtx();
   		const tool = makeQueryBoardData(ctx as never);
   		const result = await tool.execute({ data_types: ["history"], weeks: 500 });
   		expect(result.ok).toBe(true);
   		expect(JSON.parse(result.content).history).toHaveLength(26);
   	});

   	it("injected fetcher throws → ok:false, errorCode:DB_ERROR", async () => {
   		const { ctx } = buildCtx({
   			fetchCardTimestamps: vi.fn(async () => {
   				throw new Error("connection refused");
   			}),
   		});
   		const tool = makeQueryBoardData(ctx as never);
   		const result = await tool.execute({ data_types: ["metrics"] });
   		expect(result).toMatchObject({ ok: false, errorCode: "DB_ERROR" });
   	});
   });
   ```
2. Run test — verify FAIL:
   `npx vitest run server/src/agent/tools/queryBoardData.test.ts`
   Expected: module/factory not found → import/assertion failures.
3. Implement `makeQueryBoardData`:
   - Parse input defensively: `data_types` defaults to `["metrics","activity","history"]`; ignore unknown fields.
   - Clamp `weeks` to `[1,26]`, `windowDays` to `[1,365]` (assumption; spec only fixes weeks 1–26).
   - For `metrics`/`history`: `await ctx.fetchCardTimestamps(ctx.workspaceId)` then call `computeFlowMetrics(cards,{windowDays,now})` / `computeMetricsHistory(cards,{weeks,now})`.
   - **Compose tool-level fields on top of `FlowMetrics`** (these are NOT in `core/metrics.ts` and must NOT be added there): `completedCount = metrics.throughput`, `hasData = metrics.throughput > 0`.
   - For `activity`: `await ctx.fetchActivityEvents(ctx.workspaceId, limit)`; default empty `[]`.
   - Wrap fetch/compute in try/catch → on throw return `{ ok:false, content:"data fetch failed", errorCode:"DB_ERROR" }`.
   - On success: `{ ok:true, content: JSON.stringify(payload) }` where payload only includes requested sections.
4. Run test — verify PASS:
   `npx vitest run server/src/agent/tools/queryBoardData.test.ts`
   Expected: PASS.
5. Commit:
   `git add server/src/agent/tools/queryBoardData.ts server/src/agent/tools/queryBoardData.test.ts`
   `git commit -m "feat(agent): add read-only query_board_data tool"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-20-managerial-tools/query-board-data-and-status-report.md — rules 1.1–1.5, Design Decision (Option A)
server/src/agent/tools/createFile.ts — context-bound factory pattern to mirror
server/src/core/metrics.ts — `computeFlowMetrics`/`computeMetricsHistory` signatures + `CardTimestamps`/`FlowMetrics` types (FlowMetrics has NO completedCount/hasData)
server/src/agent/tools/types.ts — `Tool`/`ToolResult`/`ToolInputSchema` contract
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: 1 new file + 1 test, but branching over `data_types`, clamping, null-vs-0 composition, and error mapping require judgment; pure + injected deps keeps it fully unit-testable without a DB.

## SANDWICH CONTEXT
[CRITICAL: Do NOT add `completedCount`/`hasData` or any new math to `core/metrics.ts` — compose them in the tool. Do NOT put SQL or HTTP inside the tool — DB access is injected.]
You are implementing the `query_board_data` tool for the managerial-tools feature.
Spec: docs/pocket/spec/2026-06-20-managerial-tools/query-board-data-and-status-report.md
Design decision: Option A — one configurable tool, `data_types` enum + optional `windowDays`/`weeks`, `content` is `JSON.stringify` of a structured object.
Files in scope: `server/src/agent/tools/queryBoardData.ts`, `server/src/agent/tools/queryBoardData.test.ts` — no other files.
Test framework: Vitest — colocated `*.test.ts`, `describe/it/expect/vi`, inject `vi.fn()` fetchers + fixed `now`.
Available after: none (prereq).
Architecture rule: `riskTier:"read-only"`; reuse pure compute fns injected, never re-implement metric math; `workspaceId` server-bound (no id field in inputSchema).
[RESTATE: core/metrics.ts is read-only — compose completedCount/hasData in the tool; no SQL/HTTP inside the tool.]

## DELIVERABLE
Given a workspace with completed cards, When the tool runs with `data_types=["metrics","history"]`, Then `ok=true` and content (parsed) includes throughput, avgLeadTimeMs, avgCycleTimeMs, wipCount, and 8 weekly history buckets.
Given `data_types` omitted, When the tool runs, Then all three sections (metrics, activity, history) are present.
Given the tool was built for workspace 7, When the LLM input includes any workspace/board id argument, Then it is ignored and `fetchCardTimestamps` is called only with `ctx.workspaceId`.
Given a workspace with zero completed cards and empty activity, When the tool runs with `data_types=["metrics","activity"]`, Then `ok=true`, `completedCount=0`, `hasData=false`, metric averages `null`, and `activity` is `[]` (no error).
Given `weeks=500`, When the tool runs, Then it clamps to 26 buckets and returns `ok=true`.
Given the injected fetch throws, When the tool runs, Then `ok=false` and `errorCode="DB_ERROR"`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
- All 6 DELIVERABLE scenarios pass.
- `content` is `JSON.stringify` of a structured object preserving `null` vs `0`.
- `inputSchema` exposes no workspace/board id field.
- Tests written BEFORE implementation (TDD).
- Conventional commit message.

Must-not-have:
- Any change to `core/metrics.ts` (incl. adding completedCount/hasData there).
- SQL or HTTP calls inside the tool.
- Reads of `agent_card_outputs`.
- New metric math.

Open question risks:
- `windowDays` bound is unspecified → assume clamp `[1,365]`; if wrong, report NEEDS_CONTEXT.
- Activity item shape — derive a minimal shape from `routes/activity.ts` `toActivityEvent`; if the agent needs more fields, report DONE_WITH_CONCERNS.

Rollback note:
- Tool is read-only, no persistent state; deleting the file fully reverts.

Red flags:
- Editing core/metrics.ts → STOP.
- Adding SQL inside tool → STOP.

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created, no out-of-scope files modified.
Uncertain when: required activity fields exceed what `routes/activity.ts` exposes.
Escalate when: a scenario seems to require touching `core/metrics.ts` or in-tool SQL.

---

### Task 2: Wire query_board_data into the pipeline + real SQL-backed deps [depends: T1]

## OBJECTIVE
Make `query_board_data` available at runtime, mirroring the `create_file` DI block. Add `fetchCardTimestamps` / `fetchActivityEvents` to `AgentBoardServiceDeps`; build `makeQueryBoardData` inside `runPipeline` only when a column's `tools` includes `"query_board_data"`; back the deps with workspace-scoped SQL in `routes.ts` `realDeps` (same SQL the metrics/activity routes use, but reads only `cards` + `card_events`).

Files:
- Modify: `server/src/agent/service.ts` (`AgentBoardServiceDeps`; `runPipeline` tool-build block ~lines 627–648)
- Modify: `server/src/agent/routes.ts` (`realDeps`; do NOT modify `routes/metrics.ts`/`routes/activity.ts`)
- Test: `server/src/agent/service.test.ts`

Steps:
1. Write failing test for the runPipeline injection (see DELIVERABLE).
   File: `server/src/agent/service.test.ts`
   Test verifies (service built with mock deps; a template column whose `tools` includes `"query_board_data"`):
   - when that column executes, the resolved tools passed to `executeCard` include a tool named `query_board_data` bound to the board's `workspaceId`
   - when a column's tools do NOT include `query_board_data`, the tool is absent
   - `fetchCardTimestamps`/`fetchActivityEvents` deps are invoked with the board's workspaceId (assert via a fake tool execution)

   ```ts
   // Add to server/src/agent/service.test.ts (alongside the existing runPipeline suite).
   // `tools` is the 6th positional arg to executeCard → mock.calls[i][5].
   describe("runPipeline — query_board_data injection (T2)", () => {
   	beforeEach(() => {
   		vi.useFakeTimers();
   	});
   	afterEach(() => {
   		vi.useRealTimers();
   	});

   	const QBD_COLUMN: ColumnInfo = {
   		columnId: 30,
   		columnSlug: "analyst",
   		systemPrompt: "Report on: {original_intent}",
   		reasoning: true,
   		tools: ["query_board_data"],
   	};

   	it("injects a query_board_data tool bound to the board workspaceId when the column declares it", async () => {
   		const fetchCardTimestamps = vi.fn(async (_wid: number) => []);
   		const fetchActivityEvents = vi.fn(async (_wid: number, _limit: number) => []);
   		const { service, deps } = buildService({
   			getBoard: vi.fn().mockResolvedValue({ ...DEFAULT_BOARD, workspaceId: 7 }),
   			getColumns: vi.fn().mockResolvedValue([QBD_COLUMN]),
   			fetchCardTimestamps,
   			fetchActivityEvents,
   		});

   		const promise = service.runPipeline({ boardId: 1, workspaceId: 7 });
   		await vi.runAllTimersAsync();
   		await promise;

   		// calls[i][5] is the `tools` arg; it is `any` (untyped vi.fn), no cast.
   		const toolsArg = (deps.executeCard as ReturnType<typeof vi.fn>).mock
   			.calls[0][5];
   		const qbd = toolsArg.find(
   			(t: { name: string }) => t.name === "query_board_data",
   		);
   		expect(qbd).toBeDefined();

   		// Bound to the board's workspaceId: executing it fetches with 7 only.
   		await qbd!.execute({ data_types: ["metrics"], workspaceId: 99 });
   		expect(fetchCardTimestamps).toHaveBeenCalledWith(7);
   		expect(fetchCardTimestamps).not.toHaveBeenCalledWith(99);
   	});

   	it("does NOT inject query_board_data when the column omits it", async () => {
   		const { service, deps } = buildService({
   			fetchCardTimestamps: vi.fn(async () => []),
   			fetchActivityEvents: vi.fn(async () => []),
   			getColumns: vi.fn().mockResolvedValue([
   				{
   					columnId: 10,
   					columnSlug: "research-specialist",
   					systemPrompt: "Topic: {original_intent}",
   					reasoning: false,
   				},
   			] as ColumnInfo[]),
   		});

   		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
   		await vi.runAllTimersAsync();
   		await promise;

   		const toolsArg =
   			(deps.executeCard as ReturnType<typeof vi.fn>).mock.calls[0][5] ?? [];
   		expect(
   			toolsArg.some((t: { name: string }) => t.name === "query_board_data"),
   		).toBe(false);
   	});
   });
   ```
   > `fetchCardTimestamps`/`fetchActivityEvents` must be added to `AgentBoardServiceDeps`; `buildService` passes them straight through via its `...overrides` spread (no helper change needed).
2. Run test — verify FAIL:
   `npx vitest run server/src/agent/service.test.ts`
   Expected: assertion failure — no `query_board_data` tool in resolved set.
3. Implement:
   - In `service.ts`, extend `AgentBoardServiceDeps` with optional `fetchCardTimestamps?: (workspaceId:number)=>Promise<CardTimestamps[]>` and `fetchActivityEvents?: (workspaceId:number, limit:number)=>Promise<ActivityItem[]>`.
   - In `runPipeline`, after the existing `create_file` block, add a sibling block: if `(column.tools ?? []).includes("query_board_data")` and both fetch deps exist, append `makeQueryBoardData({ workspaceId, fetchCardTimestamps: deps.fetchCardTimestamps!, fetchActivityEvents: deps.fetchActivityEvents! })` to `resolvedTools`.
   - In `routes.ts` `realDeps`, implement `fetchCardTimestamps` via `SELECT created_at, started_at, done_at FROM cards WHERE workspace_id=$1 AND deleted_at IS NULL` (map to `CardTimestamps`); implement `fetchActivityEvents` via a workspace-scoped `card_events` read, bound by `limit`. **Pin a minimal, stable activity shape** the Analyst prompt can rely on — `{ type: string; cardTitle: string | null; at: string /* ISO */ }[]` (derive from `routes/activity.ts` `toActivityEvent`, projecting only these fields; do NOT pass raw rows). The tool↔LLM activity contract is this shape; T1 mocks should mirror it. Register so the registry/tool is reachable — note `query_board_data` is context-bound (built in runPipeline), so it does NOT go into `defaultToolRegistry`; ensure the template column references the name and the runPipeline block supplies it.
4. Run test — verify PASS:
   `npx vitest run server/src/agent/service.test.ts`
   Expected: PASS. Also run `make typecheck`.
5. Commit:
   `git add server/src/agent/service.ts server/src/agent/routes.ts server/src/agent/service.test.ts`
   `git commit -m "feat(agent): wire query_board_data into runPipeline with workspace-scoped deps"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-20-managerial-tools/query-board-data-and-status-report.md — Implementation Notes (inject only when column tools includes the name; back with workspace-scoped SQL)
server/src/agent/service.ts — `create_file` DI block (~627–648) is the exact pattern to mirror
server/src/agent/routes.ts — `realDeps` structure; `pool.query` usage
server/src/routes/metrics.ts — `CARD_TIMELINE_SQL` shape to reuse (read-only, do not modify the route)
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: edits two files across the DI seam; must mirror an existing pattern exactly and keep workspace scoping server-bound.

## SANDWICH CONTEXT
[CRITICAL: Build `makeQueryBoardData` ONLY when the column's tools include `"query_board_data"`, exactly mirroring the `create_file` block. `workspaceId` is server-bound from the board — never from LLM/tool input.]
You are wiring `query_board_data` into the agent pipeline for the managerial-tools feature.
Spec: docs/pocket/spec/2026-06-20-managerial-tools/query-board-data-and-status-report.md
Design decision: context-bound via `makeQueryBoardData({ workspaceId, fetchCardTimestamps, fetchActivityEvents })`, built in `runPipeline` like `create_file`.
Files in scope: `server/src/agent/service.ts`, `server/src/agent/routes.ts`, `server/src/agent/service.test.ts` — no other files.
Test framework: Vitest — build the service with mock deps; assert tools passed to `executeCard`.
Available after: T1 (the `makeQueryBoardData` factory must exist).
Architecture rule: SQL lives only in `routes.ts` realDeps; the tool reads `cards` + `card_events`, never `agent_card_outputs`; do not modify `routes/metrics.ts`/`routes/activity.ts` or the `Tool` contract.
[RESTATE: gate the injection on `tools.includes("query_board_data")`; workspaceId server-bound.]

## DELIVERABLE
Given a column whose `tools` includes `"query_board_data"`, When `runPipeline` executes that column, Then the tools passed to `executeCard` include a `query_board_data` tool bound to the board's workspaceId.
Given a column whose `tools` does NOT include `"query_board_data"`, When it executes, Then no such tool is passed.
[derived] Given the tool executes, When it fetches data, Then `fetchCardTimestamps`/`fetchActivityEvents` are called with the board's workspaceId only.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
- Injection gated on `tools.includes("query_board_data")`, mirroring `create_file`.
- `realDeps` SQL is workspace-scoped and reads only `cards` + `card_events`.
- `make typecheck` passes.
- Tests before implementation; conventional commit.

Must-not-have:
- Modifying `routes/metrics.ts` / `routes/activity.ts` / `core/metrics.ts`.
- Reading `agent_card_outputs` in the new deps.
- Trusting any workspace/board id from tool input.

Open question risks:
- Activity SQL/limit shape → reuse `routes/activity.ts` conventions; if ambiguous, report DONE_WITH_CONCERNS.

Rollback note:
- Remove the `makeQueryBoardData` injection block and the two `realDeps` fetchers — no persistent state.

Red flags:
- Putting query_board_data in `defaultToolRegistry` (it is context-bound, not static) → reconsider.
- Editing an out-of-scope route file → STOP.

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, typecheck green, commit created.
Uncertain when: the activity fetch shape can't be derived from existing route conventions.
Escalate when: wiring appears to require touching `core/metrics.ts` or an HTTP route handler.

---

### Task 3: status-report template (2 columns) + registry entry [prereq]

## OBJECTIVE
Add a `status-report` template: a 2-column sequential pipeline compatible with the unchanged artifact path (`editor_output` + QA-PASS + `create_file`). Column 1 (Analyst): `tools:["query_board_data"]`, `reasoning:true`, `output_key:"editor_output"`, writes the report body under `## Revised Document`. Column 2 (QA/Persist): `tools:["create_file"]`, emits `PASS | NEEDS REVISION` (qa-guardian style). Register under `TEMPLATES["status-report"]`. The Analyst prompt must encode honesty rules (2.4, 2.5) and the "are we on track?" objective (2.2).

Files:
- Modify: `server/src/agent/templates.ts`
- Test: `server/src/agent/templates.test.ts`

Steps:
1. Write failing test for the template shape (see DELIVERABLE).
   File: `server/src/agent/templates.test.ts`
   Test verifies (deterministic, structure/prompt-content only — NOT generated text):
   - `getTemplate("status-report")` returns a template with exactly 2 columns in order [analyst-slug, qa-slug]
   - Analyst column: `tools=["query_board_data"]`, `reasoning===true`, `output_key==="editor_output"`, prompt contains `## Revised Document`
   - QA column: `tools=["create_file"]`, prompt contains the `PASS`/`NEEDS REVISION` verdict shape
   - Analyst prompt contains honesty guidance (e.g. mentions not fabricating metrics / "not yet measurable" / "insufficient" language) — assert on substrings, not LLM output

   ```ts
   // Add to server/src/agent/templates.test.ts.
   describe("status-report template", () => {
   	it("returns exactly 2 columns: Analyst then QA/Persist", () => {
   		const t = getTemplate("status-report");
   		expect(t).not.toBeNull();
   		expect(t!.columns).toHaveLength(2);
   	});

   	it("Analyst column uses query_board_data + editor_output under ## Revised Document", () => {
   		const t = getTemplate("status-report")!;
   		const analyst = t.columns[0];
   		expect(analyst.tools).toEqual(["query_board_data"]);
   		expect(analyst.reasoning).toBe(true);
   		expect(analyst.output_key).toBe("editor_output");
   		expect(analyst.system_prompt).toContain("## Revised Document");
   	});

   	it("Analyst prompt encodes honesty rules + the on-track objective (substrings only)", () => {
   		const analyst = getTemplate("status-report")!.columns[0];
   		const prompt = analyst.system_prompt;
   		// Rule 2.5: null metric → "not yet measurable" rather than a number.
   		expect(prompt).toMatch(/not yet measurable/i);
   		// Rule 2.4: no completed cards → state insufficient data, still report WIP.
   		expect(prompt).toMatch(/insufficient/i);
   		// Rule 2.2: answer "are we on track?".
   		expect(prompt).toMatch(/on track/i);
   	});

   	it("QA column persists via create_file and emits a parseQaVerdict-compatible Status line", () => {
   		const qa = getTemplate("status-report")!.columns[1];
   		expect(qa.tools).toEqual(["create_file"]);
   		expect(qa.system_prompt).toMatch(/PASS/);
   		expect(qa.system_prompt).toMatch(/NEEDS REVISION/);
   	});
   });
   ```
   > Adjust the QA `Status:` assertion to whatever exact line `parseQaVerdict` requires (see `artifact.ts`); the substrings above match the qa-guardian verdict vocabulary in `RESEARCH_REPORT_COLUMNS`.
2. Run test — verify FAIL:
   `npx vitest run server/src/agent/templates.test.ts`
   Expected: `getTemplate("status-report")` is null → failures.
3. Implement:
   - Add `STATUS_REPORT_COLUMNS: TemplateColumn[]` (2 columns). **Each column MUST set all required `TemplateColumn` fields — `slug`, `name`, `position`, `reasoning`, `system_prompt` (plus `output_key`/`tools` where used)** — because `createBoard` → `insertColumns` reads `{ slug, name, position, reasoning, system_prompt }`; omitting `name` breaks board creation. Analyst position 1 (`slug:"analyst"`, `name:"Analyst"`): instructs to call `query_board_data`, ground every figure in returned data, answer "are we on track?", and explicitly: if a metric is `null` state "not yet measurable" (Rule 2.5); if `hasData=false`/no completed cards state "insufficient completed work to assess flow" and still report WIP if any (Rule 2.4); never invent figures. Output under `## Revised Document` so `extractRevisedDocument` works.
   - QA column position 2 (`slug:"qa-guardian"`, `name:"QA Guardian"`): qa-guardian-style validation of `{editor_output}` against `{original_intent}`, `tools:["create_file"]`, emits a `Status: PASS | NEEDS REVISION` line (matching `parseQaVerdict`'s `PASS_STATUS_LINE`), PASS persists / NEEDS REVISION does not. Reuse the research-report QA prompt structure, retargeted to the status report. **The QA prompt MUST explicitly treat an honest no-data / unmeasurable-metric report as a PASS (Rule 2.4)** — i.e. a report that correctly states "insufficient completed work" or "not yet measurable" is correct and must NOT be marked NEEDS REVISION for lacking numbers. Without this, the generic qa-guardian would fail honest no-data reports and the artifact would never persist (surfaces at T6).
   - Register `TEMPLATES["status-report"] = { id:"status-report", display_name:"Status Report", columns: STATUS_REPORT_COLUMNS }`.
4. Run test — verify PASS:
   `npx vitest run server/src/agent/templates.test.ts`
   Expected: PASS.
5. Commit:
   `git add server/src/agent/templates.ts server/src/agent/templates.test.ts`
   `git commit -m "feat(agent): add status-report template"`

[Behavioral Rules 2.2/2.4/2.5 are LLM behavior — verified at integration level (RUN_LLM_IT) in **Task 6**, see its `[integration]` DELIVERABLE lines (mirrored below). Unit tests here assert prompt content/structure only, not generated text.]

## REFERENCES LOADED
docs/pocket/spec/2026-06-20-managerial-tools/query-board-data-and-status-report.md — rules 2.1, 2.2, 2.4, 2.5
server/src/agent/templates.ts — `TemplateColumn`/`Template` types; `RESEARCH_REPORT_COLUMNS` editor + qa-guardian prompts to adapt
server/src/agent/artifact.ts — `extractRevisedDocument` requires `## Revised Document`; `parseQaVerdict` requires a `Status: PASS|NEEDS REVISION` line
server/src/agent/service.ts — `runPipeline` artifact path: QA-PASS + editor_output extraction (confirms no engine change needed)
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: pure data, but prompt design carries correctness for honesty/on-track behavior and must stay compatible with the unchanged `extractRevisedDocument`/`parseQaVerdict` contract.

## SANDWICH CONTEXT
[CRITICAL: The Analyst's `output_key` MUST be `"editor_output"` and its body MUST live under `## Revised Document`; the QA column MUST emit a `Status: PASS | NEEDS REVISION` line and carry `tools:["create_file"]` — otherwise the unchanged artifact path won't persist the report.]
You are adding the `status-report` template for the managerial-tools feature.
Spec: docs/pocket/spec/2026-06-20-managerial-tools/query-board-data-and-status-report.md
Design decision: 2 sequential columns reusing the existing editor_output + QA-PASS + create_file artifact path; no engine change.
Files in scope: `server/src/agent/templates.ts`, `server/src/agent/templates.test.ts` — no other files.
Test framework: Vitest — assert template structure + prompt substrings; do NOT assert on generated report text.
Available after: none (prereq).
Architecture rule: no change to `runPipeline`, `artifact.ts`, or the `Tool` contract; template is pure data.
[RESTATE: Analyst output_key=editor_output under `## Revised Document`; QA emits Status PASS|NEEDS REVISION with create_file.]

## DELIVERABLE
Given `getTemplate("status-report")`, When read, Then it returns 2 columns in order: Analyst then QA/Persist.
Given the Analyst column, When inspected, Then `tools=["query_board_data"]`, `reasoning=true`, `output_key="editor_output"`, and the prompt contains `## Revised Document`.
Given the QA column, When inspected, Then `tools=["create_file"]` and the prompt defines the `PASS | NEEDS REVISION` verdict.
[integration] Given workspace 7 with rising throughput and falling cycle time over 8 weeks and an approved status-report board scoped to a period, When the pipeline runs, Then the Analyst calls query_board_data, writes real figures with an "on track" verdict, QA returns PASS, and a markdown artifact is saved. (Rule 2.2)
[integration] Given a new workspace with no completed cards, When the pipeline runs, Then the report states completed work is insufficient to assess flow, reports WIP if any, invents no metrics, and QA returns PASS. (Rule 2.4)
[integration][must-not] Given query_board_data returns `avgCycleTimeMs=null`, When the Analyst writes the report, Then it states cycle time is not yet measurable and MUST NOT state a cycle-time number. (Rule 2.5)

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
- 2 columns, correct order, correct tools/output_key/reasoning.
- Every column sets all required `TemplateColumn` fields incl. `name` (insertColumns depends on it).
- Analyst prompt encodes honesty (null→"not yet measurable", no-data→"insufficient", no fabrication) and "are we on track?" objective.
- QA prompt compatible with `parseQaVerdict` AND explicitly PASSes an honest no-data/unmeasurable report (Rule 2.4).
- Tests before implementation; conventional commit.

Must-not-have:
- standup / retrospective / sprint-planning templates (out-of-scope — this task adds only status-report).
- Any change to `runPipeline` / `artifact.ts` / the `Tool` contract.
- Unit tests asserting on generated (LLM) report text.

Open question risks:
- Default `tool_budget` 3 adequacy for the Analyst → leave default; if integration shows budget exhaustion, report DONE_WITH_CONCERNS.

Rollback note:
- Remove the `status-report` registry entry and `STATUS_REPORT_COLUMNS`.

Red flags:
- Adding a deferred template (standup/retro) → STOP.
- Changing the artifact engine to fit the template → STOP.

## STOP CONDITIONS
Done when: unit DELIVERABLE (structure/prompt) scenarios pass, commit created.
Uncertain when: artifact path appears to need an engine change to persist the report.
Escalate when: the 2-column shape can't satisfy the unchanged editor_output/QA path.

---

### Task 4: classifyIntent recognizes status-report intents [prereq]

## OBJECTIVE
Teach the intent classifier to map status-report requests (any language) to `templateId:"status-report"`, without breaking existing research-report classification. Edit only the classifier system prompt (and add the template to the listed options); the parsing/retry machinery is unchanged.

Files:
- Modify: `server/src/agent/llm.ts` (`CLASSIFY_SYSTEM_PROMPT`)
- Test: `server/src/agent/llm.test.ts`

Steps:
1. Write failing test for status-report classification (see DELIVERABLE).
   File: `server/src/agent/llm.test.ts`
   Test verifies (mocked Anthropic client returning JSON, following existing llm.test.ts mock pattern):
   > TDD note (failability): because the Anthropic client is fully mocked, a mocked
   > `templateId:"status-report"` return would already "pass" against the unmodified
   > prompt — it cannot fail before implementation. The driving failing assertion is
   > therefore on the **system prompt sent to the LLM** (`mockCreate.mock.calls[0][0].system`
   > must list `status-report`), which only passes once `CLASSIFY_SYSTEM_PROMPT` is edited.
   - **`status-report` is offered to the LLM**: the `system` prompt actually sent to the Anthropic client lists `status-report` (this is the assertion that FAILS pre-implementation — the mocked client cannot fail on its own return value)
   - a status-report intent maps through correctly when the LLM returns it (contract guard)
   - an existing research intent still → `templateId="research-report"` (no regression)

   ```ts
   // Add to the `describe("classifyIntent", ...)` block in server/src/agent/llm.test.ts.
   // The Anthropic client is fully mocked, so a mocked return of "status-report"
   // would pass against the CURRENT prompt — it cannot drive test→fail. The
   // failing assertion is on the system prompt actually sent to the LLM:
   // mockCreate.mock.calls[0][0].system (same calls[0][0] params object the
   // existing max_tokens test inspects).
   it("offers status-report as a classifiable template in the system prompt", async () => {
   	mockCreate.mockResolvedValueOnce({
   		content: [
   			{
   				type: "text",
   				text: '{"templateId":"status-report","explanation":"ok"}',
   			},
   		],
   	});
   	const { classifyIntent } = await import("./llm.js");
   	await classifyIntent("give me a status report for the last 2 weeks");
   	expect(mockCreate.mock.calls[0][0].system).toMatch(/status-report/);
   });

   it("classifies a status-report intent as templateId=status-report", async () => {
   	mockCreate.mockResolvedValueOnce({
   		content: [
   			{
   				type: "text",
   				text: '{"templateId":"status-report","explanation":"Status report detected."}',
   			},
   		],
   	});
   	const { classifyIntent } = await import("./llm.js");
   	const result = await classifyIntent(
   		"give me a status report for the last 2 weeks",
   	);
   	expect(result.templateId).toBe("status-report");
   });

   it("still classifies research intents as research-report (no regression)", async () => {
   	mockCreate.mockResolvedValueOnce({
   		content: [
   			{
   				type: "text",
   				text: '{"templateId":"research-report","explanation":"Research task."}',
   			},
   		],
   	});
   	const { classifyIntent } = await import("./llm.js");
   	const result = await classifyIntent("riset kompetitor fintech");
   	expect(result.templateId).toBe("research-report");
   });
   ```
2. Run test — verify FAIL:
   `npx vitest run server/src/agent/llm.test.ts`
   Expected: the `system` prompt assertion fails — `CLASSIFY_SYSTEM_PROMPT` does not yet mention `status-report`. (The two contract/no-regression cases pass on the mocked return; they guard the parse path, not failability.)
3. Implement:
   - In `CLASSIFY_SYSTEM_PROMPT`, add `"status-report"` to the available templates list with a description (status / "are we on track" / progress reports for a workspace, incl. other languages) and an updated example. Keep the strict JSON-only contract and the `{"templateId": ... }` shape intact. Update the union hint to include `"status-report"`.
4. Run test — verify PASS:
   `npx vitest run server/src/agent/llm.test.ts`
   Expected: PASS.
5. Commit:
   `git add server/src/agent/llm.ts server/src/agent/llm.test.ts`
   `git commit -m "feat(agent): classify status-report intents"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-20-managerial-tools/query-board-data-and-status-report.md — "classifyIntent recognizes status-report intents" (in-scope), Open Questions row
server/src/agent/llm.ts — `CLASSIFY_SYSTEM_PROMPT`, `classifyIntent` retry wrapper, parse strategies (unchanged)
server/src/agent/llm.test.ts — existing mocked-Anthropic test pattern to follow
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: lightweight
Justification: single-file prompt edit; verifiable in isolation with a mocked LLM; independent of T1/T3.

## SANDWICH CONTEXT
[CRITICAL: Keep the strict JSON-only output contract and `{"templateId":...,"explanation":...}` shape — the parse strategies and 422 flow depend on it. Do not regress research-report classification.]
You are extending the intent classifier for the managerial-tools feature.
Spec: docs/pocket/spec/2026-06-20-managerial-tools/query-board-data-and-status-report.md
Design decision: classifier maps status-report intents to `templateId:"status-report"`; period detection is a SEPARATE concern (Task 5), not part of the classifier.
Files in scope: `server/src/agent/llm.ts`, `server/src/agent/llm.test.ts` — no other files.
Test framework: Vitest — mock the Anthropic client per existing llm.test.ts.
Available after: none (prereq).
Architecture rule: only `CLASSIFY_SYSTEM_PROMPT` changes; no change to parse/retry logic or the `ClassifyResult` shape.
[RESTATE: strict JSON-only contract preserved; no research-report regression; period detection NOT here.]

## DELIVERABLE
Given a status-report intent in English, When `classifyIntent` runs, Then `templateId="status-report"`.
[derived] Given a status-report intent in another language (e.g. Indonesian "laporan status"), When classified, Then `templateId="status-report"`.
Given an existing research intent, When classified, Then `templateId="research-report"` (no regression).

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
- status-report intents classify correctly; research-report unaffected.
- JSON-only contract + `ClassifyResult` shape unchanged.
- Tests before implementation; conventional commit.

Must-not-have:
- Period detection logic in the classifier (belongs to Task 5).
- Changes to parse strategies / retry wrapper.

Open question risks:
- Intent misrouted to research-report → mitigated by the no-regression test; if flaky, report DONE_WITH_CONCERNS.

Rollback note:
- Revert the `CLASSIFY_SYSTEM_PROMPT` additions.

Red flags:
- Editing parse/retry machinery → STOP.

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, commit created.
Uncertain when: classifier changes risk research-report regression that the test can't pin down.
Escalate when: the JSON contract would have to change to fit status-report.

---

### Task 5: Missing-period clarification at createBoard (board stays pending) [depends: T2, T3, T4]

## OBJECTIVE
When a status-report board is created with no resolvable time period, surface a clarification question (board stays `pending`, no pipeline runs), and when the user later supplies a period to a pending board, fold it into `original_intent` (mirroring `confirmRegenerateBoard`) so the existing approve→pipeline path runs with the period present. Period detection is an injected, mockable, LLM-backed dep (`detectReportPeriod`), kept out of the classifier.

Files:
- Modify: `server/src/agent/service.ts` (`createBoard` block + pending-branch fold-in ~961–973; `AgentBoardServiceDeps`)
- Modify: `server/src/agent/llm.ts` (add `detectReportPeriod`), `server/src/agent/routes.ts` (wire the dep into `realDeps`)
- Test: `server/src/agent/service.test.ts`

Steps:
1. Write failing test for createBoard clarification + pending fold-in (see DELIVERABLE).
   File: `server/src/agent/service.test.ts`
   Test verifies (service built with mock deps; `classifyIntent` returns `status-report`; `detectReportPeriod` mock toggled):
   - createBoard with no resolvable period → result carries a clarification question (asking for the period), board is created `pending`, and `runPipeline` is NOT called
   - createBoard WITH a resolvable period → no clarification; normal pending board created
   - `[derived]` sendMessage to a pending status-report board supplying a period → `detectReportPeriod` resolves it → `updateBoard` called with merged `original_intent` (fold-in), board still pending (no auto-run)
   - non-status-report intents are unaffected by period logic

   ```ts
   // Add to server/src/agent/service.test.ts.
   describe("status-report missing-period clarification (T5)", () => {
   	function classifyStatusReport() {
   		return vi.fn(async () => ({
   			templateId: "status-report",
   			explanation: "I made a Status Report board for you.",
   		}));
   	}

   	it("no resolvable period → clarification returned, board created pending, no pipeline", async () => {
   		const insertBoard = vi.fn(async () => ({ id: 42 }));
   		const detectReportPeriod = vi.fn(async () => ({
   			hasPeriod: false,
   			question: "Which time period should this status report cover?",
   		}));
   		const service = createAgentBoardService({
   			classifyIntent: classifyStatusReport(),
   			insertBoard,
   			insertConversation: vi.fn(async () => {}),
   			insertColumns: vi.fn(async () => {}),
   			publishEvent: vi.fn(async () => {}),
   			detectReportPeriod,
   		});

   		const result = await service.createBoard({
   			workspaceId: 1,
   			userId: 1,
   			intent: "give me a status report",
   		});

   		expect(detectReportPeriod).toHaveBeenCalled();
   		expect(result).toMatchObject({
   			boardId: 42,
   			explanation: expect.stringContaining("period"),
   		});
   		expect(insertBoard).toHaveBeenCalledWith(
   			expect.objectContaining({ status: "pending" }),
   		);
   	});

   	it("resolvable period → no clarification, normal pending board", async () => {
   		const detectReportPeriod = vi.fn(async () => ({ hasPeriod: true }));
   		const service = createAgentBoardService({
   			classifyIntent: classifyStatusReport(),
   			insertBoard: vi.fn(async () => ({ id: 7 })),
   			insertConversation: vi.fn(async () => {}),
   			insertColumns: vi.fn(async () => {}),
   			publishEvent: vi.fn(async () => {}),
   			detectReportPeriod,
   		});

   		const result = await service.createBoard({
   			workspaceId: 1,
   			userId: 1,
   			intent: "status report for the last 2 weeks",
   		});

   		expect(detectReportPeriod).toHaveBeenCalled();
   		expect(result).toMatchObject({ boardId: 7 });
   	});

   	it("non-status-report intent does not run period logic", async () => {
   		const detectReportPeriod = vi.fn(async () => ({ hasPeriod: false }));
   		const service = createAgentBoardService({
   			classifyIntent: vi.fn(async () => ({
   				templateId: "research-report",
   				explanation: "Research board.",
   			})),
   			insertBoard: vi.fn(async () => ({ id: 9 })),
   			insertConversation: vi.fn(async () => {}),
   			insertColumns: vi.fn(async () => {}),
   			publishEvent: vi.fn(async () => {}),
   			detectReportPeriod,
   		});

   		await service.createBoard({
   			workspaceId: 1,
   			userId: 1,
   			intent: "riset kompetitor fintech",
   		});

   		expect(detectReportPeriod).not.toHaveBeenCalled();
   	});

   	it("[derived] pending status-report board: supplied period folds into original_intent, board stays pending", async () => {
   		const updateBoard = vi.fn(async () => {});
   		const detectReportPeriod = vi.fn(async () => ({ hasPeriod: true }));
   		const service = createAgentBoardService({
   			getBoard: vi.fn(async () => ({
   				id: 1,
   				status: "pending",
   				templateId: "status-report",
   				workspaceId: 1,
   				userId: 1,
   				originalIntent: "give me a status report",
   			})),
   			insertConversation: vi.fn(async () => {}),
   			generateClarificationQuestion: vi.fn(async () => "Which period?"),
   			updateBoard,
   			detectReportPeriod,
   		});

   		await service.sendMessage({
   			boardId: 1,
   			userId: 1,
   			workspaceId: 1,
   			message: "the last 2 weeks",
   		});

   		expect(updateBoard).toHaveBeenCalledWith(
   			1,
   			expect.objectContaining({
   				original_intent: expect.stringContaining("last 2 weeks"),
   			}),
   		);
   		// No auto-run: approval remains the only pipeline trigger.
   		expect(updateBoard).not.toHaveBeenCalledWith(
   			1,
   			expect.objectContaining({ execution_status: "running" }),
   		);
   	});
   });
   ```
   > `detectReportPeriod` and `AgentBoardRecord.templateId` must be available on the
   > deps/board record for the fold-in branch. The fold-in is the plan's flagged
   > headline assumption — assertions stay exactly at the DELIVERABLE GWT (mutate
   > only `original_intent`, board stays pending), no stronger.
2. Run test — verify FAIL:
   `npx vitest run server/src/agent/service.test.ts`
   Expected: no clarification branch / no fold-in → assertion failures.
3. Implement:
   - Add `detectReportPeriod?: (intent:string)=>Promise<{ hasPeriod:boolean; question?:string }>` to `AgentBoardServiceDeps`.
   - In `createBoard`, after classify returns `status-report`: call `deps.detectReportPeriod?.(intent)`. If `hasPeriod===false`, still create the board as `pending` (so it stays pending) but return the clarification `question` as the explanation; do NOT trigger any pipeline (createBoard already never runs the pipeline — assert this stays true).
   - In the pending-branch of `sendMessage` (~961–973), for a status-report board: run `detectReportPeriod` on the user's message merged with `original_intent`; if now resolvable, `updateBoard(boardId,{ original_intent: mergedIntent })` (fold-in, mirroring `confirmRegenerateBoard`) and reply that the period is set and the board can be approved; else keep asking via `generateClarificationQuestion`. Do NOT auto-run the pipeline — approval remains the trigger.
   - In `llm.ts`, implement `detectReportPeriod` (small LLM call; returns hasPeriod + a focused question). Wire into `realDeps` in `routes.ts`.
4. Run test — verify PASS:
   `npx vitest run server/src/agent/service.test.ts`
   Expected: PASS. Run `make typecheck`.
5. Commit:
   `git add server/src/agent/service.ts server/src/agent/llm.ts server/src/agent/routes.ts server/src/agent/service.test.ts`
   `git commit -m "feat(agent): clarify missing period for status-report at board creation"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-20-managerial-tools/query-board-data-and-status-report.md — rule 2.3, Implementation Notes (clarification at createBoard/classifyIntent time, board stays pending)
server/src/agent/service.ts — `createBoard` (322–375), pending-branch of `sendMessage` (961–973), `confirmRegenerateBoard` (1052–1092, the original_intent mutation precedent)
server/src/agent/llm.ts — `generateClarificationQuestion` pattern for the new `detectReportPeriod`
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: branching across two service methods + a new injected LLM dep wired through routes; the fold-in is `[derived]` (not in spec GWT) and needs the confirmRegenerate precedent applied carefully.

## SANDWICH CONTEXT
[CRITICAL: No pipeline may run while the board is `pending` — clarification only sets up state; the existing approve step remains the sole pipeline trigger. The period fold-in mutates `original_intent` (mirroring confirmRegenerateBoard), nothing else.]
You are implementing missing-period clarification for status-report boards.
Spec: docs/pocket/spec/2026-06-20-managerial-tools/query-board-data-and-status-report.md
Design decision: period detection is a separate injected dep `detectReportPeriod` (LLM-backed, mockable), not part of classifyIntent; supplied period folds into `original_intent`.
Files in scope: `server/src/agent/service.ts`, `server/src/agent/llm.ts`, `server/src/agent/routes.ts`, `server/src/agent/service.test.ts` — no other files.
Test framework: Vitest — service with mock deps; toggle `detectReportPeriod` mock; assert `runPipeline` not called and `updateBoard` fold-in.
Available after: T3 (status-report template exists) and T4 (classifier returns status-report).
Architecture rule: board stays `pending`; approval is the only pipeline trigger; only `original_intent` is mutated on fold-in.
[RESTATE: pending boards never auto-run; fold-in mutates only original_intent.]

## DELIVERABLE
Given a status-report intent with no resolvable period, When the board is created, Then createBoard returns a clarification question asking for the period, the board is `pending`, and no pipeline runs.
Given a status-report intent WITH a resolvable period, When the board is created, Then no clarification is returned and the board is created normally (pending).
[derived] Given a pending status-report board, When the user sends a message supplying a period, Then `detectReportPeriod` resolves it, `original_intent` is updated with the merged period, the board stays pending, and no pipeline auto-runs (user must still approve).
[derived] Given a non-status-report intent, When the board is created, Then period logic does not run.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
- Missing-period status-report → clarification + board stays pending + no pipeline run.
- Supplied period folds into `original_intent` (confirmRegenerate precedent).
- Period detection injected + mockable (not in classifyIntent).
- Tests before implementation; `make typecheck` passes; conventional commit.

Must-not-have:
- Running the pipeline at createBoard or on a pending board.
- Putting period detection inside `classifyIntent`.
- Mutating fields other than `original_intent` on fold-in.

Open question risks:
- Period round-trip via `original_intent` is `[derived]`, not in spec GWT → headline assumption (see plan). If reviewer/user rejects the fold-in approach, report NEEDS_CONTEXT.

Rollback note:
- Revert the `createBoard` missing-period branch, the pending-branch fold-in, and `detectReportPeriod` (llm.ts + routes wiring). No DB migration to undo.

Red flags:
- Pipeline triggered before approval → STOP.
- Coupling period detection into the classifier → reconsider (belongs as its own dep).

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, typecheck green, commit created.
Uncertain when: the fold-in-via-original_intent approach is rejected at review.
Escalate when: satisfying the spec seems to require running the pipeline on a pending board.

---

### Task 6: status-report behavioral rules — live-LLM integration [integration] [depends: T2, T3, T4, T5]

## OBJECTIVE
Verify Rules 2.2 / 2.4 / 2.5 — the LLM-behavior honesty + on-track outcomes that unit tests deliberately do NOT assert — end-to-end against a live model, gated by `RUN_LLM_IT`. The pipeline runs with the real `executeCard`, the real `status-report` template, and an in-memory `fetchCardTimestamps` (no DB), asserting **structural** outcomes only (artifact saved, `parseQaVerdict === "pass"`, honesty phrase present, no fabricated cycle-time digit) — never exact generated prose.

Files:
- Modify: `server/src/agent/pipeline.integration.test.ts` (add a `describe.skipIf(!process.env.RUN_LLM_IT)` block; do NOT touch the existing research-report block)

Steps:
1. Write the integration scenarios (opt-in; only run under `RUN_LLM_IT=1`).
   File: `server/src/agent/pipeline.integration.test.ts`

   ```ts
   // Add a NEW describe block; reuse the existing imports
   // (createAgentBoardService, getTemplate, realExecuteCard, ColumnInfo).
   import type { CardTimestamps } from "../core/metrics.js";

   describe.skipIf(!process.env.RUN_LLM_IT)(
   	"Live-LLM: status-report honesty + on-track behavior",
   	{ timeout: 900_000 },
   	() => {
   		const statusTemplate = getTemplate("status-report")!;
   		const statusColumns: ColumnInfo[] = statusTemplate.columns.map((c) => ({
   			columnId: c.position,
   			columnSlug: c.slug,
   			systemPrompt: c.system_prompt,
   			reasoning: c.reasoning,
   			tools: c.tools,
   		}));

   		const DAY = 24 * 60 * 60 * 1000;
   		const NOW = new Date();

   		function runStatusReport(cards: CardTimestamps[], intent: string) {
   			const captured: { artifact?: string; qaOutput?: string } = {};
   			const service = createAgentBoardService({
   				getBoard: async () => ({
   					id: 1,
   					workspaceId: 1,
   					userId: 1,
   					templateId: "status-report",
   					originalIntent: intent,
   					status: "approved",
   					executionStatus: "running",
   				}),
   				getColumns: async () => statusColumns,
   				executeCard: realExecuteCard,
   				fetchCardTimestamps: async () => cards,
   				fetchActivityEvents: async () => [],
   				insertOutput: async (data) => {
   					if (data.columnSlug === statusColumns[1].columnSlug) {
   						captured.qaOutput = data.output;
   					}
   				},
   				insertCard: async () => {},
   				insertArtifact: async (a) => {
   					captured.artifact = a.content;
   				},
   				updateBoard: async () => {},
   				publishEvent: async () => {},
   			});
   			return { service, captured };
   		}

   		it("Rule 2.2: on-track report saves an artifact and QA passes", async () => {
   			// Rising throughput + falling cycle time over recent weeks.
   			const cards: CardTimestamps[] = Array.from({ length: 8 }, (_, i) => ({
   				createdAt: new Date(NOW.getTime() - (i + 3) * DAY),
   				startedAt: new Date(NOW.getTime() - (i + 2) * DAY),
   				doneAt: new Date(NOW.getTime() - (i + 1) * DAY),
   			}));
   			const { service, captured } = runStatusReport(
   				cards,
   				"status report for the last 2 weeks",
   			);
   			await service.runPipeline({ boardId: 1, workspaceId: 1 });

   			// Structural outcome: artifact persisted (QA returned PASS).
   			expect(captured.artifact).toBeTruthy();
   			expect(captured.artifact!.length).toBeGreaterThan(0);
   		});

   		it("Rule 2.4: no completed cards → honest insufficient-data report, QA passes", async () => {
   			// WIP only: started but never done.
   			const cards: CardTimestamps[] = [
   				{
   					createdAt: new Date(NOW.getTime() - 2 * DAY),
   					startedAt: new Date(NOW.getTime() - 1 * DAY),
   					doneAt: null,
   				},
   			];
   			const { service, captured } = runStatusReport(
   				cards,
   				"status report for the last 2 weeks",
   			);
   			await service.runPipeline({ boardId: 1, workspaceId: 1 });

   			// Artifact saved (no-data honesty is a PASS per Rule 2.4).
   			expect(captured.artifact).toBeTruthy();
   			// States insufficiency rather than inventing flow metrics.
   			expect(captured.artifact!).toMatch(/insufficient|not yet measurable|no completed/i);
   		});

   		it("Rule 2.5: avgCycleTimeMs=null → states not-yet-measurable, no cycle-time number", async () => {
   			// Done but never started → cycle time is null (lead time exists).
   			const cards: CardTimestamps[] = [
   				{
   					createdAt: new Date(NOW.getTime() - 3 * DAY),
   					startedAt: null,
   					doneAt: new Date(NOW.getTime() - 1 * DAY),
   				},
   			];
   			const { service, captured } = runStatusReport(
   				cards,
   				"status report for the last 2 weeks",
   			);
   			await service.runPipeline({ boardId: 1, workspaceId: 1 });

   			expect(captured.artifact).toBeTruthy();
   			const report = captured.artifact!;
   			// Honesty phrase present.
   			expect(report).toMatch(/cycle time[^.]*not yet measurable/i);
   			// MUST NOT fabricate a cycle-time figure: no "cycle time ... <number>"
   			// in the same clause. Structural check, not prose equality.
   			const cycleClaim = report.match(/cycle time[^.]*?(\d[\d.,]*\s*(?:d|h|m|days|hours|ms)\b)/i);
   			expect(cycleClaim, cycleClaim?.[0]).toBeNull();
   		});
   	},
   );
   ```
2. Run (opt-in): `RUN_LLM_IT=1 npm run test:integration --workspace=server`
   Expected (after T2–T5 land): PASS. Without `RUN_LLM_IT`, the block is skipped.
3. Commit:
   `git add server/src/agent/pipeline.integration.test.ts`
   `git commit -m "test(agent): integration coverage for status-report honesty rules"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-20-managerial-tools/query-board-data-and-status-report.md — rules 2.2, 2.4, 2.5
server/src/agent/pipeline.integration.test.ts — existing `describe.skipIf(!RUN_LLM_IT)` end-to-end pattern to mirror
server/src/core/metrics.ts — `CardTimestamps` shape for in-memory fixtures (null startedAt → null cycle time)
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: no production code — opt-in integration test only; the value is asserting LLM-behavior outcomes structurally (artifact saved, no fabricated digit) that unit tests cannot and must not pin to prose.

## SANDWICH CONTEXT
[CRITICAL: Assert STRUCTURAL outcomes only — artifact persisted, honesty phrase present, no fabricated cycle-time digit. NEVER assert exact generated prose; LLM text varies run to run.]
You are adding opt-in live-LLM integration coverage for status-report honesty rules.
Spec: docs/pocket/spec/2026-06-20-managerial-tools/query-board-data-and-status-report.md
Design decision: reuse the existing `describe.skipIf(!RUN_LLM_IT)` harness; in-memory `fetchCardTimestamps` (no DB); real `executeCard` + real `status-report` template + real `query_board_data` wiring.
Files in scope: `server/src/agent/pipeline.integration.test.ts` — no production code.
Test framework: Vitest — `RUN_LLM_IT=1 npm run test:integration --workspace=server`.
Available after: T2 (wiring), T3 (template), T4 (classifier), T5 (period) — needs the full path assembled.
Architecture rule: integration only; no string-equality on generated text.
[RESTATE: structural assertions only; skipped unless RUN_LLM_IT is set.]

## DELIVERABLE
[integration] Given rising throughput / falling cycle time, When the status-report pipeline runs, Then an artifact is saved (QA PASS). (Rule 2.2)
[integration] Given no completed cards (WIP only), When the pipeline runs, Then the report states insufficient data, invents no metrics, and an artifact is saved. (Rule 2.4)
[integration][must-not] Given `avgCycleTimeMs=null`, When the report is written, Then it states cycle time is not yet measurable and the saved artifact contains no cycle-time number. (Rule 2.5)

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
- Gated by `RUN_LLM_IT`; skipped by default `make test`.
- Structural assertions only (artifact persisted, honesty phrase present, no fabricated cycle-time digit).
- In-memory fetch deps — no real DB.
- Conventional commit.

Must-not-have:
- Exact-prose / string-equality assertions on generated LLM text.
- Real DB or HTTP dependence.
- Any production-code change (test file only).

Open question risks:
- A flaky honesty-phrase regex (model phrasing varies) → keep the alternation broad; if persistently flaky, report DONE_WITH_CONCERNS, do not tighten to exact prose.
- **This block is effectively an end-to-end test of T3's prompts, not just wiring.** Artifact capture requires the live Analyst to emit an exact `## Revised Document` header (so `extractRevisedDocument` works) AND the live QA column to emit a `Status: PASS` line (so `parseQaVerdict==="pass"` and `insertArtifact` fires). If `captured.artifact` is undefined, suspect T3 prompt drift (missing header / QA wrongly NEEDS-REVISION on no-data per Rule 2.4) before the wiring — fix in T3, do not weaken the assertion here.

Rollback note:
- Delete the added `describe` block — no production impact.

Red flags:
- Asserting exact report wording → STOP (brittle).
- Reaching for a real DB connection → STOP (use in-memory fetch deps).

## STOP CONDITIONS
Done when: the three scenarios pass under `RUN_LLM_IT=1`, skipped otherwise, commit created.
Uncertain when: a model reliably emits a cycle-time number despite the prompt — escalate to T3 prompt hardening, do not weaken the assertion.
Escalate when: structural verification appears to require an engine or template change beyond T2–T5.

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|------------------|
| T1 | query_board_data read-only tool | prereq | standard | data_types selection + clamp + empty→hasData:false + DB_ERROR; workspace server-bound |
| T2 | Wire tool into runPipeline + real deps | T1 | standard | tool injected only when column tools include it; workspace-scoped SQL on cards/card_events |
| T3 | status-report template (2 columns) | prereq | standard | 2 columns, Analyst output_key=editor_output + query_board_data, QA create_file; honesty prompt |
| T4 | classifyIntent recognizes status-report | prereq | lightweight | status-report intents → templateId="status-report"; no research-report regression |
| T5 | Missing-period clarification at createBoard | T2, T3, T4 | standard | no period → clarification + stays pending + no run; supplied period folds into original_intent |
| T6 | status-report honesty rules — live-LLM integration `[integration]` | T2, T3, T4, T5 | standard | RUN_LLM_IT only; structural outcomes for Rules 2.2/2.4/2.5 (artifact saved, honesty phrase, no fabricated cycle-time digit) |
