import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { getHumanColumns } from "../routes.js";
import { createAgentBoardService } from "./service.js";
import type { AgentBoardServiceDeps, ColumnInfo } from "./service.js";

// ---- T1 scaffold: board isolation ----

describe("board isolation", () => {
	it("getHumanColumns filters agent columns via board_id IS NULL", async () => {
		const calls: string[] = [];
		const fakeDb = {
			query: vi.fn(async (sql: string, _params: unknown[]) => {
				calls.push(sql);
				return { rows: [] };
			}),
		};

		await getHumanColumns(fakeDb as any, 1);

		expect(fakeDb.query).toHaveBeenCalledWith(expect.any(String), [1]);
		expect(calls[0]).toMatch(/board_id IS NULL/i);
		expect(calls[0]).not.toMatch(/board_id IS NOT NULL/i);
	});
});

// ---- T3: Agent Board Service ----

describe("intent classification", () => {
	it("returns 422 when LLM cannot match intent to template", async () => {
		const service = createAgentBoardService({
			classifyIntent: vi.fn(async () => ({
				templateId: null,
				explanation: "This request isn't supported yet.",
			})),
			insertBoard: vi.fn(),
			insertConversation: vi.fn(),
			insertColumns: vi.fn(),
			publishEvent: vi.fn(),
		});
		const result = await service.createBoard({
			workspaceId: 1,
			userId: 1,
			intent: "build a rocket",
		});
		expect(result).toMatchObject({
			status: 422,
			message: expect.stringContaining("supported"),
		});
	});

	it("creates board with pending status on successful classification", async () => {
		const insertBoard = vi.fn(async () => ({ id: 42 }));
		const insertConversation = vi.fn(async () => {});
		const service = createAgentBoardService({
			classifyIntent: vi.fn(async () => ({
				templateId: "research-report",
				explanation: "I made a Research & Report board for you.",
			})),
			insertBoard,
			insertConversation,
			insertColumns: vi.fn(async () => {}),
			publishEvent: vi.fn(),
		});
		const result = await service.createBoard({
			workspaceId: 1,
			userId: 1,
			intent: "riset kompetitor fintech",
		});
		expect(result).toMatchObject({
			boardId: 42,
			explanation: expect.any(String),
		});
		expect(insertBoard).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: 1,
				userId: 1,
				status: "pending",
			}),
		);
	});
});

describe("approval", () => {
	it("sets status=approved and execution_status=running on approve", async () => {
		const updateBoard = vi.fn(async () => {});
		const publishEvent = vi.fn(async () => {});
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "pending",
				workspaceId: 1,
				userId: 1,
				originalIntent: "riset",
			})),
			updateBoard,
			publishEvent,
		});
		await service.approveBoard({ boardId: 1, userId: 1, workspaceId: 1 });
		expect(updateBoard).toHaveBeenCalledWith(1, {
			status: "approved",
			execution_status: "running",
		});
	});

	it("returns 403 when user tries to approve board they do not own", async () => {
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "pending",
				workspaceId: 1,
				userId: 99,
				originalIntent: "riset",
			})),
		});
		const result = await service.approveBoard({
			boardId: 1,
			userId: 1,
			workspaceId: 1,
		});
		expect(result).toMatchObject({ status: 403 });
	});

	it("returns 409 when board is already approved", async () => {
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "approved",
				workspaceId: 1,
				userId: 1,
				originalIntent: "riset",
			})),
		});
		const result = await service.approveBoard({
			boardId: 1,
			userId: 1,
			workspaceId: 1,
		});
		expect(result).toMatchObject({ status: 409 });
	});
});

describe("triggerExecution", () => {
	it("creates a card in the cards table after inserting output", async () => {
		const insertCard = vi.fn(async () => {});
		const insertOutput = vi.fn(async () => {});
		const service = createAgentBoardService({
			executeCard: vi.fn(async (_sys, _intent, _prev, _reasoning, onToken) => {
				onToken("hello");
				return { output: "Research output here", thinking: undefined };
			}),
			insertOutput,
			insertCard,
			updateBoard: vi.fn(async () => {}),
			publishEvent: vi.fn(async () => {}),
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "approved",
				workspaceId: 1,
				userId: 1,
				originalIntent: "riset",
			})),
			getFirstCard: vi.fn(async () => ({
				columnId: 10,
				columnSlug: "research-specialist",
				systemPrompt: "You are a Research Specialist...",
				reasoning: false,
			})),
		});
		await service.triggerExecution({ boardId: 1, workspaceId: 1 });
		expect(insertCard).toHaveBeenCalledWith(
			expect.objectContaining({ columnId: 10, workspaceId: 1 }),
		);
	});

	it("calls executeCard, persists output, publishes done event", async () => {
		const insertOutput = vi.fn(async () => {});
		const insertCard = vi.fn(async () => {});
		const updateBoard = vi.fn(async () => {});
		const publishEvent = vi.fn(async () => {});
		const executeCard = vi.fn(
			async (
				_sys: string,
				_intent: string,
				_prev: string[],
				_reasoning: boolean,
				onToken: (token: string) => void,
			) => {
				onToken("hello");
				return { output: "Research output here", thinking: undefined };
			},
		);
		const service = createAgentBoardService({
			executeCard,
			insertOutput,
			insertCard,
			updateBoard,
			publishEvent,
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "approved",
				workspaceId: 1,
				userId: 1,
				originalIntent: "riset kompetitor fintech lokal",
			})),
			getFirstCard: vi.fn(async () => ({
				columnId: 10,
				columnSlug: "research-specialist",
				systemPrompt: "You are a Research Specialist...",
				reasoning: false,
			})),
		});
		await service.triggerExecution({ boardId: 1, workspaceId: 1 });

		expect(publishEvent).toHaveBeenCalledWith(
			1,
			expect.objectContaining({ type: "agent.card.started" }),
		);
		expect(executeCard).toHaveBeenCalledWith(
			expect.any(String),
			"riset kompetitor fintech lokal",
			[],
			false,
			expect.any(Function),
			expect.any(Array),
			expect.any(Number),
			expect.any(Function),
		);
		expect(insertOutput).toHaveBeenCalledWith(
			expect.objectContaining({
				boardId: 1,
				columnSlug: "research-specialist",
				cardIndex: 0,
				output: "Research output here",
			}),
		);
		expect(updateBoard).toHaveBeenCalledWith(1, { execution_status: "done" });
		expect(publishEvent).toHaveBeenCalledWith(
			1,
			expect.objectContaining({ type: "agent.card.done" }),
		);
	});

	it("sets execution_status=failed and publishes failed event on LLM error", async () => {
		const updateBoard = vi.fn(async () => {});
		const publishEvent = vi.fn(async () => {});
		const service = createAgentBoardService({
			executeCard: vi.fn(async () => {
				throw new Error("LLM timeout");
			}),
			updateBoard,
			publishEvent,
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "approved",
				workspaceId: 1,
				userId: 1,
				originalIntent: "riset",
			})),
			getFirstCard: vi.fn(async () => ({
				columnId: 10,
				columnSlug: "research-specialist",
				systemPrompt: "You are...",
				reasoning: false,
			})),
			insertOutput: vi.fn(),
			insertCard: vi.fn(),
		});
		await service.triggerExecution({ boardId: 1, workspaceId: 1 });

		expect(updateBoard).toHaveBeenCalledWith(1, { execution_status: "failed" });
		expect(publishEvent).toHaveBeenCalledWith(
			1,
			expect.objectContaining({ type: "agent.card.failed" }),
		);
	});
});

describe("card output retrieval", () => {
	it("getCardOutput returns stored output for columnSlug", async () => {
		const getOutput = vi.fn(async () => ({
			output: "Research output",
			thinking: null,
		}));
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "approved",
				workspaceId: 1,
				userId: 1,
				originalIntent: "riset",
			})),
			getOutput,
		});
		const result = await service.getCardOutput({
			boardId: 1,
			columnSlug: "research-specialist",
			workspaceId: 1,
		});
		expect(result).toMatchObject({ output: "Research output" });
	});

	it("getCardOutput returns 404 when no output exists", async () => {
		const getOutput = vi.fn(async () => null);
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "approved",
				workspaceId: 1,
				userId: 1,
				originalIntent: "riset",
			})),
			getOutput,
		});
		const result = await service.getCardOutput({
			boardId: 1,
			columnSlug: "research-specialist",
			workspaceId: 1,
		});
		expect(result).toMatchObject({ status: 404 });
	});

	it("getCardOutput returns 404 (no leak) when board belongs to another workspace", async () => {
		// Regression: cross-workspace data leakage. A member of workspace 1
		// must NOT read agent outputs for a board owned by workspace 2, even
		// if output rows exist for that board_id + column_slug.
		const getOutput = vi.fn(async () => ({
			output: "secret cross-workspace output",
			thinking: null,
		}));
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "approved",
				workspaceId: 2, // board lives in a DIFFERENT workspace
				userId: 1,
				originalIntent: "riset",
			})),
			getOutput,
		});
		const result = await service.getCardOutput({
			boardId: 1,
			columnSlug: "research-specialist",
			workspaceId: 1, // caller is in workspace 1
		});
		expect(result).toMatchObject({ status: 404 });
		expect(result).not.toHaveProperty("output");
		// Must not even query the output store once ownership fails.
		expect(getOutput).not.toHaveBeenCalled();
	});

	it("getCardOutput returns 404 when board does not exist", async () => {
		const getOutput = vi.fn(async () => ({ output: "x", thinking: null }));
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => null),
			getOutput,
		});
		const result = await service.getCardOutput({
			boardId: 999,
			columnSlug: "research-specialist",
			workspaceId: 1,
		});
		expect(result).toMatchObject({ status: 404 });
		expect(getOutput).not.toHaveBeenCalled();
	});
});

describe("sendMessage", () => {
	it("stores user message and returns clarification question for pending board", async () => {
		const insertConversation = vi.fn(async () => {});
		const generateClarificationQuestion = vi.fn(
			async () => "What specific competitors?",
		);
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "pending",
				workspaceId: 1,
				userId: 1,
				originalIntent: "riset",
			})),
			insertConversation,
			generateClarificationQuestion,
		});
		const result = await service.sendMessage({
			boardId: 1,
			userId: 1,
			workspaceId: 1,
			message: "fintech lokal",
		});
		expect(insertConversation).toHaveBeenCalledWith({
			boardId: 1,
			role: "user",
			content: "fintech lokal",
		});
		expect(result).toMatchObject({
			explanation: "What specific competitors?",
			boardUpdated: false,
		});
	});

	it("returns 403 when user does not own board", async () => {
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "pending",
				workspaceId: 1,
				userId: 99,
				originalIntent: "riset",
			})),
		});
		const result = await service.sendMessage({
			boardId: 1,
			userId: 1,
			workspaceId: 1,
			message: "hi",
		});
		expect(result).toMatchObject({ status: 403 });
	});

	it("returns 404 when board belongs to another workspace", async () => {
		// Regression: workspace isolation — a board in workspace 2 must not be
		// reachable via a workspace-1-scoped request, even by its owner.
		const insertConversation = vi.fn(async () => {});
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "pending",
				workspaceId: 2, // board lives in a DIFFERENT workspace
				userId: 1,
				originalIntent: "riset",
			})),
			insertConversation,
		});
		const result = await service.sendMessage({
			boardId: 1,
			userId: 1,
			workspaceId: 1, // caller is in workspace 1
			message: "hi",
		});
		expect(result).toMatchObject({ status: 404 });
		expect(insertConversation).not.toHaveBeenCalled();
	});
});

describe("getBoards", () => {
	it("returns list of boards for workspace", async () => {
		const listBoards = vi.fn(async () => [
			{
				id: 2,
				originalIntent: "analisis pasar",
				templateId: "research-report",
				status: "approved",
				executionStatus: "done",
				createdAt: "2026-06-14T11:00:00Z",
			},
			{
				id: 1,
				originalIntent: "riset fintech",
				templateId: "research-report",
				status: "approved",
				executionStatus: "done",
				createdAt: "2026-06-14T10:00:00Z",
			},
		]);
		const service = createAgentBoardService({ listBoards });
		const result = await service.getBoards({ workspaceId: 1 });
		expect(result).toHaveLength(2);
		expect(listBoards).toHaveBeenCalledWith(1);
	});
});

// ---------------------------------------------------------------------------
// runPipeline — Phase 2 sequential loop
// ---------------------------------------------------------------------------

const DEFAULT_COLUMNS: ColumnInfo[] = [
	{
		columnId: 10,
		columnSlug: "research-specialist",
		systemPrompt: "You are a researcher. Topic: {original_intent}",
		reasoning: false,
	},
	{
		columnId: 20,
		columnSlug: "analysis-specialist",
		systemPrompt: "Analyze this. Previous: {previous_output}",
		reasoning: false,
	},
];

const DEFAULT_BOARD = {
	id: 1,
	workspaceId: 1,
	userId: 1,
	templateId: "research-report",
	originalIntent: "Test intent",
	status: "approved",
	executionStatus: "running",
};

function buildService(overrides: Partial<AgentBoardServiceDeps> = {}) {
	const deps: AgentBoardServiceDeps = {
		getBoard: vi.fn().mockResolvedValue(DEFAULT_BOARD),
		getColumns: vi.fn().mockResolvedValue(DEFAULT_COLUMNS),
		executeCard: vi.fn().mockResolvedValue({ output: "mock output text" }),
		insertOutput: vi.fn().mockResolvedValue(undefined),
		insertCard: vi.fn().mockResolvedValue(undefined),
		updateBoard: vi.fn().mockResolvedValue(undefined),
		publishEvent: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
	return { service: createAgentBoardService(deps), deps };
}

describe("runPipeline", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("happy path: executeCard called once per column in order, insertOutput called with correct cardIndex, updateBoard called with done", async () => {
		const { service, deps } = buildService();

		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
		await vi.runAllTimersAsync();
		await promise;

		expect(deps.executeCard).toHaveBeenCalledTimes(2);

		const firstCall = (deps.executeCard as ReturnType<typeof vi.fn>).mock
			.calls[0];
		const secondCall = (deps.executeCard as ReturnType<typeof vi.fn>).mock
			.calls[1];
		expect(firstCall[0]).toContain("researcher");
		expect(secondCall[0]).toContain("Analyze");

		expect(deps.insertOutput).toHaveBeenCalledTimes(2);
		const insertCalls = (deps.insertOutput as ReturnType<typeof vi.fn>).mock
			.calls;
		expect(insertCalls[0][0]).toMatchObject({
			cardIndex: 0,
			columnSlug: "research-specialist",
		});
		expect(insertCalls[1][0]).toMatchObject({
			cardIndex: 1,
			columnSlug: "analysis-specialist",
		});

		expect(deps.updateBoard).toHaveBeenCalledWith(1, {
			execution_status: "done",
		});
	});

	it("named resolution: second card systemPrompt has {previous_output} replaced with first card output", async () => {
		const { service, deps } = buildService({
			executeCard: vi.fn().mockResolvedValue({ output: "first card result" }),
		});

		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
		await vi.runAllTimersAsync();
		await promise;

		const secondCallSystemPrompt = (
			deps.executeCard as ReturnType<typeof vi.fn>
		).mock.calls[1][0] as string;
		expect(secondCallSystemPrompt).not.toMatch(/\{previous_output\}/);
		expect(secondCallSystemPrompt).toContain("first card result");
	});

	it("SSE: agent.card.started emitted before executeCard, agent.card.done emitted after insertOutput for each card", async () => {
		const events: Array<Record<string, unknown>> = [];

		const { service } = buildService({
			publishEvent: vi.fn().mockImplementation(async (_wid, event) => {
				events.push(event);
			}),
			executeCard: vi.fn().mockImplementation(async () => {
				return { output: "mock output" };
			}),
			insertOutput: vi.fn().mockImplementation(async () => {}),
		});

		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
		await vi.runAllTimersAsync();
		await promise;

		expect(events[0]).toMatchObject({
			type: "agent.card.started",
			columnSlug: "research-specialist",
		});

		const firstDoneIdx = events.findIndex(
			(e) =>
				e.type === "agent.card.done" && e.columnSlug === "research-specialist",
		);
		expect(firstDoneIdx).toBeGreaterThan(0);

		const secondStartIdx = events.findIndex(
			(e) =>
				e.type === "agent.card.started" &&
				e.columnSlug === "analysis-specialist",
		);
		expect(secondStartIdx).toBeGreaterThan(firstDoneIdx);

		const secondDoneIdx = events.findIndex(
			(e) =>
				e.type === "agent.card.done" && e.columnSlug === "analysis-specialist",
		);
		expect(secondDoneIdx).toBeGreaterThan(secondStartIdx);
	});

	it("fail-closed — unresolved placeholder: executeCard NOT called, updateBoard called with failed, agent.card.failed emitted, insertOutput called with empty output", async () => {
		const { service, deps } = buildService({
			getColumns: vi.fn().mockResolvedValue([
				{
					columnId: 10,
					columnSlug: "research-specialist",
					systemPrompt: "Hello {unknown_key_xyz}",
					reasoning: false,
				},
			] as ColumnInfo[]),
		});

		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
		await vi.runAllTimersAsync();
		await promise;

		expect(deps.executeCard).not.toHaveBeenCalled();
		expect(deps.updateBoard).toHaveBeenCalledWith(1, {
			execution_status: "failed",
		});

		const publishCalls = (deps.publishEvent as ReturnType<typeof vi.fn>).mock
			.calls;
		const failedEvent = publishCalls
			.map((c: unknown[]) => c[1] as Record<string, unknown>)
			.find((e) => e.type === "agent.card.failed");
		expect(failedEvent).toBeDefined();
		expect(failedEvent!.columnSlug).toBe("research-specialist");
		expect(String(failedEvent!.reason)).toContain("{unknown_key_xyz}");

		expect(deps.insertOutput).toHaveBeenCalledWith(
			expect.objectContaining({
				columnSlug: "research-specialist",
				output: "",
			}),
		);
	});

	it("fail-closed — empty output: pipeline halts after first card, second executeCard NOT called, updateBoard called with failed", async () => {
		const executeCardMock = vi
			.fn()
			.mockResolvedValueOnce({ output: "   " })
			.mockResolvedValueOnce({ output: "should not be called" });

		const { service, deps } = buildService({ executeCard: executeCardMock });

		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
		await vi.runAllTimersAsync();
		await promise;

		expect(executeCardMock).toHaveBeenCalledTimes(1);
		expect(deps.updateBoard).toHaveBeenCalledWith(1, {
			execution_status: "failed",
		});

		const insertCalls = (deps.insertOutput as ReturnType<typeof vi.fn>).mock
			.calls;
		expect(insertCalls).toHaveLength(1);
		expect(insertCalls[0][0]).toMatchObject({
			columnSlug: "research-specialist",
		});

		const publishCalls = (deps.publishEvent as ReturnType<typeof vi.fn>).mock
			.calls;
		const failedEvent = publishCalls
			.map((c: unknown[]) => c[1] as Record<string, unknown>)
			.find((e) => e.type === "agent.card.failed");
		expect(failedEvent).toBeDefined();
		expect(failedEvent!.columnSlug).toBe("research-specialist");
	});

	it("fail-closed — executeCard throws on second card: first insertOutput remains (cardIndex 0), updateBoard called with failed, agent.card.failed emitted, second insertOutput called with empty output", async () => {
		const executeCardMock = vi
			.fn()
			.mockResolvedValueOnce({ output: "first card result" })
			.mockRejectedValueOnce(new Error("LLM timeout"));

		const { service, deps } = buildService({ executeCard: executeCardMock });

		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
		await vi.runAllTimersAsync();
		await promise;

		const insertCalls = (deps.insertOutput as ReturnType<typeof vi.fn>).mock
			.calls;
		expect(insertCalls[0][0]).toMatchObject({
			cardIndex: 0,
			columnSlug: "research-specialist",
			output: "first card result",
		});

		expect(insertCalls[1][0]).toMatchObject({
			cardIndex: 1,
			columnSlug: "analysis-specialist",
			output: "",
		});

		expect(deps.updateBoard).toHaveBeenCalledWith(1, {
			execution_status: "failed",
		});

		const publishCalls = (deps.publishEvent as ReturnType<typeof vi.fn>).mock
			.calls;
		const failedEvent = publishCalls
			.map((c: unknown[]) => c[1] as Record<string, unknown>)
			.find((e) => e.type === "agent.card.failed");
		expect(failedEvent).toBeDefined();
		expect(failedEvent!.columnSlug).toBe("analysis-specialist");
	});
});

// ---------------------------------------------------------------------------
// runPipeline tool wiring — T5
// ---------------------------------------------------------------------------

describe("runPipeline tool wiring", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("translates tool events to SSE and persists each tool call (R5)", async () => {
		const events: Array<Record<string, unknown>> = [];
		const insertToolCall = vi.fn().mockResolvedValue(undefined);

		const toolRegistry = {
			resolveTools: vi
				.fn()
				.mockReturnValue([
					{
						name: "web_search",
						description: "Search",
						inputSchema: {},
						riskTier: "read-only" as const,
						execute: vi.fn(),
					},
				]),
		};

		const executeCard = vi
			.fn()
			.mockImplementation(
				async (
					_sys: string,
					_intent: string,
					_prev: string[],
					_reasoning: boolean,
					onToken: (token: string) => void,
					_tools: unknown[],
					_toolBudget: number,
					onToolEvent?: (e: {
						phase: string;
						toolName?: string;
						query?: string;
						resultCount?: number;
						errorCode?: string;
						attempt?: number;
					}) => void,
				) => {
					onToken("token1");
					onToolEvent?.({
						phase: "started",
						toolName: "web_search",
						query: "fintech",
						attempt: 1,
					});
					onToolEvent?.({
						phase: "result",
						toolName: "web_search",
						query: "fintech",
						resultCount: 5,
						attempt: 1,
					});
					onToken("token2");
					return { output: "final output" };
				},
			);

		const { service } = buildService({
			executeCard,
			publishEvent: vi.fn().mockImplementation(async (_wid, event) => {
				events.push(event);
			}),
			insertToolCall,
			toolRegistry,
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
		});

		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
		await vi.runAllTimersAsync();
		await promise;

		// SSE events
		const toolStarted = events.find((e) => e.type === "agent.tool.started");
		expect(toolStarted).toMatchObject({
			columnSlug: "research-specialist",
			toolName: "web_search",
			query: "fintech",
			attempt: 1,
		});

		const toolResult = events.find((e) => e.type === "agent.tool.result");
		expect(toolResult).toMatchObject({
			columnSlug: "research-specialist",
			toolName: "web_search",
			query: "fintech",
			resultCount: 5,
			attempt: 1,
		});

		// Persistence
		expect(insertToolCall).toHaveBeenCalledTimes(2);
		expect(insertToolCall).toHaveBeenCalledWith(
			expect.objectContaining({
				boardId: 1,
				columnSlug: "research-specialist",
				toolName: "web_search",
				input: "fintech",
				attempt: 1,
			}),
		);

		// Token batching interleaving: tokens should still be emitted
		const tokenEvents = events.filter((e) => e.type === "agent.card.token");
		expect(tokenEvents.length).toBeGreaterThan(0);
	});

	it("writes the final output to agent_card_outputs only — never card_events (R6)", async () => {
		const insertToolCall = vi.fn().mockResolvedValue(undefined);
		const insertOutput = vi.fn().mockResolvedValue(undefined);
		const insertCard = vi.fn().mockResolvedValue(undefined);

		const toolRegistry = {
			resolveTools: vi.fn().mockReturnValue([]),
		};

		const executeCard = vi.fn().mockResolvedValue({ output: "final output" });

		const { service, deps } = buildService({
			executeCard,
			insertOutput,
			insertCard,
			insertToolCall,
			toolRegistry,
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
		});

		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
		await vi.runAllTimersAsync();
		await promise;

		// Final output goes to insertOutput only
		expect(insertOutput).toHaveBeenCalledWith(
			expect.objectContaining({
				boardId: 1,
				columnSlug: "research-specialist",
				output: "final output",
			}),
		);

		// No card_events writes (insertCard is for creating the card handle, not activity feed)
		const publishCalls = (deps.publishEvent as ReturnType<typeof vi.fn>).mock
			.calls;
		const cardEventTypes = [
			"card.created",
			"card.updated",
			"card.moved",
			"card.deleted",
		];
		const humanActivityEvents = publishCalls.filter((c: unknown[]) =>
			cardEventTypes.includes((c[1] as Record<string, unknown>).type as string),
		);
		expect(humanActivityEvents).toHaveLength(0);
	});

	it("passes empty tools and fires no tool events when a column has no tools (R1)", async () => {
		const events: Array<Record<string, unknown>> = [];
		const insertToolCall = vi.fn().mockResolvedValue(undefined);

		const toolRegistry = {
			resolveTools: vi.fn().mockReturnValue([]),
		};

		const executeCard = vi
			.fn()
			.mockImplementation(
				async (
					_sys: string,
					_intent: string,
					_prev: string[],
					_reasoning: boolean,
					onToken: (token: string) => void,
					_tools: unknown[],
					_toolBudget: number,
					_onToolEvent?: (e: {
						phase: string;
						toolName?: string;
						query?: string;
						resultCount?: number;
						errorCode?: string;
						attempt?: number;
					}) => void,
				) => {
					onToken("token");
					// No tool events fired
					return { output: "no tools used" };
				},
			);

		const { service, deps } = buildService({
			executeCard,
			publishEvent: vi.fn().mockImplementation(async (_wid, event) => {
				events.push(event);
			}),
			insertToolCall,
			toolRegistry,
			getColumns: vi.fn().mockResolvedValue([
				{
					columnId: 10,
					columnSlug: "research-specialist",
					systemPrompt: "You are a researcher. Topic: {original_intent}",
					reasoning: false,
					// no tools field
				},
			] as ColumnInfo[]),
		});

		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
		await vi.runAllTimersAsync();
		await promise;

		// Empty tools passed
		const executeCall = (deps.executeCard as ReturnType<typeof vi.fn>).mock
			.calls[0];
		expect(executeCall[5]).toEqual([]); // tools param
		expect(executeCall[6]).toBe(3); // toolBudget default

		// No tool SSE events
		const toolEvents = events.filter((e) =>
			["agent.tool.started", "agent.tool.result", "agent.tool.failed"].includes(
				e.type as string,
			),
		);
		expect(toolEvents).toHaveLength(0);

		// No insertToolCall calls
		expect(insertToolCall).not.toHaveBeenCalled();
	});
});
