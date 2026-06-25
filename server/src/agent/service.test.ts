import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getHumanColumns } from "../routes.js";
import type { AgentBoardServiceDeps, ColumnInfo } from "./service.js";
import { createAgentBoardService } from "./service.js";
import { createToolRegistry } from "./tools/registry.js";
import { webSearch } from "./tools/webSearch.js";

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

	it("concurrent approve does not double-update (TOCTOU guard)", async () => {
		const updateBoard = vi.fn(async () => {});
		const publishEvent = vi.fn(async () => {});
		let callCount = 0;
		const approveBoardAtomic = vi.fn(async () => {
			callCount++;
			// First call wins, second loses the race
			return { rowCount: callCount === 1 ? 1 : 0 };
		});
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "pending",
				workspaceId: 1,
				userId: 1,
				originalIntent: "riset",
			})),
			approveBoardAtomic,
			updateBoard,
			publishEvent,
		});

		const [result1, result2] = await Promise.all([
			service.approveBoard({ boardId: 1, userId: 1, workspaceId: 1 }),
			service.approveBoard({ boardId: 1, userId: 1, workspaceId: 1 }),
		]);

		// Exactly one should succeed (the other gets 409)
		const statuses = [result1, result2].filter(
			(r) => r && "status" in r && r.status === 409,
		);
		expect(statuses).toHaveLength(1);
		// approveBoardAtomic should be called twice (both attempt), but only first wins
		expect(approveBoardAtomic).toHaveBeenCalledTimes(2);
		// updateBoard should NOT be called (atomic method handles it)
		expect(updateBoard).not.toHaveBeenCalled();
		// publishEvent should only be called once (by the winner)
		expect(publishEvent).toHaveBeenCalledTimes(1);
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

describe("getArtifact", () => {
	it("returns the artifact for a member of the owning workspace", async () => {
		const getArtifact = vi.fn(async () => ({
			filename: "title.md",
			format: "md" as const,
			content: "# Title\nBody",
		}));
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "approved",
				workspaceId: 1,
				userId: 1,
				originalIntent: "riset",
			})),
			getArtifact,
		});
		const result = await service.getArtifact({ boardId: 1, workspaceId: 1 });
		expect(result).toMatchObject({
			filename: "title.md",
			format: "md",
			content: "# Title\nBody",
		});
	});

	it("returns 404 when no artifact exists", async () => {
		const getArtifact = vi.fn(async () => null);
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "approved",
				workspaceId: 1,
				userId: 1,
				originalIntent: "riset",
			})),
			getArtifact,
		});
		const result = await service.getArtifact({ boardId: 1, workspaceId: 1 });
		expect(result).toMatchObject({ status: 404 });
	});

	it("returns 404 (not 403, no leak) for a board in another workspace", async () => {
		const getArtifact = vi.fn(async () => ({
			filename: "secret.md",
			format: "md" as const,
			content: "cross-workspace",
		}));
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "approved",
				workspaceId: 2,
				userId: 1,
				originalIntent: "riset",
			})),
			getArtifact,
		});
		const result = await service.getArtifact({ boardId: 1, workspaceId: 1 });
		expect(result).toMatchObject({ status: 404 });
		expect(result).not.toHaveProperty("content");
		expect(getArtifact).not.toHaveBeenCalled();
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

describe("sendMessage follow-up on done board", () => {
	it("calls classifyFollowUpIntent with artifact + history + message for done board", async () => {
		const classifyFollowUpIntent = vi.fn(async () => ({
			intent: "ASK" as const,
			response: "The research found key findings about EV charging.",
			confidence: 0.9,
		}));
		const getArtifact = vi.fn(async () => ({
			filename: "ev-research.md",
			format: "md" as const,
			content: "# EV Market Research\n\nKey findings...",
		}));
		const getConversationHistory = vi.fn(async () => [
			{ role: "user" as const, content: "What about subsidies?" },
			{ role: "assistant" as const, content: "Subsidies are important..." },
		]);
		const insertConversation = vi.fn(async () => {});
		const publishEvent = vi.fn(async () => {});
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "approved",
				executionStatus: "done",
				workspaceId: 1,
				userId: 1,
				originalIntent: "EV market research",
			})),
			getArtifact,
			getConversationHistory,
			classifyFollowUpIntent,
			insertConversation,
			publishEvent,
		});

		await service.sendMessage({
			boardId: 1,
			userId: 1,
			workspaceId: 1,
			message: "What were the key findings about charging?",
		});

		expect(classifyFollowUpIntent).toHaveBeenCalledWith(
			"EV market research",
			"# EV Market Research\n\nKey findings...",
			expect.arrayContaining([
				expect.objectContaining({
					role: "user",
					content: "What about subsidies?",
				}),
			]),
			"What were the key findings about charging?",
		);
	});

	it("streams ASK response via publishEvent with columnSlug __notfirst__ and stores in conversations", async () => {
		const classifyFollowUpIntent = vi.fn(async () => ({
			intent: "ASK" as const,
			response: "The research found three key findings.",
			confidence: 0.9,
		}));
		const insertConversation = vi.fn(async () => {});
		const publishEvent = vi.fn(async () => {});
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "approved",
				executionStatus: "done",
				workspaceId: 1,
				userId: 1,
				originalIntent: "riset",
			})),
			getArtifact: vi.fn(async () => null),
			getConversationHistory: vi.fn(async () => []),
			classifyFollowUpIntent,
			insertConversation,
			publishEvent,
		});

		await service.sendMessage({
			boardId: 1,
			userId: 1,
			workspaceId: 1,
			message: "What did you find?",
		});

		expect(publishEvent).toHaveBeenCalledWith(
			1,
			expect.objectContaining({
				type: "agent.card.token",
				columnSlug: "__notfirst__",
				boardId: 1,
			}),
		);

		expect(insertConversation).toHaveBeenCalledWith(
			expect.objectContaining({
				boardId: 1,
				role: "user",
				content: "What did you find?",
			}),
		);
		expect(insertConversation).toHaveBeenCalledWith(
			expect.objectContaining({
				boardId: 1,
				role: "assistant",
				content: "The research found three key findings.",
			}),
		);
	});

	it("returns OFF_TOPIC response without streaming", async () => {
		const classifyFollowUpIntent = vi.fn(async () => ({
			intent: "OFF_TOPIC" as const,
			response: "This is outside the scope of this board.",
			confidence: 0.95,
		}));
		const insertConversation = vi.fn(async () => {});
		const publishEvent = vi.fn(async () => {});
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "approved",
				executionStatus: "done",
				workspaceId: 1,
				userId: 1,
				originalIntent: "riset",
			})),
			getArtifact: vi.fn(async () => null),
			getConversationHistory: vi.fn(async () => []),
			classifyFollowUpIntent,
			insertConversation,
			publishEvent,
		});

		const result = await service.sendMessage({
			boardId: 1,
			userId: 1,
			workspaceId: 1,
			message: "Write me a Python script",
		});

		expect(publishEvent).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			explanation: "This is outside the scope of this board.",
		});
		expect(insertConversation).toHaveBeenCalledWith(
			expect.objectContaining({
				role: "assistant",
				content: "This is outside the scope of this board.",
			}),
		);
	});

	it("stores pendingRegenerate for NEW_DIRECTION and returns confirmation response", async () => {
		const classifyFollowUpIntent = vi.fn(async () => ({
			intent: "NEW_DIRECTION" as const,
			response: "This is a different topic. I will regenerate the board.",
			confidence: 0.93,
		}));
		const insertConversation = vi.fn(async () => {});
		const publishEvent = vi.fn(async () => {});
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "approved",
				executionStatus: "done",
				workspaceId: 1,
				userId: 1,
				originalIntent: "riset EV",
			})),
			getArtifact: vi.fn(async () => null),
			getConversationHistory: vi.fn(async () => []),
			classifyFollowUpIntent,
			insertConversation,
			publishEvent,
		});

		const result = await service.sendMessage({
			boardId: 1,
			userId: 1,
			workspaceId: 1,
			message: "Now research competitor landscape for scooters",
		});

		expect(result).toMatchObject({
			explanation: expect.stringContaining("regenerate"),
			pendingRegenerate: true,
		});
	});

	it("returns 'Board sedang dalam eksekusi' when board is running", async () => {
		const classifyFollowUpIntent = vi.fn(async () => ({
			intent: "ASK" as const,
			response: "should not be called",
			confidence: 0.8,
		}));
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "approved",
				executionStatus: "running",
				workspaceId: 1,
				userId: 1,
				originalIntent: "riset",
			})),
			classifyFollowUpIntent,
			insertConversation: vi.fn(async () => {}),
		});

		const result = await service.sendMessage({
			boardId: 1,
			userId: 1,
			workspaceId: 1,
			message: "hello",
		});

		expect(classifyFollowUpIntent).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			explanation: expect.stringContaining("eksekusi"),
		});
	});
});

describe("integration: follow-up message flow (T1 + T2)", () => {
	it("ASK flow: classify → stream with __notfirst__ slug → store both user + assistant in conversations", async () => {
		const publishEvent = vi.fn(async () => {});
		const insertConversation = vi.fn(async () => {});
		const getArtifact = vi.fn(async () => ({
			filename: "ev-research.md",
			format: "md" as const,
			content:
				"# EV Market Research\n\nKey findings about charging infrastructure.",
		}));
		const getConversationHistory = vi.fn(async () => [
			{ role: "user" as const, content: "What about subsidies?" },
			{ role: "assistant" as const, content: "Subsidies are a key factor..." },
		]);
		const classifyFollowUpIntent = vi.fn(async () => ({
			intent: "ASK" as const,
			response:
				"The research identified three key findings about charging infrastructure: (1) limited public charging network, (2) home charging as primary method, (3) fast-charging demand increasing.",
			confidence: 0.92,
		}));

		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 42,
				status: "approved",
				executionStatus: "done",
				workspaceId: 7,
				userId: 1,
				originalIntent: "EV market research in Indonesia",
			})),
			getArtifact,
			getConversationHistory,
			classifyFollowUpIntent,
			insertConversation,
			publishEvent,
		});

		const result = await service.sendMessage({
			boardId: 42,
			userId: 1,
			workspaceId: 7,
			message: "What were the key findings about charging infrastructure?",
		});

		expect(classifyFollowUpIntent).toHaveBeenCalledWith(
			"EV market research in Indonesia",
			"# EV Market Research\n\nKey findings about charging infrastructure.",
			expect.arrayContaining([
				expect.objectContaining({
					role: "user",
					content: "What about subsidies?",
				}),
				expect.objectContaining({
					role: "assistant",
					content: "Subsidies are a key factor...",
				}),
			]),
			"What were the key findings about charging infrastructure?",
		);

		expect(publishEvent).toHaveBeenCalledWith(
			7,
			expect.objectContaining({
				type: "agent.card.token",
				columnSlug: "__notfirst__",
				boardId: 42,
			}),
		);

		expect(insertConversation).toHaveBeenCalledWith(
			expect.objectContaining({
				boardId: 42,
				role: "user",
				content: "What were the key findings about charging infrastructure?",
			}),
		);

		expect(insertConversation).toHaveBeenCalledWith(
			expect.objectContaining({
				boardId: 42,
				role: "assistant",
				content: expect.stringContaining("charging infrastructure"),
			}),
		);

		expect(result).toMatchObject({
			explanation: expect.stringContaining("charging infrastructure"),
		});
	});

	it("NEW_DIRECTION flow: classify → store pending → return confirmation with button metadata", async () => {
		const insertConversation = vi.fn(async () => {});
		const publishEvent = vi.fn(async () => {});
		const classifyFollowUpIntent = vi.fn(async () => ({
			intent: "NEW_DIRECTION" as const,
			response:
				"This is a different research topic. I will regenerate the board with focus on scooter competitor analysis.",
			confidence: 0.95,
		}));

		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 42,
				status: "approved",
				executionStatus: "done",
				workspaceId: 7,
				userId: 1,
				originalIntent: "EV market research",
			})),
			getArtifact: vi.fn(async () => null),
			getConversationHistory: vi.fn(async () => []),
			classifyFollowUpIntent,
			insertConversation,
			publishEvent,
		});

		const result = await service.sendMessage({
			boardId: 42,
			userId: 1,
			workspaceId: 7,
			message: "Now analyze competitor landscape for electric scooters",
		});

		expect(result).toMatchObject({
			explanation: expect.stringContaining("regenerate"),
			pendingRegenerate: true,
		});

		const streamCalls = publishEvent.mock.calls.filter(
			(c: unknown[]) => (c[1] as { type?: string }).type === "agent.card.token",
		);
		expect(streamCalls).toHaveLength(0);
	});

	it("OFF_TOPIC flow: classify → return static rejection → no streaming → still stored in conversations", async () => {
		const publishEvent = vi.fn(async () => {});
		const insertConversation = vi.fn(async () => {});
		const classifyFollowUpIntent = vi.fn(async () => ({
			intent: "OFF_TOPIC" as const,
			response:
				"I can help with research for your board, but writing code is outside my scope. You can create a new board for a different task.",
			confidence: 0.97,
		}));

		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 42,
				status: "approved",
				executionStatus: "done",
				workspaceId: 7,
				userId: 1,
				originalIntent: "EV market research",
			})),
			getArtifact: vi.fn(async () => null),
			getConversationHistory: vi.fn(async () => []),
			classifyFollowUpIntent,
			insertConversation,
			publishEvent,
		});

		const result = await service.sendMessage({
			boardId: 42,
			userId: 1,
			workspaceId: 7,
			message: "Write me a Python script to scrape data",
		});

		expect(result).toMatchObject({
			explanation: expect.stringContaining("outside my scope"),
		});

		expect(publishEvent).not.toHaveBeenCalled();

		expect(insertConversation).toHaveBeenCalledTimes(2);
		expect(insertConversation).toHaveBeenCalledWith(
			expect.objectContaining({ role: "user" }),
		);
		expect(insertConversation).toHaveBeenCalledWith(
			expect.objectContaining({ role: "assistant" }),
		);
	});

	it("REFINE flow: classify → stream response → store in conversations", async () => {
		const publishEvent = vi.fn(async () => {});
		const insertConversation = vi.fn(async () => {});
		const classifyFollowUpIntent = vi.fn(async () => ({
			intent: "REFINE" as const,
			response:
				"I will add a section on 2025 government regulations and subsidies for EV adoption in Indonesia.",
			confidence: 0.88,
		}));

		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 42,
				status: "approved",
				executionStatus: "done",
				workspaceId: 7,
				userId: 1,
				originalIntent: "EV market research",
			})),
			getArtifact: vi.fn(async () => ({
				filename: "ev.md",
				format: "md" as const,
				content: "# EV Research",
			})),
			getConversationHistory: vi.fn(async () => []),
			classifyFollowUpIntent,
			insertConversation,
			publishEvent,
		});

		const result = await service.sendMessage({
			boardId: 42,
			userId: 1,
			workspaceId: 7,
			message: "Add a section about 2025 government regulations",
		});

		expect(publishEvent).toHaveBeenCalledWith(
			7,
			expect.objectContaining({
				type: "agent.card.token",
				columnSlug: "__notfirst__",
			}),
		);

		expect(insertConversation).toHaveBeenCalledWith(
			expect.objectContaining({
				role: "assistant",
				content: expect.stringContaining("regulations"),
			}),
		);

		expect(result).toMatchObject({
			explanation: expect.stringContaining("regulations"),
		});
	});
});

describe("integration: regenerate confirmation flow (T2 + T3)", () => {
	it("full confirm flow: sendMessage(NEW_DIRECTION) → confirmRegenerateBoard updates intent, clears outputs, re-runs pipeline", async () => {
		vi.useFakeTimers();
		const updateBoard = vi.fn(async () => {});
		const deleteOutputsForBoard = vi.fn(async () => {});
		const deleteCardsForBoard = vi.fn(async () => {});
		const insertConversation = vi.fn(async () => {});
		const publishEvent = vi.fn(async () => {});
		const getBoard = vi.fn(async () => ({
			id: 42,
			status: "approved",
			executionStatus: "done",
			workspaceId: 7,
			userId: 1,
			originalIntent: "EV market research in Indonesia",
		}));
		const getColumns = vi.fn(async () => [
			{
				columnId: 10,
				columnSlug: "research-specialist",
				systemPrompt: "Research: {original_intent}",
				reasoning: false,
			},
		]);
		const executeCard = vi.fn(async () => ({ output: "New research output" }));

		const service = createAgentBoardService({
			getBoard,
			updateBoard,
			deleteOutputsForBoard,
			deleteCardsForBoard,
			insertConversation,
			publishEvent,
			getArtifact: vi.fn(async () => null),
			getConversationHistory: vi.fn(async () => []),
			classifyFollowUpIntent: vi.fn(async () => ({
				intent: "NEW_DIRECTION" as const,
				response: "This is a different topic. I will regenerate the board.",
				confidence: 0.93,
			})),
			getColumns,
			executeCard,
			insertOutput: vi.fn(async () => {}),
			insertCard: vi.fn(async () => {}),
		});

		const sendResult = await service.sendMessage({
			boardId: 42,
			userId: 1,
			workspaceId: 7,
			message: "Now research competitor landscape for electric scooters",
		});
		expect(sendResult).toMatchObject({ pendingRegenerate: true });

		const confirmPromise = service.confirmRegenerateBoard({
			boardId: 42,
			userId: 1,
			workspaceId: 7,
		});
		await vi.runAllTimersAsync();
		await confirmPromise;

		expect(updateBoard).toHaveBeenCalledWith(
			42,
			expect.objectContaining({
				original_intent: expect.stringContaining("scooter"),
			}),
		);
		expect(deleteOutputsForBoard).toHaveBeenCalledWith(42);
		expect(deleteCardsForBoard).toHaveBeenCalledWith(42);

		expect(getColumns).toHaveBeenCalledWith(42);
		expect(executeCard).toHaveBeenCalled();
		vi.useRealTimers();
	});

	it("cancel flow: sendMessage(NEW_DIRECTION) → cancelRegenerateBoard clears pending without mutations", async () => {
		const updateBoard = vi.fn(async () => {});
		const deleteOutputsForBoard = vi.fn(async () => {});
		const insertConversation = vi.fn(async () => {});

		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 42,
				status: "approved",
				executionStatus: "done",
				workspaceId: 7,
				userId: 1,
				originalIntent: "EV market research",
			})),
			updateBoard,
			deleteOutputsForBoard,
			deleteCardsForBoard: vi.fn(async () => {}),
			insertConversation,
			publishEvent: vi.fn(async () => {}),
			getArtifact: vi.fn(async () => null),
			getConversationHistory: vi.fn(async () => []),
			classifyFollowUpIntent: vi.fn(async () => ({
				intent: "NEW_DIRECTION" as const,
				response: "Regenerating...",
				confidence: 0.9,
			})),
		});

		await service.sendMessage({
			boardId: 42,
			userId: 1,
			workspaceId: 7,
			message: "Research scooters",
		});

		await service.cancelRegenerateBoard({
			boardId: 42,
			userId: 1,
			workspaceId: 7,
		});

		expect(updateBoard).not.toHaveBeenCalled();
		expect(deleteOutputsForBoard).not.toHaveBeenCalled();

		expect(insertConversation).toHaveBeenCalledWith(
			expect.objectContaining({
				boardId: 42,
				role: "assistant",
				content: expect.stringMatching(/cancel|batal/i),
			}),
		);
	});

	it("conversation history preserved after regeneration", async () => {
		vi.useFakeTimers();
		const existingHistory = [
			{ role: "user" as const, content: "What about subsidies?" },
			{ role: "assistant" as const, content: "Subsidies are important..." },
		];
		const insertConversation = vi.fn(async () => {});

		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 42,
				status: "approved",
				executionStatus: "done",
				workspaceId: 7,
				userId: 1,
				originalIntent: "EV market research",
			})),
			updateBoard: vi.fn(async () => {}),
			deleteOutputsForBoard: vi.fn(async () => {}),
			deleteCardsForBoard: vi.fn(async () => {}),
			insertConversation,
			publishEvent: vi.fn(async () => {}),
			getArtifact: vi.fn(async () => null),
			getConversationHistory: vi.fn(async () => existingHistory),
			classifyFollowUpIntent: vi.fn(async () => ({
				intent: "NEW_DIRECTION" as const,
				response: "Regenerating...",
				confidence: 0.9,
			})),
			getColumns: vi.fn(async () => []),
			executeCard: vi.fn(async () => ({ output: "new output" })),
			insertOutput: vi.fn(async () => {}),
			insertCard: vi.fn(async () => {}),
		});

		await service.sendMessage({
			boardId: 42,
			userId: 1,
			workspaceId: 7,
			message: "Research scooters",
		});
		const confirmPromise = service.confirmRegenerateBoard({
			boardId: 42,
			userId: 1,
			workspaceId: 7,
		});
		await vi.runAllTimersAsync();
		await confirmPromise;

		expect(insertConversation).toHaveBeenCalled();
		vi.useRealTimers();
	});
});

describe("confirmRegenerateBoard", () => {
	it("updates intent, deletes old outputs + cards, re-runs pipeline", async () => {
		const updateBoard = vi.fn(async () => {});
		const deleteOutputsForBoard = vi.fn(async () => {});
		const deleteCardsForBoard = vi.fn(async () => {});
		const insertConversation = vi.fn(async () => {});
		const publishEvent = vi.fn(async () => {});
		const getBoard = vi.fn(async () => ({
			id: 1,
			status: "approved",
			executionStatus: "done",
			workspaceId: 1,
			userId: 1,
			originalIntent: "old intent",
		}));

		const classifyFollowUpIntent = vi.fn(async () => ({
			intent: "NEW_DIRECTION" as const,
			response: "Regenerating...",
			confidence: 0.9,
		}));
		const service = createAgentBoardService({
			getBoard,
			updateBoard,
			deleteOutputsForBoard,
			deleteCardsForBoard,
			insertConversation,
			publishEvent,
			getArtifact: vi.fn(async () => null),
			getConversationHistory: vi.fn(async () => []),
			classifyFollowUpIntent,
		});

		await service.sendMessage({
			boardId: 1,
			userId: 1,
			workspaceId: 1,
			message: "Research scooters instead",
		});

		await service.confirmRegenerateBoard({
			boardId: 1,
			userId: 1,
			workspaceId: 1,
		});

		expect(updateBoard).toHaveBeenCalledWith(1, {
			original_intent: expect.stringContaining("scooter"),
			execution_status: "running",
		});
		expect(deleteOutputsForBoard).toHaveBeenCalledWith(1);
		expect(deleteCardsForBoard).toHaveBeenCalledWith(1);
	});

	it("stores confirmation message in agent_conversations", async () => {
		const insertConversation = vi.fn(async () => {});
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "approved",
				executionStatus: "done",
				workspaceId: 1,
				userId: 1,
				originalIntent: "old",
			})),
			updateBoard: vi.fn(async () => {}),
			deleteOutputsForBoard: vi.fn(async () => {}),
			deleteCardsForBoard: vi.fn(async () => {}),
			insertConversation,
			publishEvent: vi.fn(async () => {}),
			getArtifact: vi.fn(async () => null),
			getConversationHistory: vi.fn(async () => []),
			classifyFollowUpIntent: vi.fn(async () => ({
				intent: "NEW_DIRECTION" as const,
				response: "Regenerating...",
				confidence: 0.9,
			})),
		});

		await service.sendMessage({
			boardId: 1,
			userId: 1,
			workspaceId: 1,
			message: "Research scooters",
		});

		await service.confirmRegenerateBoard({
			boardId: 1,
			userId: 1,
			workspaceId: 1,
		});

		const calls = insertConversation.mock.calls;
		const confirmCall = calls.find(
			(c: unknown[]) =>
				(c[0] as { content?: string }).content?.includes("Regenerat") ||
				(c[0] as { content?: string }).content?.includes("regenerat"),
		);
		expect(confirmCall).toBeDefined();
	});

	it("rejects with 404 and performs no mutation when board is in a different workspace", async () => {
		const updateBoard = vi.fn(async () => {});
		const deleteOutputsForBoard = vi.fn(async () => {});
		const deleteCardsForBoard = vi.fn(async () => {});
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "approved",
				executionStatus: "done",
				workspaceId: 1,
				userId: 1,
				originalIntent: "old",
			})),
			updateBoard,
			deleteOutputsForBoard,
			deleteCardsForBoard,
			insertConversation: vi.fn(async () => {}),
			publishEvent: vi.fn(async () => {}),
			getArtifact: vi.fn(async () => null),
			getConversationHistory: vi.fn(async () => []),
			classifyFollowUpIntent: vi.fn(async () => ({
				intent: "NEW_DIRECTION" as const,
				response: "Regenerating...",
				confidence: 0.9,
			})),
		});

		await service.sendMessage({
			boardId: 1,
			userId: 1,
			workspaceId: 1,
			message: "Research scooters",
		});

		const result = await service.confirmRegenerateBoard({
			boardId: 1,
			userId: 1,
			workspaceId: 999,
		});

		expect(result).toMatchObject({ status: 404 });
		expect(updateBoard).not.toHaveBeenCalled();
		expect(deleteOutputsForBoard).not.toHaveBeenCalled();
		expect(deleteCardsForBoard).not.toHaveBeenCalled();
	});
});

describe("cancelRegenerateBoard", () => {
	it("clears pending state and stores cancellation message", async () => {
		const insertConversation = vi.fn(async () => {});
		const publishEvent = vi.fn(async () => {});
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "approved",
				executionStatus: "done",
				workspaceId: 1,
				userId: 1,
				originalIntent: "old",
			})),
			updateBoard: vi.fn(async () => {}),
			deleteOutputsForBoard: vi.fn(async () => {}),
			deleteCardsForBoard: vi.fn(async () => {}),
			insertConversation,
			publishEvent,
			getArtifact: vi.fn(async () => null),
			getConversationHistory: vi.fn(async () => []),
			classifyFollowUpIntent: vi.fn(async () => ({
				intent: "NEW_DIRECTION" as const,
				response: "Regenerating...",
				confidence: 0.9,
			})),
		});

		await service.sendMessage({
			boardId: 1,
			userId: 1,
			workspaceId: 1,
			message: "Research scooters",
		});

		await service.cancelRegenerateBoard({
			boardId: 1,
			userId: 1,
			workspaceId: 1,
		});

		const calls = insertConversation.mock.calls;
		const cancelCall = calls.find(
			(c: unknown[]) =>
				(c[0] as { content?: string }).content?.includes("cancel") ||
				(c[0] as { content?: string }).content?.includes("batal"),
		);
		expect(cancelCall).toBeDefined();
	});

	it("does not call updateBoard or deleteOutputsForBoard on cancel", async () => {
		const updateBoard = vi.fn(async () => {});
		const deleteOutputsForBoard = vi.fn(async () => {});
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "approved",
				executionStatus: "done",
				workspaceId: 1,
				userId: 1,
				originalIntent: "old",
			})),
			updateBoard,
			deleteOutputsForBoard,
			deleteCardsForBoard: vi.fn(async () => {}),
			insertConversation: vi.fn(async () => {}),
			publishEvent: vi.fn(async () => {}),
			getArtifact: vi.fn(async () => null),
			getConversationHistory: vi.fn(async () => []),
			classifyFollowUpIntent: vi.fn(async () => ({
				intent: "NEW_DIRECTION" as const,
				response: "Regenerating...",
				confidence: 0.9,
			})),
		});

		await service.sendMessage({
			boardId: 1,
			userId: 1,
			workspaceId: 1,
			message: "Research scooters",
		});
		await service.cancelRegenerateBoard({
			boardId: 1,
			userId: 1,
			workspaceId: 1,
		});

		expect(updateBoard).not.toHaveBeenCalled();
		expect(deleteOutputsForBoard).not.toHaveBeenCalled();
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
// runPipeline live thinking SSE — T3
// ---------------------------------------------------------------------------

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

	it("flushes pending thinking + token buffers BEFORE agent.card.done", async () => {
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
						_tools: unknown[],
						_budget: number,
						_onToolEvent: unknown,
						onThinking?: (t: string) => void,
					) => {
						onThinking?.("final think");
						onToken("final tok");
						return { output: "final output" };
					},
				),
		});

		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
		await vi.runAllTimersAsync();
		await promise;

		const doneIdx = events.findIndex((e) => e.type === "agent.card.done");
		expect(doneIdx).toBeGreaterThanOrEqual(0);

		const thinkingIdx = events.findIndex(
			(e) => e.type === "agent.card.thinking",
		);
		const tokenIdx = events.findIndex((e) => e.type === "agent.card.token");
		expect(thinkingIdx).toBeGreaterThanOrEqual(0);
		expect(tokenIdx).toBeGreaterThanOrEqual(0);
		expect(thinkingIdx).toBeLessThan(doneIdx);
		expect(tokenIdx).toBeLessThan(doneIdx);

		const afterDone = events.slice(doneIdx + 1);
		expect(afterDone.some((e) => e.type === "agent.card.thinking")).toBe(false);
		expect(afterDone.some((e) => e.type === "agent.card.token")).toBe(false);
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
			resolveTools: vi.fn().mockReturnValue([
				{
					name: "web_search",
					description: "Search",
					inputSchema: { type: "object" },
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
			boardId: 1,
			toolName: "web_search",
			query: "fintech",
			attempt: 1,
		});

		const toolResult = events.find((e) => e.type === "agent.tool.result");
		expect(toolResult).toMatchObject({
			columnSlug: "research-specialist",
			boardId: 1,
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
				input: { query: "fintech" },
				result: "started",
				attempt: 1,
			}),
		);
		expect(insertToolCall).toHaveBeenCalledWith(
			expect.objectContaining({
				input: { query: "fintech", resultCount: 5 },
				result: "5",
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

	it("passes resolved web_search when toolRegistry is wired (production path)", async () => {
		const executeCard = vi.fn().mockResolvedValue({ output: "final output" });
		const toolRegistry = createToolRegistry([webSearch]);

		const { service } = buildService({
			executeCard,
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

		const toolsArg = executeCard.mock.calls[0][5] as Array<{ name: string }>;
		expect(toolsArg).toHaveLength(1);
		expect(toolsArg[0].name).toBe("web_search");
	});
});

// ---------------------------------------------------------------------------
// runPipeline artifact persistence — T4
// ---------------------------------------------------------------------------

describe("runPipeline artifact persistence", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const QA_COLUMNS: ColumnInfo[] = [
		{
			columnId: 30,
			columnSlug: "qa-guardian",
			systemPrompt: "Review. Intent: {original_intent}",
			reasoning: false,
			tools: ["create_file"],
			toolBudget: 3,
		} as ColumnInfo,
	];

	it("primary path: bound create_file persists editor document and publishes events", async () => {
		const editorDoc =
			"## Editorial Notes\n- n\n\n---\n\n## Revised Document\n# T\nBody";
		const events: Array<Record<string, unknown>> = [];
		const insertArtifact = vi.fn(async () => {});
		const { service } = buildService({
			insertArtifact,
			getArtifact: vi.fn(async () => ({
				filename: "t.md",
				format: "md" as const,
				content: "# T\nBody",
			})),
			getOutput: vi.fn(async () => ({
				output: "**Status:** PASS",
				thinking: null,
			})),
			getColumns: vi.fn().mockResolvedValue([
				{
					columnId: 20,
					columnSlug: "editor",
					systemPrompt: "Edit",
					reasoning: false,
					tools: [],
				},
				...QA_COLUMNS,
			]),
			publishEvent: vi.fn().mockImplementation(async (_wid, event) => {
				events.push(event);
			}),
			executeCard: vi.fn().mockImplementation(
				async (
					_sys,
					_intent,
					_prev,
					_reasoning,
					_onToken,
					tools,
					_budget,
					_onToolEvent,
					_thinking,
					_userContent,
					// accumulator is simulated by running editor first via mock return
				) => {
					const createFile = tools.find(
						(t: { name: string }) => t.name === "create_file",
					);
					if (createFile) {
						await createFile.execute({});
						return { output: "**Status:** PASS" };
					}
					return { output: editorDoc };
				},
			),
		});
		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
		await vi.runAllTimersAsync();
		await promise;
		expect(insertArtifact).toHaveBeenCalledWith(
			expect.objectContaining({ content: "# T\nBody" }),
		);
		expect(insertArtifact).toHaveBeenCalledTimes(1);
		expect(events).toContainEqual(
			expect.objectContaining({ type: "agent.execution.done", boardId: 1 }),
		);
		expect(events).toContainEqual(
			expect.objectContaining({ type: "agent.artifact.ready", boardId: 1 }),
		);
		const doneIdx = events.findIndex((e) => e.type === "agent.execution.done");
		const readyIdx = events.findIndex((e) => e.type === "agent.artifact.ready");
		expect(doneIdx).toBeGreaterThanOrEqual(0);
		expect(readyIdx).toBeGreaterThan(doneIdx);
	});

	it("passes a validation-only user message to QA Guardian", async () => {
		const { service, deps } = buildService({
			insertArtifact: vi.fn(async () => {}),
			getArtifact: vi.fn(async () => null),
			getOutput: vi.fn(async () => ({
				output: "**Status:** PASS",
				thinking: null,
			})),
			getColumns: vi.fn().mockResolvedValue(QA_COLUMNS),
			executeCard: vi.fn().mockResolvedValue({ output: "**Status:** PASS" }),
		});
		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
		await vi.runAllTimersAsync();
		await promise;
		const userMessage = (deps.executeCard as ReturnType<typeof vi.fn>).mock
			.calls[0][9] as string;
		expect(userMessage).toContain("Validate");
		expect(userMessage).toContain("do not conduct new research");
	});

	it("binds a create_file tool into the QA column's resolved tools", async () => {
		const { service, deps } = buildService({
			insertArtifact: vi.fn(async () => {}),
			getArtifact: vi.fn(async () => ({ filename: "t.md" })),
			getOutput: vi.fn(async () => ({
				output: "**Status:** PASS",
				thinking: null,
			})),
			getColumns: vi.fn().mockResolvedValue(QA_COLUMNS),
			executeCard: vi.fn().mockResolvedValue({ output: "**Status:** PASS" }),
		});
		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
		await vi.runAllTimersAsync();
		await promise;
		const toolsArg = (deps.executeCard as ReturnType<typeof vi.fn>).mock
			.calls[0][5] as Array<{ name: string }>;
		expect(toolsArg.some((t) => t.name === "create_file")).toBe(true);
	});

	it("fallback: PASS with no artifact extracts the Revised Document body", async () => {
		const insertArtifact = vi.fn(async () => {});
		const getOutput = vi.fn(async ({ columnSlug }: { columnSlug: string }) => {
			if (columnSlug === "qa-guardian")
				return { output: "**Status:** PASS", thinking: null };
			return {
				output:
					"## Editorial Notes\n- n\n\n---\n\n## Revised Document\n# T\nBody",
				thinking: null,
			};
		});
		const { service } = buildService({
			insertArtifact,
			getArtifact: vi.fn(async () => null),
			getOutput,
			getColumns: vi.fn().mockResolvedValue(QA_COLUMNS),
			executeCard: vi.fn().mockResolvedValue({ output: "**Status:** PASS" }),
		});
		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
		await vi.runAllTimersAsync();
		await promise;
		expect(insertArtifact).toHaveBeenCalledWith(
			expect.objectContaining({ content: "# T\nBody" }),
		);
	});

	it("fallback skips insert when extracted content exceeds MAX_ARTIFACT_BYTES", async () => {
		const insertArtifact = vi.fn(async () => {});
		const getOutput = vi.fn(async ({ columnSlug }: { columnSlug: string }) => {
			if (columnSlug === "qa-guardian")
				return { output: "**Status:** PASS", thinking: null };
			return {
				output: `## Revised Document\n${"x".repeat(1_000_001)}`,
				thinking: null,
			};
		});
		const { service } = buildService({
			insertArtifact,
			getArtifact: vi.fn(async () => null),
			getOutput,
			getColumns: vi.fn().mockResolvedValue(QA_COLUMNS),
			executeCard: vi.fn().mockResolvedValue({ output: "**Status:** PASS" }),
		});
		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
		await vi.runAllTimersAsync();
		await promise;
		expect(insertArtifact).not.toHaveBeenCalled();
	});

	it("fallback gated off: NEEDS REVISION creates no artifact and no ready event", async () => {
		const events: Array<Record<string, unknown>> = [];
		const insertArtifact = vi.fn(async () => {});
		const { service } = buildService({
			insertArtifact,
			getArtifact: vi.fn(async () => null),
			getOutput: vi.fn(async () => ({
				output: "**Status:** NEEDS REVISION",
				thinking: null,
			})),
			getColumns: vi.fn().mockResolvedValue(QA_COLUMNS),
			executeCard: vi
				.fn()
				.mockResolvedValue({ output: "**Status:** NEEDS REVISION" }),
			publishEvent: vi.fn().mockImplementation(async (_wid, event) => {
				events.push(event);
			}),
		});
		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
		await vi.runAllTimersAsync();
		await promise;
		expect(insertArtifact).not.toHaveBeenCalled();
		expect(events.some((e) => e.type === "agent.artifact.ready")).toBe(false);
		expect(events.some((e) => e.type === "agent.execution.done")).toBe(true);
	});

	it("isolation: final output still goes to insertOutput, never via insertArtifact", async () => {
		const insertOutput = vi.fn(async () => {});
		const insertArtifact = vi.fn(async () => {});
		const { service } = buildService({
			insertOutput,
			insertArtifact,
			getArtifact: vi.fn(async () => null),
			getOutput: vi.fn(async () => ({
				output: "**Status:** NEEDS REVISION",
				thinking: null,
			})),
			getColumns: vi.fn().mockResolvedValue(QA_COLUMNS),
			executeCard: vi
				.fn()
				.mockResolvedValue({ output: "**Status:** NEEDS REVISION" }),
		});
		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
		await vi.runAllTimersAsync();
		await promise;
		expect(insertOutput).toHaveBeenCalledWith(
			expect.objectContaining({ columnSlug: "qa-guardian" }),
		);
		expect(insertArtifact).not.toHaveBeenCalled();
	});
});

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
		const fetchActivityEvents = vi.fn(
			async (_wid: number, _limit: number) => [],
		);
		const { service, deps } = buildService({
			getBoard: vi.fn().mockResolvedValue({ ...DEFAULT_BOARD, workspaceId: 7 }),
			getColumns: vi.fn().mockResolvedValue([QBD_COLUMN]),
			fetchCardTimestamps,
			fetchActivityEvents,
		});

		const promise = service.runPipeline({ boardId: 1, workspaceId: 7 });
		await vi.runAllTimersAsync();
		await promise;

		const toolsArg = (deps.executeCard as ReturnType<typeof vi.fn>).mock
			.calls[0][5];
		const qbd = toolsArg.find(
			(t: { name: string }) => t.name === "query_board_data",
		);
		expect(qbd).toBeDefined();

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

// ---- Bug-hunting: multi-turn conversation gaps (fixed) ----

describe("bug-hunting: multi-turn conversation", () => {
	it("classifyFollowUpIntent receives history without current user message before insert", async () => {
		const priorHistory = [
			{ role: "user", content: "Earlier question" },
			{ role: "assistant", content: "Earlier answer" },
		];
		const classifyFollowUpIntent = vi.fn(async () => ({
			intent: "ASK" as const,
			response: "Answer.",
			confidence: 0.9,
		}));
		const insertConversation = vi.fn(async () => {});
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "approved",
				executionStatus: "done",
				workspaceId: 1,
				userId: 1,
				originalIntent: "EV research",
			})),
			getArtifact: vi.fn(async () => null),
			getConversationHistory: vi.fn(async () => [...priorHistory]),
			insertConversation,
			classifyFollowUpIntent,
			publishEvent: vi.fn(async () => {}),
		});

		await service.sendMessage({
			boardId: 1,
			userId: 1,
			workspaceId: 1,
			message: "What about subsidies?",
		});

		const historyArg = classifyFollowUpIntent.mock.calls[0][2] as Array<{
			role: string;
			content: string;
		}>;
		expect(historyArg).toEqual(priorHistory);
		expect(historyArg).not.toContainEqual({
			role: "user",
			content: "What about subsidies?",
		});
		expect(insertConversation).toHaveBeenCalledWith({
			boardId: 1,
			role: "user",
			content: "What about subsidies?",
		});
	});

	it("does not call classifyFollowUpIntent on failed boards", async () => {
		const classifyFollowUpIntent = vi.fn(async () => ({
			intent: "ASK" as const,
			response: "Should not run.",
			confidence: 0.9,
		}));
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "approved",
				executionStatus: "failed",
				workspaceId: 1,
				userId: 1,
				originalIntent: "EV research",
			})),
			insertConversation: vi.fn(async () => {}),
			classifyFollowUpIntent,
		});

		const result = await service.sendMessage({
			boardId: 1,
			userId: 1,
			workspaceId: 1,
			message: "What went wrong?",
		});

		expect(classifyFollowUpIntent).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			explanation: expect.stringContaining("approved and executing"),
		});
	});

	it("confirmRegenerateBoard sets execution_status to running before pipeline", async () => {
		vi.useFakeTimers();
		const updateBoard = vi.fn(async () => {});
		const publishEvent = vi.fn(async () => {});
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 42,
				status: "approved",
				executionStatus: "done",
				workspaceId: 7,
				userId: 1,
				originalIntent: "EV research",
			})),
			updateBoard,
			publishEvent,
			deleteOutputsForBoard: vi.fn(async () => {}),
			deleteCardsForBoard: vi.fn(async () => {}),
			insertConversation: vi.fn(async () => {}),
			getArtifact: vi.fn(async () => null),
			getConversationHistory: vi.fn(async () => []),
			classifyFollowUpIntent: vi.fn(async () => ({
				intent: "NEW_DIRECTION" as const,
				response: "Regenerate?",
				confidence: 0.9,
			})),
			getColumns: vi.fn(async () => []),
			executeCard: vi.fn(async () => ({ output: "" })),
			insertOutput: vi.fn(async () => {}),
			insertCard: vi.fn(async () => {}),
		});

		await service.sendMessage({
			boardId: 42,
			userId: 1,
			workspaceId: 7,
			message: "Research scooters instead",
		});

		const confirmPromise = service.confirmRegenerateBoard({
			boardId: 42,
			userId: 1,
			workspaceId: 7,
		});
		await vi.runAllTimersAsync();
		await confirmPromise;

		expect(updateBoard).toHaveBeenCalledWith(
			42,
			expect.objectContaining({ execution_status: "running" }),
		);
		expect(publishEvent).toHaveBeenCalledWith(
			7,
			expect.objectContaining({ type: "agent.board.generating" }),
		);
		vi.useRealTimers();
	});

	it("rejects follow-up while regenerate pipeline runs", async () => {
		vi.useFakeTimers();
		const classifyFollowUpIntent = vi.fn(async () => ({
			intent: "ASK" as const,
			response: "During regenerate.",
			confidence: 0.9,
		}));
		const getBoard = vi.fn(async () => ({
			id: 42,
			status: "approved",
			executionStatus: "running",
			workspaceId: 7,
			userId: 1,
			originalIntent: "EV research",
		}));
		const service = createAgentBoardService({
			getBoard,
			updateBoard: vi.fn(async () => {}),
			deleteOutputsForBoard: vi.fn(async () => {}),
			deleteCardsForBoard: vi.fn(async () => {}),
			insertConversation: vi.fn(async () => {}),
			publishEvent: vi.fn(async () => {}),
			getArtifact: vi.fn(async () => null),
			getConversationHistory: vi.fn(async () => []),
			classifyFollowUpIntent,
			getColumns: vi.fn(async () => []),
			executeCard: vi.fn(async () => ({ output: "out" })),
			insertOutput: vi.fn(async () => {}),
			insertCard: vi.fn(async () => {}),
		});

		const duringResult = await service.sendMessage({
			boardId: 42,
			userId: 1,
			workspaceId: 7,
			message: "Can I ask something?",
		});

		expect(classifyFollowUpIntent).not.toHaveBeenCalled();
		expect(duringResult).toMatchObject({
			explanation: expect.stringContaining("eksekusi"),
		});
		vi.useRealTimers();
	});

	it("confirmRegenerateBoard silently succeeds when pending state is missing", async () => {
		const updateBoard = vi.fn(async () => {});
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 42,
				status: "approved",
				executionStatus: "done",
				workspaceId: 7,
				userId: 1,
				originalIntent: "EV research",
			})),
			updateBoard,
			deleteOutputsForBoard: vi.fn(async () => {}),
			deleteCardsForBoard: vi.fn(async () => {}),
			insertConversation: vi.fn(async () => {}),
		});

		const result = await service.confirmRegenerateBoard({
			boardId: 42,
			userId: 1,
			workspaceId: 7,
		});

		expect(result).toEqual({ ok: true });
		expect(updateBoard).not.toHaveBeenCalled();
	});

	it("rejects sendMessage while pending regeneration", async () => {
		const classifyFollowUpIntent = vi.fn(async () => ({
			intent: "NEW_DIRECTION" as const,
			response: "Second topic.",
			confidence: 0.9,
		}));
		const insertConversation = vi.fn(async () => {});
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 42,
				status: "approved",
				executionStatus: "done",
				workspaceId: 7,
				userId: 1,
				originalIntent: "EV research",
			})),
			updateBoard: vi.fn(async () => {}),
			deleteOutputsForBoard: vi.fn(async () => {}),
			deleteCardsForBoard: vi.fn(async () => {}),
			insertConversation,
			publishEvent: vi.fn(async () => {}),
			getArtifact: vi.fn(async () => null),
			getConversationHistory: vi.fn(async () => []),
			classifyFollowUpIntent,
		});

		await service.sendMessage({
			boardId: 42,
			userId: 1,
			workspaceId: 7,
			message: "First new topic",
		});

		classifyFollowUpIntent.mockClear();
		insertConversation.mockClear();

		const blocked = await service.sendMessage({
			boardId: 42,
			userId: 1,
			workspaceId: 7,
			message: "Second new topic",
		});

		expect(classifyFollowUpIntent).not.toHaveBeenCalled();
		expect(insertConversation).not.toHaveBeenCalled();
		expect(blocked.explanation).toMatch(/konfirmasi regenerate/i);
	});

	it("confirmRegenerateBoard returns 403 for non-owner", async () => {
		const updateBoard = vi.fn(async () => {});
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 42,
				status: "approved",
				executionStatus: "done",
				workspaceId: 7,
				userId: 99,
				originalIntent: "EV research",
			})),
			updateBoard,
			deleteOutputsForBoard: vi.fn(async () => {}),
			deleteCardsForBoard: vi.fn(async () => {}),
			insertConversation: vi.fn(async () => {}),
			getArtifact: vi.fn(async () => null),
			getConversationHistory: vi.fn(async () => []),
			classifyFollowUpIntent: vi.fn(async () => ({
				intent: "NEW_DIRECTION" as const,
				response: "Regenerate?",
				confidence: 0.9,
			})),
			getColumns: vi.fn(async () => []),
			executeCard: vi.fn(async () => ({ output: "" })),
			insertOutput: vi.fn(async () => {}),
			insertCard: vi.fn(async () => {}),
		});

		await service.sendMessage({
			boardId: 42,
			userId: 99,
			workspaceId: 7,
			message: "Pivot to scooters",
		});

		const result = await service.confirmRegenerateBoard({
			boardId: 42,
			userId: 1,
			workspaceId: 7,
		});

		expect(result).toMatchObject({ status: 403 });
		expect(updateBoard).not.toHaveBeenCalled();
	});

	it("ASK responses include streamed flag", async () => {
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "approved",
				executionStatus: "done",
				workspaceId: 1,
				userId: 1,
				originalIntent: "EV research",
			})),
			getArtifact: vi.fn(async () => null),
			getConversationHistory: vi.fn(async () => []),
			insertConversation: vi.fn(async () => {}),
			classifyFollowUpIntent: vi.fn(async () => ({
				intent: "ASK" as const,
				response: "Answer.",
				confidence: 0.9,
			})),
			publishEvent: vi.fn(async () => {}),
		});

		const result = await service.sendMessage({
			boardId: 1,
			userId: 1,
			workspaceId: 1,
			message: "Question?",
		});

		expect(result).toMatchObject({ streamed: true, explanation: "Answer." });
	});
});

// ---------------------------------------------------------------------------
// status-report missing-period clarification (T5)
// ---------------------------------------------------------------------------

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

	it("still-missing period re-asks period question, not generic clarification", async () => {
		const detectReportPeriod = vi.fn(async () => ({
			hasPeriod: false,
			question: "Which time period should this status report cover?",
		}));
		const generateClarificationQuestion = vi.fn(
			async () => "Can you clarify your research topic?",
		);
		const insertConversation = vi.fn(async () => {});
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "pending",
				templateId: "status-report",
				workspaceId: 1,
				userId: 1,
				originalIntent: "give me a status report",
			})),
			insertConversation,
			generateClarificationQuestion,
			detectReportPeriod,
		});

		const result = await service.sendMessage({
			boardId: 1,
			userId: 1,
			workspaceId: 1,
			message: "not sure yet",
		});

		expect(detectReportPeriod).toHaveBeenCalled();
		expect(generateClarificationQuestion).not.toHaveBeenCalled();
		expect(result.explanation).toMatch(/period/i);
		expect(insertConversation).toHaveBeenCalledWith(
			expect.objectContaining({
				role: "assistant",
				content: expect.stringMatching(/period/i),
			}),
		);
	});

	it("approveBoard blocks when status-report intent still has no period", async () => {
		const detectReportPeriod = vi.fn(async () => ({ hasPeriod: false }));
		const updateBoard = vi.fn(async () => {});
		const service = createAgentBoardService({
			getBoard: vi.fn(async () => ({
				id: 1,
				status: "pending",
				templateId: "status-report",
				workspaceId: 1,
				userId: 1,
				originalIntent: "give me a status report",
			})),
			updateBoard,
			detectReportPeriod,
			publishEvent: vi.fn(async () => {}),
		});

		const result = await service.approveBoard({
			boardId: 1,
			userId: 1,
			workspaceId: 1,
		});

		expect(detectReportPeriod).toHaveBeenCalledWith("give me a status report");
		expect(result).toMatchObject({
			status: 422,
			message: expect.stringMatching(/period/i),
		});
		expect(updateBoard).not.toHaveBeenCalled();
	});
});
