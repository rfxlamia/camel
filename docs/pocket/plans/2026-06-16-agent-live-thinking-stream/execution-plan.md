# EXECUTION PLAN — Agent Live Thinking Stream + Clickable Active Column

**Date:** 2026-06-16
**Spec:** docs/pocket/spec/2026-06-16-agent-live-thinking-stream/live-thinking.md
**Status:** draft
**Total tasks:** 8 (7 implementation + 1 opt-in integration)

---

### Test-Architect Summary

- **Tasks enriched:** 7 (T1–T7 — each Step 1 placeholder replaced with runnable Vitest code).
- **Integration test tasks added:** 1 — **T8** "Opt-in live-LLM thinking integration check" (appended to the existing `describe.skipIf(!process.env.RUN_LLM_IT)` block in `server/src/agent/pipeline.integration.test.ts`; `[depends: T2, T3]`, `[opt-in: RUN_LLM_IT]`). It is the only test that can validate the two live-only assumptions — MiMo accepting `max_tokens=24576` and real `thinking_delta` streaming end-to-end (llm.ts real stream → service.ts SSE). Dormant by default, requires no keys in CI.
- **TDD order corrections:** 0 — all tasks already followed Step1 write-failing-test → Step2 verify-FAIL → Step3 implement → Step4 verify-PASS → Step5 commit. Order verified intact across T1–T7; T8 follows the same order (its Step 3 is "no implementation — passes once T2/T3 land", which is the correct framing for a dependency-driven integration check).
- **Test framework:** Vitest (server: plain node; client: jsdom + @testing-library/react). Anthropic SDK mocked via the existing `mockStream`/`vi.mock("@anthropic-ai/sdk")` scaffold in `llm.test.ts`; service DI mocked via the existing `buildService()` helper; `useBoard`/`api` mocked in the client component test. No real external services in any unit test.
- **Coverage areas:**
  - **Tested (unit):** event-type round-trip + `boardId` on the union (T1); thinking-enabled params + `max_tokens=24576` on both LLM paths, `onThinking` on `thinking_delta`, live tool-path `onToken`, signed-thinking-block passback, no truncation (T2); batched `agent.card.thinking` SSE with `columnSlug`+`boardId`, flush-before-tool ordering, `boardId` on card lifecycle events (T3); per-board+slug derive, ordered concat, drop-unkeyed, cross-board isolation, `pickContent` live-else-DB (T4); `shouldClearOnWorkspaceChange` predicate (T5); live-vs-DB selection, failed state, corrected badge (T6, jsdom); `deriveColumnState` active/done/failed/pending + cross-board (T7).
  - **Tested (opt-in integration):** real MiMo accepts the token budget + live thinking streams end-to-end (T8).
  - **Intentionally NOT tested:** polite auto-follow scroll behavior (jsdom does not implement layout/scroll metrics — verified manually per spec UX-Naturalness); clickability wiring / onClick→onCardClick in `AgentBoardVisual` (DOM glue around the tested `deriveColumnState`, low-risk, would duplicate React-render plumbing); BoardContext/AgentPage clear-on-switch/load effects (integration-heavy provider wiring — the risky logic is extracted to the tested `shouldClearOnWorkspaceChange` predicate per the plan); markdown rendering internals (third-party `react-markdown`, already trusted); SSE drop/reconnect replay (EC2 — explicitly out of scope, lossy-by-design).

---

## Execution Overview

### Recommended Order
```
T1 → T2 → T3
     T1 → T4 (parallel with T2, T3)
T4 + T1 → T5 → T6 → T7
```

> Dependency order is **recommended** — pocket enforces actual sequencing.

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T2, T4 | T1 completes |
| Group B | T3 | T2 completes |
| Group C | T5 | T4 completes |

### Constraints Reminder
**Architecture:** Server agent SSE + agent UI only. DI in `service.ts`; SSE via `publishEvent`; `setInterval(200ms)` batching + flush before tool events; mirror `deriveToolTrace`/`pickToolTraceForColumn`; Biome (tabs + double quotes); NodeNext ESM `.js` imports on server; Vitest (client jsdom). UI must consult `docs/pocket/rule/creative-brief.md`.
**Out-of-scope (no task may touch):** `card_events`/`recordActivity`, `server/src/core/`, DB schema/migrations, chat re-enable/cancel, per-flag `reasoning` gating, refactoring legacy `triggerExecution` (only add `columnSlug` if unavoidable).
**Assumptions at risk:** MiMo accepting `max_tokens=24576` (mitigation: re-probe `server/probe-mimo-thinking.mjs` / clamp `THINKING_BUDGET` before merge). Tool-path live output (all turns) differs slightly from DB final (cleaned) — accepted.
**Sequencing:** `[depends: TN]` is recommended; treat as hard only where a symbol/contract from TN is required.

### File Structure Map
```
Rule R-A: Thinking enabled + streamed live (all columns)
  Modify: server/src/agent/llm.ts            (T2)
  Modify: server/src/agent/service.ts        (T3)
  Modify: server/src/realtime.ts             (T1)
  Modify: client/src/types.ts                (T1)
  Test:   server/src/agent/llm.test.ts       (T2)
  Test:   server/src/agent/service.test.ts   (T3)
  Test:   server/src/realtime.test.ts        (T1)
  Test:   client/src/types.test.ts           (T1)

Rule R-C/R-D: Accumulation + content source (live-else-DB), per-boardId
  Create: client/src/lib/agentStream.ts      (T4)  ← derive + pick helpers
  Test:   client/src/lib/agentStream.test.ts (T4)
  Modify: client/src/context/BoardContext.tsx (T5) ← clear on switch
  Modify: client/src/pages/AgentPage.tsx     (T5) ← clear on board load

Rule R-B/R-E: Clickable active column + live panel + done/failed transitions
  Modify: client/src/components/AgentCardDetail.tsx (T6)
  Test:   client/src/components/AgentCardDetail.test.tsx (T6)
  Modify: client/src/pages/AgentPage.tsx     (T7)  ← AgentBoardVisual clickable/failed/pending
  Test:   client/src/pages/agentBoardVisual.test.tsx (T7) ← extract derivation helper to test
```

---

## Pocket Packets

---

### Task 1: Shared agent event types (thinking + boardId) [prereq]

## OBJECTIVE
Extend the agent event contract on both server and client so a new live-thinking event and per-board scoping can flow end-to-end. No behavior yet — just the shared shape.

Files:
- Modify: `server/src/realtime.ts` (BoardEvent union + fields)
- Modify: `client/src/types.ts` (AgentEvent union + field)
- Test: `server/src/realtime.test.ts`
- Test: `client/src/types.test.ts`

Steps:
1. Write failing test: serialization/round-trip of an `agent.card.thinking` event with `columnSlug`, `token`, `boardId` through `publishEvent`/fan-out preserves all fields.
   File: `server/src/realtime.test.ts`
   Test verifies: Given an `agent.card.thinking` event, When published via the local hub, Then the drained event retains `type`, `columnSlug`, `token`, `boardId`.

   ```ts
   // server/src/realtime.test.ts — ADD this describe block (mirror existing
   // local-hub round-trip style: connectLocalClient → publishEvent → drain).
   describe("agent live-thinking event round-trip", () => {
   	it("preserves type, columnSlug, token, and boardId through local fan-out", async () => {
   		const hub = createRealtimeHub({ publisher: null, subscriber: null });
   		const client = hub.connectLocalClient({ workspaceId: 1 });

   		await hub.publishEvent(1, {
   			type: "agent.card.thinking",
   			columnSlug: "analysis-specialist",
   			token: "let me reason",
   			boardId: 42,
   		});

   		expect(client.drain()).toEqual([
   			{
   				type: "agent.card.thinking",
   				columnSlug: "analysis-specialist",
   				token: "let me reason",
   				boardId: 42,
   			},
   		]);
   	});
   });
   ```

   Also add a type/shape test to `client/src/types.test.ts` (mirror existing
   type-check-only style in that file — no assertions on behavior, just that the
   shape compiles and carries the new fields):

   ```ts
   // client/src/types.test.ts — ADD
   import type { AgentEvent } from "./types";

   describe("AgentEvent live-thinking shape", () => {
   	it("type-checks agent.card.thinking with boardId + columnSlug + token", () => {
   		const event: AgentEvent = {
   			type: "agent.card.thinking",
   			columnSlug: "analysis-specialist",
   			boardId: 42,
   			token: "reasoning chunk",
   		};
   		expect(event.type).toBe("agent.card.thinking");
   		expect(event.boardId).toBe(42);
   		expect(event.columnSlug).toBe("analysis-specialist");
   	});

   	it("type-checks boardId on existing agent.card.* events", () => {
   		const started: AgentEvent = {
   			type: "agent.card.started",
   			columnSlug: "research-specialist",
   			boardId: 7,
   		};
   		expect(started.boardId).toBe(7);
   	});
   });
   ```
2. Run test — verify FAIL: `npx vitest run server/src/realtime.test.ts client/src/types.test.ts` — expect type error / missing field on `agent.card.thinking` and `boardId`.
3. Implement: in `realtime.ts` add `"agent.card.thinking"` to `BoardEvent["type"]`; add optional `columnSlug?: string`, `token?: string`, `boardId?: number` to `BoardEvent`. In `client/src/types.ts` add `"agent.card.thinking"` to `AgentEvent["type"]` and `boardId?: number` to `AgentEvent`.
4. Run tests — verify PASS: `npx vitest run server/src/realtime.test.ts client/src/types.test.ts`.
5. Commit: `git add server/src/realtime.ts client/src/types.ts server/src/realtime.test.ts client/src/types.test.ts` → `git commit -m "feat(agent): add agent.card.thinking event type + boardId scoping"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-16-agent-live-thinking-stream/live-thinking.md — rule R-A, EC3 (boardId scoping)
server/src/realtime.ts — existing BoardEvent union + publishEvent fan-out (loose cast at routes.ts:141)
client/src/types.ts — existing AgentEvent union (already has columnSlug/token)

## WHY THIS APPROACH
Complexity: lightweight
Justification: Shared-interface prereq (event-driven pattern). Two files, type-only + serialization; anchors producer (T2/T3) and consumers (T4–T7) to one contract.

## SANDWICH CONTEXT
[CRITICAL: Do NOT add any new DB column or touch card_events — event is transport-only, thinking deltas are never persisted.]
You are implementing the shared agent event type for the live-thinking feature.
Spec: docs/pocket/spec/2026-06-16-agent-live-thinking-stream/live-thinking.md
Design decision: reuse existing SSE event pipeline; add one event type + boardId scoping.
Files in scope: server/src/realtime.ts, client/src/types.ts (+ their tests).
Available after: none (prereq)
Architecture rule: keep server (NodeNext, .js imports) and client types in sync; Biome tabs + double quotes.
[RESTATE: transport-only — no DB/schema/card_events changes.]

## DELIVERABLE
Given an `agent.card.thinking` event with columnSlug/token/boardId, When published, Then all fields survive serialization.
Given the client AgentEvent union, When a thinking event arrives, Then it type-checks with boardId present.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have: both unions include `agent.card.thinking`; `boardId` present on both; tests written first.
Must-not-have: DB/schema changes; touching card_events; behavior/streaming logic (that is T2/T3).
Open question risks: none.
Rollback note: revert commit removes the type.

## STOP CONDITIONS
Done when: tests green, both types extended, commit created.
Escalate when: a consumer needs a field not in this contract → update here first.

---

### Task 2: LLM extended thinking + live streaming (producer) [depends: T1]

## OBJECTIVE
Make `executeCard` request extended thinking for every card, stream thinking deltas + (on the tool path) output deltas live, with token budgets that prevent output truncation, while preserving signed thinking blocks across tool-loop turns.

Files:
- Modify: `server/src/agent/llm.ts`
- Test: `server/src/agent/llm.test.ts`

Steps:
1. Write failing tests (mock Anthropic stream):
   File: `server/src/agent/llm.test.ts`
   Tests verify:
   - Given executeCard called, When LLM invoked, Then request includes `thinking:{type:"enabled",budget_tokens:8192}` and `max_tokens:24576` (both single-shot and tools paths).
   - Given the stream emits `content_block_delta` with `delta.type==="thinking_delta"`, When streaming, Then `onThinking(text)` is called with the delta text.
   - Given the tools path streams `text_delta` across a turn, When streaming, Then `onToken` is called live during the turn (not only at the final turn).
   - Given thinking enabled + a tool_use turn, When the loop continues, Then the assistant message pushed back retains the `thinking` block (passback regression).
   - Given a long generation, Then output is not truncated by max_tokens (stop_reason !== "max_tokens" in the mocked happy path).

   ```ts
   // server/src/agent/llm.test.ts — ADD a new describe block.
   // Reuse the SAME module-level mocks already at the top of this file:
   //   mockStream (vi.fn), the @anthropic-ai/sdk vi.mock, makeTurn(), mockTool().
   // Do NOT redeclare them — these tests assume that existing scaffold.
   describe("executeCard extended thinking + live streaming", () => {
   	beforeEach(() => {
   		mockStream.mockReset();
   	});

   	it("requests thinking enabled with budget_tokens=8192 and max_tokens=24576 (single-shot)", async () => {
   		mockStream.mockReturnValueOnce({
   			[Symbol.asyncIterator]: async function* () {
   				yield {
   					type: "content_block_delta",
   					delta: { type: "text_delta", text: "out" },
   				};
   			},
   			finalMessage: vi.fn().mockResolvedValue({
   				stop_reason: "end_turn",
   				content: [{ type: "text", text: "out" }],
   			}),
   		});

   		const { executeCard } = await import("./llm.js");
   		await executeCard("prompt", "intent", [], false, vi.fn());

   		const args = mockStream.mock.calls[0][0];
   		expect(args.max_tokens).toBe(24576);
   		expect(args.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
   	});

   	it("requests thinking enabled + max_tokens=24576 on the tools path too", async () => {
   		mockStream.mockReturnValueOnce(
   			makeTurn({ text: "Final.", stopReason: "end_turn" }),
   		);
   		const { executeCard } = await import("./llm.js");
   		await executeCard(
   			"prompt",
   			"intent",
   			[],
   			false,
   			vi.fn(),
   			[mockTool(vi.fn(async () => ({ ok: true, content: "hit" })))],
   			3,
   			vi.fn(),
   		);

   		const args = mockStream.mock.calls[0][0];
   		expect(args.max_tokens).toBe(24576);
   		expect(args.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
   	});

   	it("calls onThinking with thinking_delta text while streaming", async () => {
   		mockStream.mockReturnValueOnce({
   			[Symbol.asyncIterator]: async function* () {
   				yield {
   					type: "content_block_delta",
   					delta: { type: "thinking_delta", thinking: "step 1" },
   				};
   				yield {
   					type: "content_block_delta",
   					delta: { type: "thinking_delta", thinking: " step 2" },
   				};
   				yield {
   					type: "content_block_delta",
   					delta: { type: "text_delta", text: "answer" },
   				};
   			},
   			finalMessage: vi.fn().mockResolvedValue({
   				stop_reason: "end_turn",
   				content: [{ type: "text", text: "answer" }],
   			}),
   		});

   		const { executeCard } = await import("./llm.js");
   		const onThinking = vi.fn();
   		// onThinking is the LAST positional arg (after onToolEvent).
   		await executeCard(
   			"prompt",
   			"intent",
   			[],
   			false,
   			vi.fn(),
   			[],
   			3,
   			undefined,
   			onThinking,
   		);

   		expect(onThinking).toHaveBeenCalledWith("step 1");
   		expect(onThinking).toHaveBeenCalledWith(" step 2");
   	});

   	it("streams tool-path text live via onToken DURING the turn, not only at the end", async () => {
   		// First turn: model emits text + a tool_use; that text must be streamed
   		// live via onToken (the delta), not buffered until the final turn.
   		mockStream
   			.mockReturnValueOnce(
   				makeTurn({
   					text: "searching now",
   					stopReason: "tool_use",
   					toolUse: { id: "tu_1", name: "web_search", input: { query: "x" } },
   				}),
   			)
   			.mockReturnValueOnce(
   				makeTurn({ text: "Final answer.", stopReason: "end_turn" }),
   			);

   		const execute = vi.fn(async () => ({ ok: true, content: "hit" }));
   		const onToken = vi.fn();
   		const { executeCard } = await import("./llm.js");

   		await executeCard(
   			"prompt",
   			"intent",
   			[],
   			false,
   			onToken,
   			[mockTool(execute)],
   			3,
   			vi.fn(),
   		);

   		// The first (tool_use) turn's text reached onToken live, not just the final turn.
   		expect(onToken).toHaveBeenCalledWith("searching now");
   		expect(onToken).toHaveBeenCalledWith("Final answer.");
   	});

   	it("passes the signed thinking block back unstripped on the next tool-loop turn (regression)", async () => {
   		// Turn 1 finalMessage carries a thinking block + a tool_use; the assistant
   		// message pushed for turn 2 must include that thinking block verbatim.
   		const turn1Content = [
   			{ type: "thinking", thinking: "signed reasoning", signature: "sig" },
   			{ type: "text", text: "calling tool" },
   			{ type: "tool_use", id: "tu_1", name: "web_search", input: { query: "x" } },
   		];
   		mockStream
   			.mockReturnValueOnce({
   				[Symbol.asyncIterator]: async function* () {
   					yield {
   						type: "content_block_delta",
   						delta: { type: "text_delta", text: "calling tool" },
   					};
   				},
   				finalMessage: vi
   					.fn()
   					.mockResolvedValue({ stop_reason: "tool_use", content: turn1Content }),
   			})
   			.mockReturnValueOnce(
   				makeTurn({ text: "Done.", stopReason: "end_turn" }),
   			);

   		const execute = vi.fn(async () => ({ ok: true, content: "hit" }));
   		const { executeCard } = await import("./llm.js");
   		await executeCard(
   			"prompt",
   			"intent",
   			[],
   			false,
   			vi.fn(),
   			[mockTool(execute)],
   			3,
   			vi.fn(),
   		);

   		// The SECOND stream call's messages must contain an assistant turn whose
   		// content still includes the signed thinking block (not stripped).
   		const secondCallMessages = mockStream.mock.calls[1][0].messages as Array<{
   			role: string;
   			content: unknown;
   		}>;
   		const assistantTurn = secondCallMessages.find(
   			(m) => m.role === "assistant",
   		);
   		expect(assistantTurn?.content).toEqual(turn1Content);
   		expect(
   			(assistantTurn?.content as Array<{ type: string }>).some(
   				(b) => b.type === "thinking",
   			),
   		).toBe(true);
   	});

   	it("does not truncate the happy-path output (stop_reason !== max_tokens)", async () => {
   		mockStream.mockReturnValueOnce({
   			[Symbol.asyncIterator]: async function* () {
   				yield {
   					type: "content_block_delta",
   					delta: { type: "text_delta", text: "a long report" },
   				};
   			},
   			finalMessage: vi.fn().mockResolvedValue({
   				stop_reason: "end_turn",
   				content: [{ type: "text", text: "a long report" }],
   			}),
   		});

   		const { executeCard } = await import("./llm.js");
   		const result = await executeCard("prompt", "intent", [], false, vi.fn());
   		// Budget asserts output headroom is preserved (OUTPUT_BUDGET=16384).
   		expect(mockStream.mock.calls[0][0].max_tokens).toBe(24576);
   		expect(result.output).toBe("a long report");
   	});
   });
   ```
2. Run — verify FAIL: `npx vitest run server/src/agent/llm.test.ts`.
3. Implement in `llm.ts`:
   - Add constants: `OUTPUT_BUDGET = 16384`, `THINKING_BUDGET = 8192`, `MAX_TOKENS = 24576` (= OUTPUT_BUDGET + THINKING_BUDGET).
   - Add `onThinking?: (text: string) => void` param to `executeCard`, `executeCardSingleShot`, `executeCardWithTools`.
   - In both `client.messages.stream({...})` calls: set `max_tokens: MAX_TOKENS` and `thinking: { type: "enabled", budget_tokens: THINKING_BUDGET }`.
   - In both for-await loops add: `if (event.type==="content_block_delta" && event.delta.type==="thinking_delta") onThinking?.(event.delta.thinking)`.
   - In `executeCardWithTools`: call `onToken(event.delta.text)` live on `text_delta` during each turn (remove final-turn-only buffering); keep `messages.push({role:"assistant", content: finalMessage.content})` UNCHANGED so signed thinking blocks pass back.
   - Wire `onThinking` through from `executeCard` to both inner functions.
4. Run — verify PASS: `npx vitest run server/src/agent/llm.test.ts`.
5. Commit: `git add server/src/agent/llm.ts server/src/agent/llm.test.ts` → `git commit -m "feat(agent): stream extended thinking + live tool-path output with budgeted max_tokens"`

## REFERENCES LOADED
spec — rules R-A, R-F (passback), Implementation Notes (token math), Open Questions (MiMo ceiling)
server/src/agent/llm.ts — executeCardSingleShot streams text_delta; executeCardWithTools buffers per-turn; thinking read from finalMessage
server/probe-mimo-thinking.mjs results — thinking_delta streams; budget_tokens optional on MiMo, required on native

## WHY THIS APPROACH
Complexity: deep
Justification: Single file but high judgment — two streaming paths, mocked SDK events, token-budget correctness, and a subtle passback invariant. Branching + regression risk.

## SANDWICH CONTEXT
[CRITICAL: Keep `messages.push({role:"assistant", content: finalMessage.content})` raw — stripping the signed thinking block breaks MiMo multi-turn (400 reasoning_content). max_tokens MUST be OUTPUT_BUDGET+THINKING_BUDGET so output headroom ≥16384 (anti-truncation, commit f24f292).]
You are implementing the LLM producer for live thinking.
Spec: docs/pocket/spec/2026-06-16-agent-live-thinking-stream/live-thinking.md
Design decision: thinking enabled for ALL columns (reasoning flag ignored).
Files in scope: server/src/agent/llm.ts (+ test).
Available after: T1 (event types).
Architecture rule: pure LLM layer (no DB/SSE here); NodeNext .js imports; Biome tabs.
[RESTATE: raw thinking-block passback + max_tokens=24576; never strip thinking, never let thinking starve output.]

## DELIVERABLE
Given any card executes, When LLM invoked, Then thinking enabled + budget_tokens=8192 + max_tokens=24576.
Given thinking_delta arrives, When streaming, Then onThinking called with text.
Given tools path, When a turn streams text, Then onToken called live during the turn.
[must-not] Given a tool-loop turn, When pushing assistant message, Then the thinking block must NOT be stripped.
Given long output, Then not truncated (stop_reason !== "max_tokens").

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have: thinking param + token constants; onThinking on both paths; live onToken on tool path; passback regression test; TDD order.
Must-not-have: persisting thinking deltas; touching service/SSE; setting `temperature` when thinking enabled (native guard).
Open question risks: MiMo may reject max_tokens=24576 → report NEEDS_CONTEXT and re-probe/clamp THINKING_BUDGET.
Rollback note: sending `thinking:{type:"disabled"}` reverts to no-thinking behavior.

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created.
Uncertain when: MiMo rejects token budget → NEEDS_CONTEXT.
Escalate when: passback test cannot pass without stripping thinking.

---

### Task 3: service.runPipeline SSE thinking events (producer) [depends: T1, T2]

## OBJECTIVE
Wire the new `onThinking` callback through `runPipeline` to publish batched `agent.card.thinking` SSE events (with columnSlug + boardId), and stamp `boardId` on the agent.card.* events — reusing the existing 200ms batching + flush-before-tool pattern.

Files:
- Modify: `server/src/agent/service.ts`
- Test: `server/src/agent/service.test.ts`

Steps:
1. Write failing tests (DI mocks for publishEvent/executeCard):
   File: `server/src/agent/service.test.ts`
   Tests verify:
   - Given executeCard invokes onThinking, When runPipeline runs, Then `agent.card.thinking` events publish with `columnSlug` + `boardId` + batched `token` text.
   - Given thinking + output buffers pending, When a tool event fires, Then both buffers flush before the tool event (ordering).
   - Given a card completes, Then published `agent.card.started/token/done` carry `boardId`.

   ```ts
   // server/src/agent/service.test.ts — ADD a new describe block.
   // Reuse the existing buildService() helper + DEFAULT_COLUMNS/DEFAULT_BOARD
   // and the vi.useFakeTimers() pattern already used by "runPipeline" tests.
   //
   // NOTE: executeCard's onThinking is the LAST positional arg (after onToolEvent)
   // per T2. The mock below drives it from that position.
   describe("runPipeline live thinking SSE", () => {
   	beforeEach(() => {
   		vi.useFakeTimers();
   	});
   	afterEach(() => {
   		vi.useRealTimers();
   	});

   	it("publishes batched agent.card.thinking with columnSlug + boardId", async () => {
   		const events: Array<Record<string, unknown>> = [];
   		const { service } = buildService({
   			publishEvent: vi.fn().mockImplementation(async (_wid, event) => {
   				events.push(event);
   			}),
   			getColumns: vi.fn().mockResolvedValue([
   				{
   					columnId: 10,
   					columnSlug: "research-specialist",
   					systemPrompt: "You are a researcher. Topic: {original_intent}",
   					reasoning: false,
   				},
   			] as ColumnInfo[]),
   			executeCard: vi
   				.fn()
   				.mockImplementation(
   					async (
   						_sys: string,
   						_intent: string,
   						_prev: string[],
   						_reasoning: boolean,
   						_onToken: (t: string) => void,
   						_tools: unknown[],
   						_budget: number,
   						_onToolEvent: unknown,
   						onThinking?: (t: string) => void,
   					) => {
   						onThinking?.("reason ");
   						onThinking?.("more");
   						return { output: "final output" };
   					},
   				),
   		});

   		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
   		await vi.runAllTimersAsync();
   		await promise;

   		const thinking = events.find((e) => e.type === "agent.card.thinking");
   		expect(thinking).toMatchObject({
   			type: "agent.card.thinking",
   			columnSlug: "research-specialist",
   			boardId: 1,
   		});
   		// Batched into the buffer (concatenated), not one event per call.
   		expect(String(thinking!.token)).toContain("reason ");
   		expect(String(thinking!.token)).toContain("more");
   	});

   	it("flushes pending thinking + token buffers BEFORE a tool event", async () => {
   		const events: Array<Record<string, unknown>> = [];
   		const { service } = buildService({
   			publishEvent: vi.fn().mockImplementation(async (_wid, event) => {
   				events.push(event);
   			}),
   			toolRegistry: {
   				resolveTools: vi.fn().mockReturnValue([
   					{
   						name: "web_search",
   						description: "Search",
   						inputSchema: { type: "object" },
   						riskTier: "read-only" as const,
   						execute: vi.fn(),
   					},
   				]),
   			},
   			getColumns: vi.fn().mockResolvedValue([
   				{
   					columnId: 10,
   					columnSlug: "research-specialist",
   					systemPrompt: "You are a researcher. Topic: {original_intent}",
   					reasoning: false,
   					tools: ["web_search"],
   					toolBudget: 3,
   				},
   			] as ColumnInfo[]),
   			executeCard: vi
   				.fn()
   				.mockImplementation(
   					async (
   						_sys: string,
   						_intent: string,
   						_prev: string[],
   						_reasoning: boolean,
   						onToken: (t: string) => void,
   						_tools: unknown[],
   						_budget: number,
   						onToolEvent: (e: { phase: string; toolName?: string }) => void,
   						onThinking?: (t: string) => void,
   					) => {
   						onThinking?.("thinking before tool");
   						onToken("token before tool");
   						onToolEvent({ phase: "started", toolName: "web_search" });
   						return { output: "final output" };
   					},
   				),
   		});

   		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
   		await vi.runAllTimersAsync();
   		await promise;

   		const thinkingIdx = events.findIndex(
   			(e) => e.type === "agent.card.thinking",
   		);
   		const tokenIdx = events.findIndex((e) => e.type === "agent.card.token");
   		const toolIdx = events.findIndex((e) => e.type === "agent.tool.started");

   		expect(thinkingIdx).toBeGreaterThanOrEqual(0);
   		expect(tokenIdx).toBeGreaterThanOrEqual(0);
   		expect(toolIdx).toBeGreaterThan(thinkingIdx);
   		expect(toolIdx).toBeGreaterThan(tokenIdx);
   	});

   	it("stamps boardId on agent.card.started / token / done events", async () => {
   		const events: Array<Record<string, unknown>> = [];
   		const { service } = buildService({
   			publishEvent: vi.fn().mockImplementation(async (_wid, event) => {
   				events.push(event);
   			}),
   			getColumns: vi.fn().mockResolvedValue([
   				{
   					columnId: 10,
   					columnSlug: "research-specialist",
   					systemPrompt: "You are a researcher. Topic: {original_intent}",
   					reasoning: false,
   				},
   			] as ColumnInfo[]),
   			executeCard: vi
   				.fn()
   				.mockImplementation(
   					async (
   						_sys: string,
   						_intent: string,
   						_prev: string[],
   						_reasoning: boolean,
   						onToken: (t: string) => void,
   					) => {
   						onToken("hello");
   						return { output: "final output" };
   					},
   				),
   		});

   		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
   		await vi.runAllTimersAsync();
   		await promise;

   		for (const type of [
   			"agent.card.started",
   			"agent.card.token",
   			"agent.card.done",
   		]) {
   			const ev = events.find((e) => e.type === type);
   			expect(ev, `expected ${type} present`).toBeDefined();
   			expect(ev!.boardId).toBe(1);
   		}
   	});
   });
   ```
2. Run — verify FAIL: `npx vitest run server/src/agent/service.test.ts`.
3. Implement in `service.ts` `runPipeline` (and mirror minimally in the shared helper if needed):
   - Add a separate `thinkingBuffer` with its own flush inside the existing `setInterval(200ms)` that publishes `{type:"agent.card.thinking", columnSlug, boardId, token: thinkingBuffer}`.
   - Pass an `onThinking` arg to `executeCard` that appends to `thinkingBuffer`.
   - In `onToolEvent`, flush `thinkingBuffer` (alongside the existing token flush) before emitting the tool event.
   - Add `boardId` to the published `agent.card.started/token/done/failed` payloads.
   - Clear the interval + final-flush thinkingBuffer on completion/catch (mirror token handling).
4. Run — verify PASS: `npx vitest run server/src/agent/service.test.ts`.
5. Commit: `git add server/src/agent/service.ts server/src/agent/service.test.ts` → `git commit -m "feat(agent): publish batched agent.card.thinking SSE with boardId"`

## REFERENCES LOADED
spec — rules R-A, R-C, EC3 (boardId), Implementation Notes (batching + flush order)
server/src/agent/service.ts — existing token buffer + setInterval(200ms) + onToolEvent flush; persistToolEvent reasoning path
server/src/agent/llm.ts (after T2) — executeCard now accepts onThinking

## WHY THIS APPROACH
Complexity: standard
Justification: Single file, but must mirror an established batching/flush pattern precisely and preserve ordering invariants; DI-mock testable.

## SANDWICH CONTEXT
[CRITICAL: agent output/thinking must publish via SSE only — never write card_events. Flush thinking+token buffers BEFORE tool events to preserve order.]
You are implementing the SSE producer for live thinking.
Spec: docs/pocket/spec/2026-06-16-agent-live-thinking-stream/live-thinking.md
Design decision: reuse 200ms batching; new event type from T1.
Files in scope: server/src/agent/service.ts (+ test).
Available after: T1 (event type), T2 (executeCard onThinking).
Architecture rule: DI deps only; publishEvent for SSE; do not touch triggerExecution legacy path.
[RESTATE: SSE-only, no card_events; flush-before-tool ordering.]

## DELIVERABLE
Given onThinking fires, When runPipeline runs, Then agent.card.thinking publishes with columnSlug+boardId, batched ~200ms.
Given pending buffers, When a tool event fires, Then thinking+token flush first.
Given a card lifecycle, Then agent.card.* events include boardId.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have: batched thinking events w/ columnSlug+boardId; flush-before-tool; boardId on card events; TDD order.
Must-not-have: card_events writes; persisting thinking; editing triggerExecution.
Open question risks: none new.
Rollback note: revert commit; thinking simply stops being published.

## STOP CONDITIONS
Done when: DELIVERABLE passes, tests green, commit created.
Escalate when: ordering invariant cannot hold with current buffer structure.

---

### Task 4: Client live-stream derive + content-source helpers (consumer) [depends: T1] [parallel: T2]

## OBJECTIVE
Pure functions that derive per-column live thinking/output from `agentEvents` scoped by `boardId`+`columnSlug`, and a selection rule "live if present, else DB" mirroring `pickToolTraceForColumn`.

Files:
- Create: `client/src/lib/agentStream.ts`
- Test: `client/src/lib/agentStream.test.ts`

Steps:
1. Write failing tests:
   File: `client/src/lib/agentStream.test.ts`
   Tests verify:
   - Given mixed agentEvents, When deriveThinkingForColumn(events, boardId, slug), Then it concatenates only `agent.card.thinking` tokens for that boardId+slug, in order.
   - Given deriveStreamedOutputForColumn(...), Then it concatenates only `agent.card.token` text for that boardId+slug.
   - Given an event missing columnSlug or boardId, Then it is dropped (no cross-column/cross-board bleed).
   - Given two boards reusing slug "analysis-specialist", Then derivation does not mix them.
   - Given pickContent(liveString, dbString): live non-empty → live; live empty → db.

   ```ts
   // client/src/lib/agentStream.test.ts — NEW FILE
   import { describe, expect, it } from "vitest";
   import type { AgentEvent } from "../types";
   import {
   	deriveStreamedOutputForColumn,
   	deriveThinkingForColumn,
   	pickContent,
   } from "./agentStream";

   describe("deriveThinkingForColumn", () => {
   	it("concatenates only agent.card.thinking tokens for the given board+slug, in order", () => {
   		const events = [
   			{
   				type: "agent.card.thinking",
   				boardId: 1,
   				columnSlug: "analysis-specialist",
   				token: "step 1 ",
   			},
   			{
   				type: "agent.card.token",
   				boardId: 1,
   				columnSlug: "analysis-specialist",
   				token: "OUTPUT not thinking",
   			},
   			{
   				type: "agent.card.thinking",
   				boardId: 1,
   				columnSlug: "analysis-specialist",
   				token: "step 2",
   			},
   		] as AgentEvent[];

   		expect(
   			deriveThinkingForColumn(events, 1, "analysis-specialist"),
   		).toBe("step 1 step 2");
   	});

   	it("drops events missing columnSlug or boardId (no cross-column/board bleed)", () => {
   		const events = [
   			{ type: "agent.card.thinking", token: "no slug no board" },
   			{ type: "agent.card.thinking", boardId: 1, token: "no slug" },
   			{
   				type: "agent.card.thinking",
   				columnSlug: "analysis-specialist",
   				token: "no board",
   			},
   			{
   				type: "agent.card.thinking",
   				boardId: 1,
   				columnSlug: "analysis-specialist",
   				token: "kept",
   			},
   		] as AgentEvent[];

   		expect(
   			deriveThinkingForColumn(events, 1, "analysis-specialist"),
   		).toBe("kept");
   	});

   	it("does not mix two boards that reuse the same slug", () => {
   		const events = [
   			{
   				type: "agent.card.thinking",
   				boardId: 1,
   				columnSlug: "analysis-specialist",
   				token: "board1 ",
   			},
   			{
   				type: "agent.card.thinking",
   				boardId: 2,
   				columnSlug: "analysis-specialist",
   				token: "board2",
   			},
   		] as AgentEvent[];

   		expect(deriveThinkingForColumn(events, 1, "analysis-specialist")).toBe(
   			"board1 ",
   		);
   		expect(deriveThinkingForColumn(events, 2, "analysis-specialist")).toBe(
   			"board2",
   		);
   	});
   });

   describe("deriveStreamedOutputForColumn", () => {
   	it("concatenates only agent.card.token text for the given board+slug", () => {
   		const events = [
   			{
   				type: "agent.card.thinking",
   				boardId: 1,
   				columnSlug: "research-specialist",
   				token: "thinking not output",
   			},
   			{
   				type: "agent.card.token",
   				boardId: 1,
   				columnSlug: "research-specialist",
   				token: "Hello ",
   			},
   			{
   				type: "agent.card.token",
   				boardId: 1,
   				columnSlug: "research-specialist",
   				token: "world",
   			},
   		] as AgentEvent[];

   		expect(
   			deriveStreamedOutputForColumn(events, 1, "research-specialist"),
   		).toBe("Hello world");
   	});
   });

   describe("pickContent", () => {
   	it("returns live when live is non-empty", () => {
   		expect(pickContent("live text", "db text")).toBe("live text");
   	});
   	it("returns db when live is empty", () => {
   		expect(pickContent("", "db text")).toBe("db text");
   	});
   });
   ```
2. Run — verify FAIL: `npx vitest run client/src/lib/agentStream.test.ts`.
3. Implement `agentStream.ts`: `deriveThinkingForColumn`, `deriveStreamedOutputForColumn` (filter by `e.type` + `e.boardId===boardId` + `e.columnSlug===slug`, concat token text), and `pickContent(live, db)` returning live if non-empty else db. Mirror style of `lib/toolTrace.ts`.
4. Run — verify PASS.
5. Commit: `git add client/src/lib/agentStream.ts client/src/lib/agentStream.test.ts` → `git commit -m "feat(agent): per-board live thinking/output derive + content-source helpers"`

## REFERENCES LOADED
spec — rules R-C, R-D, EC1 (live-else-DB), EC3 (boardId scoping)
client/src/lib/toolTrace.ts — deriveToolTrace + pickToolTraceForColumn (pattern to mirror)
client/src/types.ts (after T1) — AgentEvent with boardId

## WHY THIS APPROACH
Complexity: standard
Justification: Pure functions, highly testable, the keystone for all client rendering; isolating them keeps UI tasks thin.

## SANDWICH CONTEXT
[CRITICAL: Derivation MUST be scoped by boardId AND columnSlug — slug-only scoping causes cross-board bleed (EC3). Drop events missing either key.]
You are implementing client live-stream derivation helpers.
Spec: docs/pocket/spec/2026-06-16-agent-live-thinking-stream/live-thinking.md
Design decision: live-if-present-else-DB, mirror pickToolTraceForColumn.
Files in scope: client/src/lib/agentStream.ts (+ test).
Available after: T1 (AgentEvent.boardId).
Architecture rule: pure functions, no React/DOM; Biome tabs + double quotes.
[RESTATE: scope by boardId+columnSlug; drop unkeyed events.]

## DELIVERABLE
Given thinking events for a board+slug, Then derive concatenates them in order.
Given events for another board with same slug, Then they are excluded.
Given event missing boardId/columnSlug, Then dropped.
Given pickContent(live, db), Then live if non-empty else db.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have: boardId+slug scoping; ordered concat; pickContent rule; TDD order.
Must-not-have: any React import; reading from DB here (pure over events only).
Open question risks: none.
Rollback note: delete file (no other code depends until T5/T6).

## STOP CONDITIONS
Done when: DELIVERABLE passes, tests green, commit created.

---

### Task 5: Live-event lifecycle — accumulate + clear on switch/load (consumer) [depends: T1, T4]

## OBJECTIVE
Ensure `agent.card.thinking` accumulates in `agentEvents`, and clear `agentEvents` at the right lifecycle points to prevent cross-board pollution: on workspace switch (BoardContext) and on board load (AgentPage).

Files:
- Modify: `client/src/context/BoardContext.tsx`
- Modify: `client/src/pages/AgentPage.tsx`
- Test: `client/src/lib/agentStream.test.ts` (extend) — test an extracted pure predicate `shouldClearOnWorkspaceChange(prevId, nextId)`

Steps:
1. Write failing test for the extracted predicate:
   File: `client/src/lib/agentStream.test.ts`
   Test verifies: Given prev workspace 1 → next 2, Then shouldClearOnWorkspaceChange returns true; Given same id, Then false.

   ```ts
   // client/src/lib/agentStream.test.ts — APPEND to the file created in T4.
   // Add to the existing imports: shouldClearOnWorkspaceChange.
   describe("shouldClearOnWorkspaceChange", () => {
   	it("returns true when the workspace id changed", () => {
   		expect(shouldClearOnWorkspaceChange(1, 2)).toBe(true);
   	});
   	it("returns false when the workspace id is unchanged", () => {
   		expect(shouldClearOnWorkspaceChange(2, 2)).toBe(false);
   	});
   	it("returns false on the initial set (no previous id)", () => {
   		expect(shouldClearOnWorkspaceChange(null, 1)).toBe(false);
   	});
   });
   ```
2. Run — verify FAIL: `npx vitest run client/src/lib/agentStream.test.ts`.
3. Implement:
   - Add `shouldClearOnWorkspaceChange` to `agentStream.ts`; call `clearAgentEvents()` in BoardContext where `activeWorkspaceId` changes (using the predicate).
   - Confirm SSE handler already appends `agent.*` (it does) — no change needed beyond verifying thinking flows.
   - In `AgentPage` board-load effect, call `clearAgentEvents()` before/after fetching a board by id so stale live events from a previous board don't bleed.
4. Run — verify PASS; manual note: thinking events accumulate across a run (verified via service tests + integration).
5. Commit: `git add client/src/context/BoardContext.tsx client/src/pages/AgentPage.tsx client/src/lib/agentStream.ts client/src/lib/agentStream.test.ts` → `git commit -m "fix(agent): clear live agent events on workspace switch and board load"`

## REFERENCES LOADED
spec — EC3 (cross-board), rule R-C (accumulation)
client/src/context/BoardContext.tsx — agentEvents state + SSE handler (appends any agent.*) + clearAgentEvents + switchWorkspace
client/src/pages/AgentPage.tsx — board load effect (lines ~244-266)

## WHY THIS APPROACH
Complexity: standard
Justification: Two files, lifecycle wiring; the testable logic is extracted to a pure predicate to keep TDD honest despite provider/page being integration-heavy.

## SANDWICH CONTEXT
[CRITICAL: Clearing must happen so stale agentEvents from another board/workspace cannot be derived into the current board (EC3).]
You are implementing live-event lifecycle clearing.
Spec: docs/pocket/spec/2026-06-16-agent-live-thinking-stream/live-thinking.md
Design decision: per-board scoping + clear on switch/load.
Files in scope: client/src/context/BoardContext.tsx, client/src/pages/AgentPage.tsx, client/src/lib/agentStream.ts.
Available after: T1, T4.
Architecture rule: do not change unrelated BoardContext concerns (presence/metrics); Biome tabs.
[RESTATE: clear on switch + load to prevent cross-board bleed.]

## DELIVERABLE
Given workspace switch, Then agentEvents cleared (predicate true).
Given a board load, Then prior live events cleared.
Given a thinking event arrives, Then it is appended to agentEvents.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have: clear on switch + load; extracted predicate tested; TDD order.
Must-not-have: altering unrelated context state; removing existing clear points (create/approve/retry).
Open question risks: none.
Rollback note: revert commit restores prior (lossy cross-board) behavior.

## STOP CONDITIONS
Done when: DELIVERABLE passes, tests green, commit created.
Escalate when: clearing breaks the existing create/approve queue flow.

---

### Task 6: AgentCardDetail live render (consumer) [depends: T4, T5]

## OBJECTIVE
Render live thinking + output + tool activity in the existing panel using the T4 helpers (live-if-present-else-DB), with polite auto-follow, a corrected Extended Thinking badge, and distinct failed/empty states — no swap/flicker on done.

Files:
- Modify: `client/src/components/AgentCardDetail.tsx`
- Test: `client/src/components/AgentCardDetail.test.tsx`

Steps:
1. Write failing tests (jsdom, mirror ToolTrace.test.tsx):
   File: `client/src/components/AgentCardDetail.test.tsx`
   Tests verify:
   - Given live thinking events present for board+slug, When rendered, Then live thinking text shows (not the DB fetch).
   - Given no live events (empty), When rendered, Then it falls back to fetched DB output/thinking.
   - Given live output present, Then live output renders.
   - Given a column failed, Then a failed state shows (not generic empty).
   - Given the badge, Then it reflects thinking-enabled-for-all (not the stale column.reasoning ON/OFF).

   ```tsx
   // client/src/components/AgentCardDetail.test.tsx — NEW FILE (jsdom).
   // The component depends on useBoard() (context) and api (network); mock both
   // so the test exercises ONLY this component's live-vs-DB selection + states.
   import { render, screen, waitFor } from "@testing-library/react";
   import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
   import type { AgentColumn } from "../types";

   const mockUseBoard = vi.fn();
   vi.mock("../context/BoardContext", () => ({
   	useBoard: () => mockUseBoard(),
   }));

   const getAgentCardOutput = vi.fn();
   vi.mock("../api", () => ({
   	api: { getAgentCardOutput: (...a: unknown[]) => getAgentCardOutput(...a) },
   }));

   import AgentCardDetail from "./AgentCardDetail";

   const COLUMN: AgentColumn = {
   	id: 1,
   	slug: "analysis-specialist",
   	name: "Analysis",
   	position: 1,
   	reasoning: true,
   	systemPrompt: "You analyze.",
   	cards: [],
   };

   function setBoard(agentEvents: unknown[]) {
   	mockUseBoard.mockReturnValue({ activeWorkspaceId: 1, agentEvents });
   }

   beforeEach(() => {
   	getAgentCardOutput.mockReset();
   	mockUseBoard.mockReset();
   	getAgentCardOutput.mockResolvedValue({
   		columnSlug: "analysis-specialist",
   		output: "DB FINAL OUTPUT",
   		thinking: "DB FINAL THINKING",
   	});
   });
   afterEach(() => vi.clearAllMocks());

   describe("AgentCardDetail live-vs-DB selection", () => {
   	it("renders LIVE thinking when live events exist for board+slug (not DB)", async () => {
   		setBoard([
   			{
   				type: "agent.card.thinking",
   				boardId: 5,
   				columnSlug: "analysis-specialist",
   				token: "LIVE THINKING STREAM",
   			},
   		]);
   		render(<AgentCardDetail column={COLUMN} boardId={5} onClose={() => {}} />);
   		expect(await screen.findByText(/LIVE THINKING STREAM/)).toBeTruthy();
   		expect(screen.queryByText(/DB FINAL THINKING/)).toBeNull();
   	});

   	it("renders LIVE output when live token events exist", async () => {
   		setBoard([
   			{
   				type: "agent.card.token",
   				boardId: 5,
   				columnSlug: "analysis-specialist",
   				token: "LIVE OUTPUT STREAM",
   			},
   		]);
   		render(<AgentCardDetail column={COLUMN} boardId={5} onClose={() => {}} />);
   		expect(await screen.findByText(/LIVE OUTPUT STREAM/)).toBeTruthy();
   	});

   	it("falls back to DB output/thinking when no live events exist", async () => {
   		setBoard([]);
   		render(<AgentCardDetail column={COLUMN} boardId={5} onClose={() => {}} />);
   		await waitFor(() =>
   			expect(screen.getByText(/DB FINAL OUTPUT/)).toBeTruthy(),
   		);
   	});

   	it("shows a distinct failed state when the column failed (not generic empty)", async () => {
   		getAgentCardOutput.mockResolvedValue(null);
   		setBoard([
   			{
   				type: "agent.card.failed",
   				boardId: 5,
   				columnSlug: "analysis-specialist",
   				error: "LLM timeout",
   			},
   		]);
   		const { container } = render(
   			<AgentCardDetail column={COLUMN} boardId={5} onClose={() => {}} />,
   		);
   		await waitFor(() =>
   			expect(container.textContent?.toLowerCase()).toMatch(/fail|gagal/),
   		);
   	});

   	it("badge does not show a misleading OFF (thinking enabled for all columns)", async () => {
   		setBoard([]);
   		const offColumn = { ...COLUMN, reasoning: false };
   		const { container } = render(
   			<AgentCardDetail column={offColumn} boardId={5} onClose={() => {}} />,
   		);
   		await waitFor(() => expect(getAgentCardOutput).toHaveBeenCalled());
   		// The stale "OFF" badge must be gone — extended thinking is on for all.
   		expect(container.textContent).not.toContain("OFF");
   	});
   });
   ```
2. Run — verify FAIL: `npx vitest run client/src/components/AgentCardDetail.test.tsx`.
3. Implement in `AgentCardDetail.tsx`:
   - Use `deriveThinkingForColumn` / `deriveStreamedOutputForColumn` (board+slug) + `pickContent` to choose live-vs-DB for both thinking and output; only fetch/show DB when live is empty.
   - Keep existing markdown renderers (commit a248058) for both.
   - Auto-follow: scroll to bottom on new content, but pause when the user has scrolled up (track via scroll position; resume when back at bottom).
   - Replace/repair the "Extended Thinking: ON/OFF" badge so it isn't misleading (all columns enabled) — show "ON" or remove the OFF branch.
   - Add a failed-state message when the column failed (derive from agentEvents agent.card.failed for board+slug); pending/empty stays neutral.
   - Reuse existing live ToolTrace via `pickToolTraceForColumn` (already present).
4. Run — verify PASS.
5. Commit: `git add client/src/components/AgentCardDetail.tsx client/src/components/AgentCardDetail.test.tsx` → `git commit -m "feat(agent): live thinking/output in card panel with polite auto-follow"`

## REFERENCES LOADED
spec — rules R-B, R-D, R-E, EC1/EC4, UX Naturalness
client/src/components/AgentCardDetail.tsx — current panel (DB fetch effect, markdown renderers, ToolTrace, reasoning badge)
client/src/lib/agentStream.ts (T4) — derive + pickContent
docs/pocket/rule/creative-brief.md — colors/spacing for live sections

## WHY THIS APPROACH
Complexity: standard
Justification: One component but multiple behaviors (source selection, scroll UX, states, badge); jsdom-testable via helpers.

## SANDWICH CONTEXT
[CRITICAL: Content source is live-if-present-else-DB (EC1) — do NOT add a done-triggered swap/refetch; no flicker. Auto-follow must pause when user scrolls up.]
You are implementing the live panel render.
Spec: docs/pocket/spec/2026-06-16-agent-live-thinking-stream/live-thinking.md
Design decision: reuse AgentCardDetail; live-else-DB; no swap on done.
Files in scope: client/src/components/AgentCardDetail.tsx (+ test).
Available after: T4 (helpers), T5 (accumulation/clear).
Architecture rule: consult creative-brief.md for styling; Biome tabs; no localStorage.
[RESTATE: live-else-DB, no flicker, polite auto-follow.]

## DELIVERABLE
Given live thinking present, Then panel shows live thinking (not DB).
Given live empty (reload/reopen), Then panel shows DB final.
Given live output present, Then output streams live.
Given column failed, Then a distinct failed state shows.
Given badge, Then it is not misleading.
[UX] Given user scrolled up, When new content arrives, Then auto-follow pauses.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have: live-else-DB selection; polite auto-follow; failed state; corrected badge; TDD order; creative-brief styling.
Must-not-have: done-triggered swap/flicker; localStorage; new UI panel; touching card_events.
Open question risks: tool-path live vs DB content differs slightly — acceptable per spec.
Rollback note: revert commit returns to DB-only panel.

## STOP CONDITIONS
Done when: DELIVERABLE passes, tests green, commit created.
Escalate when: live-vs-DB selection needs server changes (it should not).

---

### Task 7: AgentBoardVisual clickable active/pending/failed columns (consumer) [depends: T6]

## OBJECTIVE
Make the in-progress (active), pending, and failed columns clickable to open the panel, with correct state derivation — an active column opens the live panel; a failed column is distinguished from a not-yet-run one.

Files:
- Modify: `client/src/pages/AgentPage.tsx` (AgentBoardVisual + state derivation)
- Test: `client/src/pages/agentBoardVisual.test.tsx` (extract pure derivation helper to test)

Steps:
1. Write failing tests for an extracted pure helper `deriveColumnState(agentEvents, boardId, slug, executionStatus)` → `"active" | "done" | "failed" | "pending"`:
   File: `client/src/pages/agentBoardVisual.test.tsx`
   Tests verify:
   - Given started without done/failed, Then "active".
   - Given done, Then "done".
   - Given failed for that slug, Then "failed" (NOT forced done by board executionStatus).
   - Given no events for slug while another runs, Then "pending".

   ```tsx
   // client/src/pages/agentBoardVisual.test.tsx — NEW FILE.
   // Tests ONLY the extracted pure helper (no DOM render needed). Export
   // deriveColumnState from AgentPage.tsx so it is unit-testable in isolation.
   import { describe, expect, it } from "vitest";
   import type { AgentEvent } from "../types";
   import { deriveColumnState } from "./AgentPage";

   const SLUG = "analysis-specialist";
   const BOARD = 5;

   function ev(
   	type: AgentEvent["type"],
   	columnSlug = SLUG,
   	boardId = BOARD,
   ): AgentEvent {
   	return { type, columnSlug, boardId } as AgentEvent;
   }

   describe("deriveColumnState", () => {
   	it("returns 'active' when started but not done/failed", () => {
   		expect(
   			deriveColumnState([ev("agent.card.started")], BOARD, SLUG, "running"),
   		).toBe("active");
   	});

   	it("returns 'done' when the column emitted agent.card.done", () => {
   		expect(
   			deriveColumnState(
   				[ev("agent.card.started"), ev("agent.card.done")],
   				BOARD,
   				SLUG,
   				"running",
   			),
   		).toBe("done");
   	});

   	it("returns 'failed' for a failed column even when board executionStatus is 'done'", () => {
   		expect(
   			deriveColumnState(
   				[ev("agent.card.started"), ev("agent.card.failed")],
   				BOARD,
   				SLUG,
   				"done",
   			),
   		).toBe("failed");
   	});

   	it("returns 'pending' when no events exist for this slug while another column runs", () => {
   		const eventsForOther = [
   			ev("agent.card.started", "research-specialist"),
   		];
   		expect(
   			deriveColumnState(eventsForOther, BOARD, SLUG, "running"),
   		).toBe("pending");
   	});

   	it("does not bleed across boards (same slug, different boardId)", () => {
   		const otherBoard = [ev("agent.card.started", SLUG, 99)];
   		expect(deriveColumnState(otherBoard, BOARD, SLUG, "running")).toBe(
   			"pending",
   		);
   	});
   });
   ```
2. Run — verify FAIL: `npx vitest run client/src/pages/agentBoardVisual.test.tsx`.
3. Implement:
   - Extract `deriveColumnState` (pure) and use it in `AgentBoardVisual`; do not force `isDone` for all columns when `executionStatus==="done"` if that column failed.
   - Make active, pending, and failed columns clickable (onClick → onCardClick(col)) with appropriate affordance; keep done clickable.
   - Active shows LoadingCamel + remains clickable; failed shows a failed affordance; pending shows neutral.
4. Run — verify PASS.
5. Commit: `git add client/src/pages/AgentPage.tsx client/src/pages/agentBoardVisual.test.tsx` → `git commit -m "feat(agent): clickable active/pending/failed columns during execution"`

## REFERENCES LOADED
spec — rules R-B, R-E, EC4
client/src/pages/AgentPage.tsx — AgentBoardVisual (isDone/isActive derivation, line ~143; only done clickable)
client/src/lib/agentStream.ts (T4) — boardId-scoped helpers if needed

## WHY THIS APPROACH
Complexity: standard
Justification: One file; the risky part (state derivation incl. failed-vs-done) is extracted to a pure tested helper; the rest is clickability wiring.

## SANDWICH CONTEXT
[CRITICAL: Do NOT force every column to isDone when board executionStatus==="done" — a failed/not-run column must derive its own state (EC4).]
You are implementing clickable in-progress columns.
Spec: docs/pocket/spec/2026-06-16-agent-live-thinking-stream/live-thinking.md
Design decision: reuse panel; distinct failed vs pending.
Files in scope: client/src/pages/AgentPage.tsx (+ test).
Available after: T6 (panel handles the states it opens into).
Architecture rule: consult creative-brief.md for affordances; Biome tabs; no out-of-scope files.
[RESTATE: per-column state derivation; never blanket-done; active is clickable.]

## DELIVERABLE
Given a column is active, When clicked, Then the live panel opens.
Given a column failed, Then it shows a failed affordance and opens a failed state.
Given a pending column, Then neutral + clickable to a neutral panel.
Given done, Then unchanged.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have: active/pending/failed clickable; deriveColumnState tested; failed≠done; TDD order; creative-brief affordances.
Must-not-have: blanket isDone; touching card_events; chat re-enable.
Open question risks: none.
Rollback note: revert commit returns to done-only clickable.

## STOP CONDITIONS
Done when: DELIVERABLE passes, tests green, commit created.
Escalate when: state derivation needs data not present in agentEvents/board.

---

### Task 8: Opt-in live-LLM thinking integration check [depends: T2, T3] [opt-in: RUN_LLM_IT]

## OBJECTIVE
Add ONE opt-in assertion to the existing gated integration suite that, against a real MiMo endpoint, verifies the two assumptions-at-risk that no mock can prove: (a) MiMo accepts `max_tokens=24576` + `thinking:{type:"enabled",budget_tokens:8192}` without a 4xx, and (b) `onThinking` actually fires (live `thinking_delta` streams) and surfaces as an `agent.card.thinking` SSE event with `columnSlug`+`boardId`. This is the only test that spans `llm.ts` (real stream) + `service.ts` (real SSE wiring) end-to-end.

Files:
- Modify: `server/src/agent/pipeline.integration.test.ts` (add one `it` inside the existing `describe.skipIf(!process.env.RUN_LLM_IT)` block)

Steps:
1. Write failing test (extends existing gated suite — uses the REAL `executeCard` already imported as `realExecuteCard`, captures published events):
   File: `server/src/agent/pipeline.integration.test.ts`
   Test verifies: Given `RUN_LLM_IT=1` + real MiMo, When `runPipeline` runs one card, Then at least one `agent.card.thinking` event is published with `columnSlug`+`boardId`, AND the run completes without an `agent.card.failed` caused by a token-budget 4xx.

   ```ts
   // server/src/agent/pipeline.integration.test.ts — ADD inside the existing
   // describe.skipIf(!process.env.RUN_LLM_IT)(...) block. Reuse realExecuteCard,
   // mockColumns, and createAgentBoardService already in this file.
   it("streams live thinking end-to-end and accepts max_tokens=24576 (opt-in)", async () => {
   	const events: Array<Record<string, unknown>> = [];
   	const service = createAgentBoardService({
   		getBoard: vi.fn(async () => ({
   			id: 1,
   			workspaceId: 1,
   			userId: 1,
   			templateId: "research-report",
   			originalIntent: INTENT,
   			status: "approved",
   			executionStatus: "running",
   		})),
   		getColumns: vi.fn(async () => [mockColumns[0]]),
   		executeCard: realExecuteCard,
   		insertOutput: vi.fn(async () => {}),
   		insertCard: vi.fn(async () => {}),
   		updateBoard: vi.fn(async () => {}),
   		publishEvent: vi.fn(async (_wid: number, e: Record<string, unknown>) => {
   			events.push(e);
   		}),
   	});

   	await service.runPipeline({ boardId: 1, workspaceId: 1 });

   	// (a) No budget-rejection failure: a 4xx on max_tokens=24576 would surface here.
   	const failed = events.find((e) => e.type === "agent.card.failed");
   	expect(failed, JSON.stringify(failed)).toBeUndefined();

   	// (b) Live thinking actually streamed and was scoped correctly.
   	const thinking = events.filter((e) => e.type === "agent.card.thinking");
   	expect(thinking.length).toBeGreaterThan(0);
   	expect(thinking[0]).toMatchObject({
   		columnSlug: mockColumns[0].columnSlug,
   		boardId: 1,
   	});
   }, 900_000);
   ```
2. Run — verify it SKIPS by default (no key needed): `npx vitest run server/src/agent/pipeline.integration.test.ts` (the `describe.skipIf` keeps it dormant). Verify FAIL only when opted in: `RUN_LLM_IT=1 npm run test:integration --workspace=server` (fails until T2/T3 land).
3. Implement: none — this task depends on T2 (`max_tokens`/`onThinking` in `llm.ts`) and T3 (`agent.card.thinking` SSE with boardId in `service.ts`). The test passes once both are merged.
4. Run — verify PASS (opt-in): `RUN_LLM_IT=1 npm run test:integration --workspace=server`.
5. Commit: `git add server/src/agent/pipeline.integration.test.ts` → `git commit -m "test(agent): opt-in integration check for live thinking + max_tokens=24576"`

## REFERENCES LOADED
spec — Open Questions (MiMo ceiling 24576), rules R-A, R-C, R-F
server/src/agent/pipeline.integration.test.ts — existing gated suite + realExecuteCard import + mockColumns

## WHY THIS APPROACH
Complexity: lightweight
Justification: A single opt-in assertion in an already-gated file. It is the ONLY test that can validate the live MiMo assumptions (token ceiling + real thinking_delta streaming); unit tests mock the SDK and cannot. Stays dormant in CI without keys.

## SANDWICH CONTEXT
[CRITICAL: Must remain gated behind RUN_LLM_IT — never run by default, never require keys in CI. Reuse the existing describe.skipIf block; do not add a new always-on test.]
You are adding an opt-in cross-unit integration check for live thinking.
Spec: docs/pocket/spec/2026-06-16-agent-live-thinking-stream/live-thinking.md
Design decision: validate the two live-only assumptions (max_tokens ceiling + thinking_delta streaming) end-to-end.
Files in scope: server/src/agent/pipeline.integration.test.ts only.
Available after: T2, T3.
Architecture rule: gated by RUN_LLM_IT; NodeNext .js imports; Biome tabs.
[RESTATE: opt-in only; no default-CI live calls.]

## DELIVERABLE
Given RUN_LLM_IT + real MiMo, When runPipeline runs a card, Then ≥1 agent.card.thinking is published with columnSlug+boardId and no budget-4xx agent.card.failed occurs.
Given no RUN_LLM_IT, Then the test is skipped.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have: gated behind RUN_LLM_IT; asserts thinking event + boardId; asserts no budget failure; TDD order.
Must-not-have: any default-CI live API call; new mocks of the SDK here (use the real one); duplicating T2/T3 unit coverage.
Open question risks: MiMo rejects max_tokens=24576 → this test is exactly what surfaces it → NEEDS_CONTEXT, re-probe/clamp THINKING_BUDGET.
Rollback note: delete the added `it` block.

## STOP CONDITIONS
Done when: skips by default; passes opt-in after T2+T3; commit created.
Escalate when: MiMo returns 4xx on max_tokens=24576 → clamp THINKING_BUDGET and re-probe before merge.

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|------------------|
| T1 | Shared agent event types (thinking + boardId) | prereq | lightweight | thinking event + boardId survive serialization |
| T2 | LLM extended thinking + live streaming | T1 | deep | thinking param + max_tokens=24576; onThinking; live tool-path output; thinking passback preserved |
| T3 | service.runPipeline SSE thinking events | T1, T2 | standard | batched agent.card.thinking w/ columnSlug+boardId; flush before tool |
| T4 | Client derive + content-source helpers | T1 (∥T2) | standard | per-board derive; live-else-DB pickContent |
| T5 | Live-event lifecycle (accumulate + clear) | T1, T4 | standard | clear on switch + board load |
| T6 | AgentCardDetail live render | T4, T5 | standard | live-else-DB; polite auto-follow; failed state; badge |
| T7 | AgentBoardVisual clickable active/pending/failed | T6 | standard | active clickable; failed≠done derivation |
| T8 | Opt-in live-LLM thinking integration check | T2, T3 | lightweight | (opt-in RUN_LLM_IT) real MiMo accepts max_tokens=24576; live agent.card.thinking w/ boardId |
