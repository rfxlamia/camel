# Agent Live Thinking Stream + Clickable Active Column — Shared agent event types (thinking + boardId) (Phase 1 of 3)

**Date:** 2026-06-16
**Original plan:** /Users/rfxlamia/project/kanban/docs/pocket/plans/2026-06-16-agent-live-thinking-stream/execution-plan.md
**Prerequisite:** None (first phase)
**Contains tasks:** {T1, T2, T4}
**Unlocks next:** Phase 2

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

T1: Shared agent event types (thinking + boardId) [prereq]
T2: LLM extended thinking + live streaming (producer) [depends: T1]
T4: Client live-stream derive + content-source helpers (consumer) [depends: T1] [parallel: T2]

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

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 2 ONLY after this gate passes.
