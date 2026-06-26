/**
 * Agent Board Service — pure business logic with dependency injection.
 *
 * All external calls (DB, LLM, SSE) are injected via deps, making this
 * module fully unit-testable without real databases or API keys.
 *
 * CRITICAL: Agent card execution output writes to agent_card_outputs,
 * NOT card_events — human Activity Feed must stay clean.
 */

import type { CardTimestamps } from "../core/metrics.js";
import {
	deriveFilename,
	extractRevisedDocument,
	MAX_ARTIFACT_BYTES,
	parseQaVerdict,
} from "./artifact.js";
import {
	buildVarsMap,
	findUnresolvedPlaceholders,
	getTemplate,
	renderSystemPrompt,
} from "./templates.js";
import { makeCreateFile } from "./tools/createFile.js";
import {
	type ActivityItem,
	makeQueryBoardData,
} from "./tools/queryBoardData.js";
import type { Tool } from "./tools/types.js";

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
	columnId: number;
	columnSlug: string;
	systemPrompt: string;
	reasoning: boolean;
	tools?: string[];
	toolBudget?: number | null;
}

export interface ColumnInfo {
	columnId: number;
	columnSlug: string;
	systemPrompt: string;
	reasoning: boolean;
	tools?: string[];
	toolBudget?: number | null;
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

	approveBoardAtomic?: (boardId: number) => Promise<{ rowCount: number }>;

	listBoards?: (workspaceId: number) => Promise<BoardListItem[]>;

	getFirstCard?: (boardId: number) => Promise<FirstCardInfo | null>;

	getColumns?: (boardId: number) => Promise<ColumnInfo[]>;

	executeCard?: (
		systemPrompt: string,
		intent: string,
		previousOutputs: string[],
		reasoning: boolean,
		onToken: (token: string) => void,
		tools?: Tool[],
		toolBudget?: number,
		onToolEvent?: (e: {
			phase: string;
			toolName?: string;
			query?: string;
			resultCount?: number;
			errorCode?: string;
			attempt?: number;
			text?: string;
		}) => void,
		onThinking?: (text: string) => void,
		userContent?: string,
	) => Promise<{ output: string; thinking?: string }>;

	insertOutput?: (data: {
		boardId: number;
		columnSlug: string;
		cardIndex: number;
		output: string;
		thinking?: string;
	}) => Promise<void>;

	insertCard?: (data: {
		columnId: number;
		title: string;
		position: number;
		workspaceId: number;
	}) => Promise<void>;

	insertToolCall?: (data: {
		boardId: number;
		columnSlug: string;
		toolName: string;
		input: Record<string, unknown> | null;
		result: string | null;
		errorCode?: string;
		attempt: number;
	}) => Promise<void>;

	toolRegistry?: {
		resolveTools(names: string[]): Tool[];
	};

	getOutput?: (data: {
		boardId: number;
		columnSlug: string;
	}) => Promise<{ output: string; thinking: string | null } | null>;

	insertArtifact?: (data: {
		boardId: number;
		workspaceId: number;
		filename: string;
		format: "md";
		content: string;
	}) => Promise<void>;

	getArtifact?: (boardId: number) => Promise<{
		filename: string;
		format: "md";
		content: string;
	} | null>;

	generateClarificationQuestion?: (
		intent: string,
		board: unknown,
		feedback: string,
	) => Promise<string>;

	classifyFollowUpIntent?: (
		originalIntent: string,
		artifactContent: string | null,
		conversationHistory: Array<{ role: string; content: string }>,
		userMessage: string,
	) => Promise<{
		intent: "ASK" | "REFINE" | "NEW_DIRECTION" | "OFF_TOPIC";
		response: string;
		confidence: number;
	}>;

	getConversationHistory?: (
		boardId: number,
	) => Promise<Array<{ role: string; content: string }>>;

	deleteOutputsForBoard?: (boardId: number) => Promise<void>;

	deleteCardsForBoard?: (boardId: number) => Promise<void>;

	fetchCardTimestamps?: (workspaceId: number) => Promise<CardTimestamps[]>;

	fetchActivityEvents?: (
		workspaceId: number,
		limit: number,
	) => Promise<ActivityItem[]>;

	detectReportPeriod?: (
		intent: string,
	) => Promise<{ hasPeriod: boolean; question?: string }>;
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

type ToolEventPayload = {
	phase: string;
	toolName?: string;
	query?: string;
	resultCount?: number;
	errorCode?: string;
	attempt?: number;
	text?: string;
};

function persistToolEvent(
	deps: AgentBoardServiceDeps,
	data: {
		boardId: number;
		columnSlug: string;
		event: ToolEventPayload;
		attempt: number;
	},
): void {
	const { boardId, columnSlug, event, attempt } = data;

	if (event.phase === "reasoning") {
		deps.insertToolCall?.({
			boardId,
			columnSlug,
			toolName: "_reasoning",
			input: null,
			result: event.text ?? "",
			attempt: 1,
		});
		return;
	}

	const base = {
		boardId,
		columnSlug,
		toolName: event.toolName ?? "",
		attempt: event.attempt ?? attempt,
	};

	if (event.phase === "started") {
		deps.insertToolCall?.({
			...base,
			input: { query: event.query },
			result: "started",
		});
	} else if (event.phase === "result") {
		deps.insertToolCall?.({
			...base,
			input: { query: event.query, resultCount: event.resultCount },
			result: String(event.resultCount ?? 0),
		});
	} else if (event.phase === "failed") {
		deps.insertToolCall?.({
			...base,
			input: { query: event.query },
			result: null,
			errorCode: event.errorCode,
		});
	}
}

function publishToolSse(
	deps: AgentBoardServiceDeps,
	workspaceId: number,
	boardId: number,
	columnSlug: string,
	e: ToolEventPayload,
): void {
	if (e.phase === "started") {
		deps.publishEvent?.(workspaceId, {
			type: "agent.tool.started",
			columnSlug,
			boardId,
			toolName: e.toolName,
			query: e.query,
			attempt: e.attempt,
		});
	} else if (e.phase === "result") {
		deps.publishEvent?.(workspaceId, {
			type: "agent.tool.result",
			columnSlug,
			boardId,
			toolName: e.toolName,
			query: e.query,
			resultCount: e.resultCount,
			attempt: e.attempt,
		});
	} else if (e.phase === "failed") {
		deps.publishEvent?.(workspaceId, {
			type: "agent.tool.failed",
			columnSlug,
			boardId,
			toolName: e.toolName,
			query: e.query,
			errorCode: e.errorCode,
			attempt: e.attempt,
		});
	}
}

export function createAgentBoardService(deps: AgentBoardServiceDeps) {
	const pendingRegenerate = new Map<number, string>();

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

			let explanation = classifyResult.explanation;
			if (
				classifyResult.templateId === "status-report" &&
				deps.detectReportPeriod
			) {
				try {
					const periodResult = await deps.detectReportPeriod(intent);
					if (!periodResult.hasPeriod) {
						explanation =
							periodResult.question ??
							"Which time period should this status report cover?";
					}
				} catch (err) {
					console.error("[createBoard] detectReportPeriod failed:", err);
					explanation = "Which time period should this status report cover?";
				}
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
				content: explanation,
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

			return { boardId: board.id, explanation };
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

			if (board.templateId === "status-report" && deps.detectReportPeriod) {
				try {
					const periodResult = await deps.detectReportPeriod(
						board.originalIntent,
					);
					if (!periodResult.hasPeriod) {
						return {
							status: 422 as const,
							message:
								periodResult.question ??
								"Which time period should this status report cover?",
						};
					}
				} catch (err) {
					console.error("[approveBoard] detectReportPeriod failed:", err);
					return {
						status: 422 as const,
						message: "Which time period should this status report cover?",
					};
				}
			}

			// Atomic status transition: only one concurrent request wins
			if (deps.approveBoardAtomic) {
				const { rowCount } = await deps.approveBoardAtomic(boardId);
				if (rowCount === 0) return { status: 409 as const };
			} else {
				// Fallback for tests that don't provide approveBoardAtomic
				if (board.status !== "pending") return { status: 409 as const };
				await deps.updateBoard!(boardId, {
					status: "approved",
					execution_status: "running",
				});
			}

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
				boardId,
			});

			// Token batching via setInterval(200ms)
			let tokenBuffer = "";
			let toolEventCount = 0;
			const batchInterval = setInterval(() => {
				if (tokenBuffer) {
					deps.publishEvent?.(workspaceId, {
						type: "agent.card.token",
						columnSlug: firstCard.columnSlug,
						boardId,
						token: tokenBuffer,
					});
					tokenBuffer = "";
				}
			}, 200);

			const resolvedTools =
				deps.toolRegistry?.resolveTools(firstCard.tools ?? []) ?? [];
			const toolBudget = firstCard.toolBudget ?? 3;

			const onToolEvent = (e: ToolEventPayload) => {
				// Flush token buffer before emitting tool event
				if (tokenBuffer) {
					deps.publishEvent?.(workspaceId, {
						type: "agent.card.token",
						columnSlug: firstCard.columnSlug,
						boardId,
						token: tokenBuffer,
					});
					tokenBuffer = "";
				}

				if (e.phase !== "reasoning") {
					publishToolSse(deps, workspaceId, boardId, firstCard.columnSlug, e);
				}

				if (e.phase !== "reasoning") {
					toolEventCount++;
				}
				persistToolEvent(deps, {
					boardId,
					columnSlug: firstCard.columnSlug,
					event: e,
					attempt: toolEventCount,
				});
			};

			try {
				const result = await deps.executeCard!(
					firstCard.systemPrompt,
					board.originalIntent,
					[],
					firstCard.reasoning,
					(token: string) => {
						tokenBuffer += token;
					},
					resolvedTools,
					toolBudget,
					onToolEvent,
				);

				clearInterval(batchInterval);

				// Flush remaining tokens
				if (tokenBuffer) {
					await deps.publishEvent?.(workspaceId, {
						type: "agent.card.token",
						columnSlug: firstCard.columnSlug,
						boardId,
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

				// Create a card in the column so the board visual has a clickable handle.
				// The card title is a preview of the output; full output lives in agent_card_outputs.
				const preview =
					result.output.length > 120
						? result.output.slice(0, 120) + "…"
						: result.output;
				await deps.insertCard!({
					columnId: firstCard.columnId,
					title: preview,
					position: 1.0,
					workspaceId,
				});

				await deps.updateBoard!(boardId, { execution_status: "done" });
				await deps.publishEvent?.(workspaceId, {
					type: "agent.card.done",
					columnSlug: firstCard.columnSlug,
					boardId,
				});
			} catch (err) {
				clearInterval(batchInterval);

				await deps.updateBoard!(boardId, { execution_status: "failed" });
				await deps.publishEvent?.(workspaceId, {
					type: "agent.card.failed",
					columnSlug: firstCard.columnSlug,
					boardId,
					error: String(err),
				});
			}
		},

		// ---- runPipeline ----
		async runPipeline({
			boardId,
			workspaceId,
		}: {
			boardId: number;
			workspaceId: number;
		}) {
			const board = await deps.getBoard!(boardId);
			if (!board) return;

			const columns = await deps.getColumns!(boardId);
			if (!columns || columns.length === 0) return;

			const template = getTemplate(board.templateId ?? "");
			const slugToOutputKey = new Map<string, string>(
				(template?.columns ?? [])
					.filter((c) => c.output_key)
					.map((c) => [c.slug, c.output_key!]),
			);

			const artifactEnabled =
				!!deps.insertArtifact && !!deps.getArtifact && !!deps.getOutput;

			const accumulator: Record<string, string> = {};
			let previousOutput = "";

			for (let i = 0; i < columns.length; i++) {
				const column = columns[i];

				await deps.publishEvent?.(workspaceId, {
					type: "agent.card.started",
					columnSlug: column.columnSlug,
					boardId,
				});

				const vars = buildVarsMap(
					board.originalIntent,
					previousOutput,
					accumulator,
				);
				const rendered = renderSystemPrompt(column.systemPrompt, vars);

				const unresolved = findUnresolvedPlaceholders(rendered);
				if (unresolved.length > 0) {
					const reason = `Unresolved placeholders: ${unresolved.join(", ")}`;
					console.error(
						`[runPipeline] card ${column.columnSlug} halted — ${reason}`,
					);
					await deps.insertOutput!({
						boardId,
						columnSlug: column.columnSlug,
						cardIndex: i,
						output: "",
					});
					await deps.updateBoard!(boardId, { execution_status: "failed" });
					await deps.publishEvent?.(workspaceId, {
						type: "agent.card.failed",
						columnSlug: column.columnSlug,
						boardId,
						reason,
					});
					return;
				}

				let tokenBuffer = "";
				let thinkingBuffer = "";
				let toolEventCount = 0;
				const batchInterval = setInterval(() => {
					if (thinkingBuffer) {
						deps.publishEvent?.(workspaceId, {
							type: "agent.card.thinking",
							columnSlug: column.columnSlug,
							boardId,
							token: thinkingBuffer,
						});
						thinkingBuffer = "";
					}
					if (tokenBuffer) {
						deps.publishEvent?.(workspaceId, {
							type: "agent.card.token",
							columnSlug: column.columnSlug,
							boardId,
							token: tokenBuffer,
						});
						tokenBuffer = "";
					}
				}, 200);

				let resolvedTools =
					deps.toolRegistry?.resolveTools(column.tools ?? []) ?? [];
				if (artifactEnabled && (column.tools ?? []).includes("create_file")) {
					let editorBody = "";
					for (const [, key] of slugToOutputKey) {
						if (key === "editor_output" && accumulator[key]) {
							editorBody = extractRevisedDocument(accumulator[key]);
							break;
						}
					}
					resolvedTools = [
						...resolvedTools,
						makeCreateFile({
							boardId,
							workspaceId,
							intent: board.originalIntent,
							documentContent: editorBody,
							insertArtifact: deps.insertArtifact!,
						}),
					];
				}
				if (
					(column.tools ?? []).includes("query_board_data") &&
					deps.fetchCardTimestamps &&
					deps.fetchActivityEvents
				) {
					resolvedTools = [
						...resolvedTools,
						makeQueryBoardData({
							workspaceId,
							fetchCardTimestamps: deps.fetchCardTimestamps,
							fetchActivityEvents: deps.fetchActivityEvents,
						}),
					];
				}
				const toolBudget = column.toolBudget ?? 3;

				const onToolEvent = (e: ToolEventPayload) => {
					// Flush thinking + token buffers before emitting tool event
					if (thinkingBuffer) {
						deps.publishEvent?.(workspaceId, {
							type: "agent.card.thinking",
							columnSlug: column.columnSlug,
							boardId,
							token: thinkingBuffer,
						});
						thinkingBuffer = "";
					}
					if (tokenBuffer) {
						deps.publishEvent?.(workspaceId, {
							type: "agent.card.token",
							columnSlug: column.columnSlug,
							boardId,
							token: tokenBuffer,
						});
						tokenBuffer = "";
					}

					if (e.phase !== "reasoning") {
						publishToolSse(deps, workspaceId, boardId, column.columnSlug, e);
					}

					if (e.phase !== "reasoning") {
						toolEventCount++;
					}
					persistToolEvent(deps, {
						boardId,
						columnSlug: column.columnSlug,
						event: e,
						attempt: toolEventCount,
					});
				};

				const isQaColumn = (column.tools ?? []).includes("create_file");
				const cardUserContent = isQaColumn
					? "Validate the final document in your system instructions against the original intent. Output your QA verdict only — do not conduct new research or answer the user directly."
					: undefined;

				try {
					const result = await deps.executeCard!(
						rendered,
						board.originalIntent,
						[],
						column.reasoning,
						(token: string) => {
							tokenBuffer += token;
						},
						resolvedTools,
						toolBudget,
						onToolEvent,
						(text: string) => {
							thinkingBuffer += text;
						},
						cardUserContent,
					);

					clearInterval(batchInterval);

					if (thinkingBuffer) {
						await deps.publishEvent?.(workspaceId, {
							type: "agent.card.thinking",
							columnSlug: column.columnSlug,
							boardId,
							token: thinkingBuffer,
						});
						thinkingBuffer = "";
					}
					if (tokenBuffer) {
						await deps.publishEvent?.(workspaceId, {
							type: "agent.card.token",
							columnSlug: column.columnSlug,
							boardId,
							token: tokenBuffer,
						});
					}

					if (result.output.trim().length === 0) {
						const reason = "Empty output";
						console.error(
							`[runPipeline] card ${column.columnSlug} halted — ${reason}`,
						);
						await deps.insertOutput!({
							boardId,
							columnSlug: column.columnSlug,
							cardIndex: i,
							output: result.output,
							thinking: result.thinking,
						});
						await deps.updateBoard!(boardId, { execution_status: "failed" });
						await deps.publishEvent?.(workspaceId, {
							type: "agent.card.failed",
							columnSlug: column.columnSlug,
							boardId,
							reason,
						});
						return;
					}

					await deps.insertOutput!({
						boardId,
						columnSlug: column.columnSlug,
						cardIndex: i,
						output: result.output,
						thinking: result.thinking,
					});

					const preview =
						result.output.length > 120
							? result.output.slice(0, 120) + "…"
							: result.output;
					await deps.insertCard!({
						columnId: column.columnId,
						title: preview,
						position: 1.0,
						workspaceId,
					});

					await deps.publishEvent?.(workspaceId, {
						type: "agent.card.done",
						columnSlug: column.columnSlug,
						boardId,
					});

					const outputKey = slugToOutputKey.get(column.columnSlug);
					if (outputKey) {
						accumulator[outputKey] = result.output;
					}
					previousOutput = result.output;
				} catch (err) {
					clearInterval(batchInterval);
					if (thinkingBuffer) {
						await deps.publishEvent?.(workspaceId, {
							type: "agent.card.thinking",
							columnSlug: column.columnSlug,
							boardId,
							token: thinkingBuffer,
						});
						thinkingBuffer = "";
					}
					if (tokenBuffer) {
						await deps.publishEvent?.(workspaceId, {
							type: "agent.card.token",
							columnSlug: column.columnSlug,
							boardId,
							token: tokenBuffer,
						});
						tokenBuffer = "";
					}
					const reason = String(err);
					console.error(
						`[runPipeline] card ${column.columnSlug} threw — ${reason}`,
					);
					await deps.insertOutput!({
						boardId,
						columnSlug: column.columnSlug,
						cardIndex: i,
						output: "",
					});
					await deps.updateBoard!(boardId, { execution_status: "failed" });
					await deps.publishEvent?.(workspaceId, {
						type: "agent.card.failed",
						columnSlug: column.columnSlug,
						boardId,
						reason,
					});
					return;
				}
			}

			let artifactForNotify = false;
			if (artifactEnabled) {
				let artifact = await deps.getArtifact!(boardId);

				if (!artifact) {
					const qaColumn = columns.find((c) =>
						(c.tools ?? []).includes("create_file"),
					);
					const qaSlug = qaColumn?.columnSlug ?? "qa-guardian";
					const qaOutput = await deps.getOutput!({
						boardId,
						columnSlug: qaSlug,
					});

					if (qaOutput && parseQaVerdict(qaOutput.output) === "pass") {
						let editorSlug = "editor";
						for (const [slug, key] of slugToOutputKey) {
							if (key === "editor_output") {
								editorSlug = slug;
								break;
							}
						}

						const editorOutput = await deps.getOutput!({
							boardId,
							columnSlug: editorSlug,
						});

						if (editorOutput) {
							const content = extractRevisedDocument(editorOutput.output);
							if (
								content.trim() &&
								Buffer.byteLength(content, "utf8") <= MAX_ARTIFACT_BYTES
							) {
								const filename = deriveFilename(content, board.originalIntent);
								await deps.insertArtifact!({
									boardId,
									workspaceId,
									filename,
									format: "md",
									content,
								});
								artifact = { filename, format: "md", content };
							}
						}
					}
				}

				artifactForNotify = !!artifact;
			}

			await deps.updateBoard!(boardId, { execution_status: "done" });
			await deps.publishEvent?.(workspaceId, {
				type: "agent.execution.done",
				boardId,
			});
			if (artifactForNotify) {
				await deps.publishEvent?.(workspaceId, {
					type: "agent.artifact.ready",
					boardId,
				});
			}
		},

		// ---- getCardOutput ----
		async getCardOutput({
			boardId,
			columnSlug,
			workspaceId,
		}: {
			boardId: number;
			columnSlug: string;
			workspaceId: number;
		}) {
			// Enforce workspace ownership before exposing any output —
			// matches getBoardById/approveBoard guards.
			const board = await deps.getBoard!(boardId);
			if (!board || board.workspaceId !== workspaceId)
				return { status: 404 as const };

			const output = await deps.getOutput!({ boardId, columnSlug });
			if (!output) return { status: 404 as const };
			return { output: output.output, thinking: output.thinking };
		},

		// ---- getArtifact ----
		async getArtifact({
			boardId,
			workspaceId,
		}: {
			boardId: number;
			workspaceId: number;
		}) {
			const board = await deps.getBoard!(boardId);
			if (!board || board.workspaceId !== workspaceId)
				return { status: 404 as const };

			const artifact = await deps.getArtifact!(boardId);
			if (!artifact) return { status: 404 as const };
			return artifact;
		},

		// ---- sendMessage (Generate-Explain-Refine loop) ----
		async sendMessage({
			boardId,
			userId,
			workspaceId,
			message,
		}: {
			boardId: number;
			userId: number;
			workspaceId: number;
			message: string;
		}) {
			const board = await deps.getBoard!(boardId);
			if (!board) return { status: 404 as const };
			if (board.workspaceId !== workspaceId) return { status: 404 as const };
			if (board.userId !== userId) return { status: 403 as const };

			if (pendingRegenerate.has(boardId)) {
				return {
					explanation:
						"Menunggu konfirmasi regenerate. Gunakan tombol Ya, Regenerate atau Batal.",
					boardUpdated: false,
				};
			}

			if (board.executionStatus === "running") {
				await deps.insertConversation!({
					boardId,
					role: "user",
					content: message,
				});
				return {
					explanation: "Board sedang dalam eksekusi. Tunggu hingga selesai.",
					boardUpdated: false,
				};
			}

			if (board.status === "pending") {
				await deps.insertConversation!({
					boardId,
					role: "user",
					content: message,
				});

				if (board.templateId === "status-report" && deps.detectReportPeriod) {
					const mergedIntent = `${board.originalIntent}\n${message}`.trim();
					try {
						const periodResult = await deps.detectReportPeriod(mergedIntent);
						if (periodResult.hasPeriod) {
							await deps.updateBoard!(boardId, {
								original_intent: mergedIntent,
							});
							const reply =
								"Period noted. You can approve the board when ready.";
							await deps.insertConversation!({
								boardId,
								role: "assistant",
								content: reply,
							});
							return { explanation: reply, boardUpdated: true };
						}

						const reply =
							periodResult.question ??
							"Which time period should this status report cover?";
						await deps.insertConversation!({
							boardId,
							role: "assistant",
							content: reply,
						});
						return { explanation: reply, boardUpdated: false };
					} catch (err) {
						console.error("[sendMessage] detectReportPeriod failed:", err);
						const reply = "Which time period should this status report cover?";
						await deps.insertConversation!({
							boardId,
							role: "assistant",
							content: reply,
						});
						return { explanation: reply, boardUpdated: false };
					}
				}

				const question = await deps.generateClarificationQuestion!(
					board.originalIntent,
					board,
					message,
				);
				return { explanation: question, boardUpdated: false };
			}

			if (board.status === "approved" && board.executionStatus === "done") {
				const artifact = await deps.getArtifact?.(boardId);
				const history = (await deps.getConversationHistory?.(boardId)) ?? [];

				const result = await deps.classifyFollowUpIntent!(
					board.originalIntent,
					artifact?.content ?? null,
					history,
					message,
				);

				await deps.insertConversation!({
					boardId,
					role: "user",
					content: message,
				});

				switch (result.intent) {
					case "ASK":
					case "REFINE": {
						await deps.publishEvent?.(workspaceId, {
							type: "agent.card.token",
							columnSlug: "__notfirst__",
							boardId,
							token: result.response,
						});
						await deps.insertConversation!({
							boardId,
							role: "assistant",
							content: result.response,
						});
						return {
							explanation: result.response,
							streamed: true as const,
							boardUpdated: false,
						};
					}
					case "NEW_DIRECTION": {
						pendingRegenerate.set(boardId, message);
						await deps.insertConversation!({
							boardId,
							role: "assistant",
							content: result.response,
						});
						return {
							explanation: result.response,
							pendingRegenerate: true,
							boardUpdated: false,
						};
					}
					case "OFF_TOPIC": {
						await deps.insertConversation!({
							boardId,
							role: "assistant",
							content: result.response,
						});
						return {
							explanation: result.response,
							boardUpdated: false,
						};
					}
				}
			}

			await deps.insertConversation!({
				boardId,
				role: "user",
				content: message,
			});
			return {
				explanation:
					"Message received. The board is already approved and executing.",
				boardUpdated: false,
			};
		},

		// ---- confirmRegenerateBoard ----
		async confirmRegenerateBoard({
			boardId,
			userId,
			workspaceId,
		}: {
			boardId: number;
			userId: number;
			workspaceId: number;
		}) {
			const board = await deps.getBoard!(boardId);
			if (!board || board.workspaceId !== workspaceId)
				return { status: 404 as const };
			if (board.userId !== userId) return { status: 403 as const };

			// Atomic claim: delete() returns true only for the first caller
			// CRITICAL: get() and delete() must remain synchronous and adjacent — do not insert await between them
			const newIntent = pendingRegenerate.get(boardId);
			if (!newIntent || !pendingRegenerate.delete(boardId)) {
				return { ok: true as const };
			}

			await deps.insertConversation!({
				boardId,
				role: "assistant",
				content: `Regenerating board with new direction: ${newIntent}`,
			});

			await deps.updateBoard!(boardId, {
				original_intent: newIntent,
				execution_status: "running",
			});
			await deps.deleteOutputsForBoard!(boardId);
			await deps.deleteCardsForBoard!(boardId);

			await deps.publishEvent?.(workspaceId, {
				type: "agent.board.generating",
			});

			this.runPipeline({ boardId, workspaceId }).catch((err: unknown) => {
				console.error("[confirmRegenerateBoard] runPipeline failed:", err);
			});

			return { ok: true as const };
		},

		// ---- cancelRegenerateBoard ----
		async cancelRegenerateBoard({
			boardId,
			userId,
			workspaceId,
		}: {
			boardId: number;
			userId: number;
			workspaceId: number;
		}) {
			const board = await deps.getBoard!(boardId);
			if (!board || board.workspaceId !== workspaceId)
				return { status: 404 as const };
			if (board.userId !== userId) return { status: 403 as const };

			pendingRegenerate.delete(boardId);

			await deps.insertConversation!({
				boardId,
				role: "assistant",
				content: "Regeneration cancelled.",
			});

			return { ok: true as const };
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
