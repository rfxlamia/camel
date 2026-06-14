/**
 * Agent Board Service — pure business logic with dependency injection.
 *
 * All external calls (DB, LLM, SSE) are injected via deps, making this
 * module fully unit-testable without real databases or API keys.
 *
 * CRITICAL: Agent card execution output writes to agent_card_outputs,
 * NOT card_events — human Activity Feed must stay clean.
 */

import { getTemplate } from "./templates.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentBoardRecord {
	id: number;
	status: string;
	workspaceId: number;
	userId: number;
	originalIntent: string;
	templateId?: string;
	executionStatus?: string;
	createdAt?: string;
}

export interface BoardListItem {
	id: number;
	originalIntent: string;
	templateId: string;
	status: string;
	executionStatus: string;
	createdAt: string;
}

export interface FirstCardInfo {
	columnSlug: string;
	systemPrompt: string;
	reasoning: boolean;
}

export interface AgentBoardServiceDeps {
	classifyIntent?: (
		intent: string,
	) => Promise<{ templateId: string | null; explanation: string }>;

	insertBoard?: (data: {
		workspaceId: number;
		userId: number;
		templateId: string;
		originalIntent: string;
		status: string;
	}) => Promise<{ id: number }>;

	insertConversation?: (data: {
		boardId: number;
		role: string;
		content: string;
	}) => Promise<void>;

	insertColumns?: (data: {
		boardId: number;
		workspaceId: number;
		columns: Array<{
			slug: string;
			name: string;
			position: number;
			reasoning: boolean;
			system_prompt: string;
		}>;
	}) => Promise<void>;

	publishEvent?: (
		workspaceId: number,
		event: Record<string, unknown>,
	) => Promise<void>;

	getBoard?: (boardId: number) => Promise<AgentBoardRecord | null>;

	updateBoard?: (
		boardId: number,
		data: Record<string, unknown>,
	) => Promise<void>;

	listBoards?: (workspaceId: number) => Promise<BoardListItem[]>;

	getFirstCard?: (boardId: number) => Promise<FirstCardInfo | null>;

	executeCard?: (
		systemPrompt: string,
		intent: string,
		previousOutputs: string[],
		reasoning: boolean,
		onToken: (token: string) => void,
	) => Promise<{ output: string; thinking?: string }>;

	insertOutput?: (data: {
		boardId: number;
		columnSlug: string;
		cardIndex: number;
		output: string;
		thinking?: string;
	}) => Promise<void>;

	getOutput?: (data: {
		boardId: number;
		columnSlug: string;
	}) => Promise<{ output: string; thinking: string | null } | null>;

	generateClarificationQuestion?: (
		intent: string,
		board: unknown,
		feedback: string,
	) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function createAgentBoardService(deps: AgentBoardServiceDeps) {
	return {
		// ---- createBoard ----
		async createBoard({
			workspaceId,
			userId,
			intent,
		}: {
			workspaceId: number;
			userId: number;
			intent: string;
		}) {
			const classifyResult = await deps.classifyIntent!(intent);

			if (!classifyResult.templateId) {
				return {
					status: 422 as const,
					message: classifyResult.explanation,
				};
			}

			const board = await deps.insertBoard!({
				workspaceId,
				userId,
				templateId: classifyResult.templateId,
				originalIntent: intent,
				status: "pending",
			});

			// Store conversation thread (user intent + assistant explanation)
			await deps.insertConversation!({
				boardId: board.id,
				role: "user",
				content: intent,
			});
			await deps.insertConversation!({
				boardId: board.id,
				role: "assistant",
				content: classifyResult.explanation,
			});

			// Insert template columns with board_id linkage
			const template = getTemplate(classifyResult.templateId);
			if (template) {
				await deps.insertColumns!({
					boardId: board.id,
					workspaceId,
					columns: template.columns,
				});
			}

			await deps.publishEvent?.(workspaceId, {
				type: "agent.board.ready",
			});

			return { boardId: board.id, explanation: classifyResult.explanation };
		},

		// ---- approveBoard ----
		async approveBoard({
			boardId,
			userId,
			workspaceId,
		}: {
			boardId: number;
			userId: number;
			workspaceId: number;
		}) {
			const board = await deps.getBoard!(boardId);
			if (!board) return { status: 404 as const };
			if (board.workspaceId !== workspaceId) return { status: 404 as const };
			if (board.userId !== userId) return { status: 403 as const };
			if (board.status !== "pending") return { status: 409 as const };

			await deps.updateBoard!(boardId, {
				status: "approved",
				execution_status: "running",
			});

			await deps.publishEvent?.(workspaceId, {
				type: "agent.board.generating",
			});
		},

		// ---- triggerExecution ----
		async triggerExecution({
			boardId,
			workspaceId,
		}: {
			boardId: number;
			workspaceId: number;
		}) {
			// Load board — must use original_intent from DB, not from caller
			const board = await deps.getBoard!(boardId);
			if (!board) return;

			// Read first card metadata from columns table (slug, system_prompt, reasoning)
			const firstCard = await deps.getFirstCard!(boardId);
			if (!firstCard) return;

			await deps.publishEvent?.(workspaceId, {
				type: "agent.card.started",
				columnSlug: firstCard.columnSlug,
			});

			// Token batching via setInterval(200ms)
			let tokenBuffer = "";
			const batchInterval = setInterval(() => {
				if (tokenBuffer) {
					deps.publishEvent?.(workspaceId, {
						type: "agent.card.token",
						token: tokenBuffer,
					});
					tokenBuffer = "";
				}
			}, 200);

			try {
				const result = await deps.executeCard!(
					firstCard.systemPrompt,
					board.originalIntent,
					[],
					firstCard.reasoning,
					(token: string) => {
						tokenBuffer += token;
					},
				);

				clearInterval(batchInterval);

				// Flush remaining tokens
				if (tokenBuffer) {
					await deps.publishEvent?.(workspaceId, {
						type: "agent.card.token",
						token: tokenBuffer,
					});
				}

				// Persist output to agent_card_outputs (NOT card_events)
				await deps.insertOutput!({
					boardId,
					columnSlug: firstCard.columnSlug,
					cardIndex: 0,
					output: result.output,
					thinking: result.thinking,
				});

				await deps.updateBoard!(boardId, { execution_status: "done" });
				await deps.publishEvent?.(workspaceId, {
					type: "agent.card.done",
					columnSlug: firstCard.columnSlug,
				});
			} catch (err) {
				clearInterval(batchInterval);

				await deps.updateBoard!(boardId, { execution_status: "failed" });
				await deps.publishEvent?.(workspaceId, {
					type: "agent.card.failed",
					error: String(err),
				});
			}
		},

		// ---- getCardOutput ----
		async getCardOutput({
			boardId,
			columnSlug,
			workspaceId: _workspaceId,
		}: {
			boardId: number;
			columnSlug: string;
			workspaceId: number;
		}) {
			const output = await deps.getOutput!({ boardId, columnSlug });
			if (!output) return { status: 404 as const };
			return { output: output.output, thinking: output.thinking };
		},

		// ---- sendMessage (Generate-Explain-Refine loop) ----
		async sendMessage({
			boardId,
			userId,
			workspaceId: _workspaceId,
			message,
		}: {
			boardId: number;
			userId: number;
			workspaceId: number;
			message: string;
		}) {
			const board = await deps.getBoard!(boardId);
			if (!board) return { status: 404 as const };
			if (board.userId !== userId) return { status: 403 as const };

			// Store user message
			await deps.insertConversation!({
				boardId,
				role: "user",
				content: message,
			});

			if (board.status === "pending") {
				// Generate 1 clarification question via LLM
				const question = await deps.generateClarificationQuestion!(
					board.originalIntent,
					board,
					message,
				);
				return { explanation: question, boardUpdated: false };
			}

			// Approved boards — no LLM call, just acknowledge
			return {
				explanation:
					"Message received. The board is already approved and executing.",
				boardUpdated: false,
			};
		},

		// ---- getBoards (workspace-scoped, sorted newest first) ----
		async getBoards({ workspaceId }: { workspaceId: number }) {
			return deps.listBoards!(workspaceId);
		},

		// ---- getBoardById (history replay — no re-trigger) ----
		async getBoardById({
			boardId,
			workspaceId,
		}: {
			boardId: number;
			workspaceId: number;
		}) {
			const board = await deps.getBoard!(boardId);
			if (!board || board.workspaceId !== workspaceId)
				return { status: 404 as const };
			return board;
		},
	};
}
