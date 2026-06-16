# Agent Live Thinking Stream + Clickable Active Column — service.runPipeline SSE thinking events (producer) (Phase 2 of 3)

**Date:** 2026-06-16
**Original plan:** /Users/rfxlamia/project/kanban/docs/pocket/plans/2026-06-16-agent-live-thinking-stream/execution-plan.md
**Prerequisite:** Phase 1 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T3, T5, T6, T8}
**Unlocks next:** Phase 3

---

## Task List

Total: 4 tasks | Prerequisite phases must be complete before starting

T3: service.runPipeline SSE thinking events (producer) [depends: T1, T2]
T5: Live-event lifecycle — accumulate + clear on switch/load (consumer) [depends: T1, T4]
T6: AgentCardDetail live render (consumer) [depends: T4, T5]
T8: Opt-in live-LLM thinking integration check [depends: T2, T3] [opt-in: RUN_LLM_IT]

---

## Pocket Packets

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

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 3 ONLY after this gate passes.
