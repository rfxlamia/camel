/**
 * Agent Board Routes — workspace-scoped endpoints for agentic kanban.
 *
 * Mounts under /api so full paths are:
 *   POST   /api/workspaces/:wid/agent/boards
 *   POST   /api/workspaces/:wid/agent/boards/:bid/message
 *   POST   /api/workspaces/:wid/agent/boards/:bid/approve
 *   GET    /api/workspaces/:wid/agent/boards
 *   GET    /api/workspaces/:wid/agent/boards/:id
 *   GET    /api/workspaces/:wid/agent/boards/:bid/outputs/:slug
 *   GET    /api/workspaces/:wid/agent/boards/:bid/artifact
 *   GET    /api/workspaces/:wid/agent/boards/:bid/artifact/download
 *
 * requireAuth is per-route (NOT router-level) to avoid double-mounting
 * when both this and the existing api router are on /api.
 *
 * CRITICAL: Agent card execution output writes to agent_card_outputs,
 * NOT card_events — human Activity Feed must stay clean.
 */

import type { Request } from "express";
import { Router } from "express";
import { sql } from "kysely";
import { requireAuth } from "../auth.js";
import { db, type DBExecutor } from "../db/kysely.js";
import { llmTimeout } from "../middleware/timeout.js";
import { publishEvent as realPublishEvent } from "../realtime.js";
import {
	classifyFollowUpIntent as realClassifyFollowUpIntent,
	classifyIntent as realClassifyIntent,
	detectReportPeriod as realDetectReportPeriod,
	executeCard as realExecuteCard,
	generateClarificationQuestion as realGenerateClarificationQuestion,
} from "./llm.js";
import {
	type AgentBoardServiceDeps,
	createAgentBoardService,
} from "./service.js";
import { createToolRegistry } from "./tools/registry.js";
import { mergeToolTraceRows } from "./tools/trace.js";
import { webSearch } from "./tools/webSearch.js";

export const defaultToolRegistry = createToolRegistry([webSearch]);

// ---------------------------------------------------------------------------
// Trace replay helper — read-only, never executes tools
// ---------------------------------------------------------------------------

export interface ToolTraceItem {
	columnSlug: string;
	toolName: string;
	query?: string;
	resultCount?: number;
	errorCode?: string;
	attempt?: number;
	createdAt?: string;
	reasoningText?: string;
}

export async function getToolTrace(
	dbExec: DBExecutor,
	boardId: number,
): Promise<ToolTraceItem[]> {
	const rows = await dbExec
		.selectFrom("agent_tool_calls")
		.select([
			"column_slug",
			"tool_name",
			"input",
			"result",
			"error_code",
			"attempt",
			"created_at",
		])
		.where("board_id", "=", boardId)
		.orderBy("created_at")
		.execute();

	return mergeToolTraceRows(
		rows.map((r) => ({
			column_slug: r.column_slug,
			tool_name: r.tool_name,
			input: r.input,
			result: r.result,
			error_code: r.error_code,
			attempt: r.attempt,
			created_at: r.created_at ? r.created_at.toISOString() : null,
		})),
	);
}

// ---------------------------------------------------------------------------
// Exported helper for insertColumns — testable without a live pool
// ---------------------------------------------------------------------------

export async function runInsertColumns(
	dbExec: DBExecutor,
	data: {
		boardId: number;
		workspaceId: number;
		columns: Array<Record<string, unknown>>;
	},
): Promise<void> {
	for (const col of data.columns) {
		const tools = col.tools as string[] | undefined;
		const toolBudget = col.tool_budget as number | undefined;
		await dbExec
			.insertInto("columns")
			.values({
				title: col.name as string,
				position: col.position as number,
				board_id: data.boardId,
				slug: col.slug as string,
				reasoning: col.reasoning as boolean,
				system_prompt: col.system_prompt as string,
				workspace_id: data.workspaceId,
				tools: tools ?? [],
				tool_budget: toolBudget ?? null,
			})
			.execute();
	}
}

// ---------------------------------------------------------------------------
// Artifact DB helpers — exported for unit tests
// ---------------------------------------------------------------------------

export const realArtifactDeps = {
	insertArtifact: async (
		dbExec: DBExecutor,
		data: {
			boardId: number;
			workspaceId: number;
			filename: string;
			format: "md";
			content: string;
		},
	): Promise<void> => {
		await dbExec
			.insertInto("agent_artifacts")
			.values({
				board_id: data.boardId,
				workspace_id: data.workspaceId,
				filename: data.filename,
				format: data.format,
				content: data.content,
			})
			.onConflict((oc) =>
				oc.column("board_id").doUpdateSet((eb) => ({
					filename: eb.ref("excluded.filename"),
					content: eb.ref("excluded.content"),
					format: eb.ref("excluded.format"),
					created_at: sql`now()`,
				})),
			)
			.execute();
	},

	getArtifact: async (
		dbExec: DBExecutor,
		boardId: number,
	): Promise<{
		filename: string;
		format: "md";
		content: string;
	} | null> => {
		const row = await dbExec
			.selectFrom("agent_artifacts")
			.select(["filename", "format", "content"])
			.where("board_id", "=", boardId)
			.executeTakeFirst();
		if (!row) return null;
		return {
			filename: row.filename,
			format: row.format as "md",
			content: row.content,
		};
	},
};

export function buildArtifactDownload(data: {
	filename: string;
	content: string;
}): { headers: Record<string, string>; body: string } {
	return {
		headers: {
			"Content-Disposition": `attachment; filename="${data.filename}"`,
			"Content-Type": "text/markdown; charset=utf-8",
		},
		body: data.content,
	};
}

// ---------------------------------------------------------------------------
// Message payload detection — exported for unit tests
// ---------------------------------------------------------------------------

export type MessageAction =
	| { kind: "send"; message: string }
	| { kind: "confirm" }
	| { kind: "cancel" }
	| { kind: "invalid" };

export function resolveMessageAction(body: unknown): MessageAction {
	if (body && typeof body === "object") {
		const record = body as Record<string, unknown>;
		if (record.action === "confirm_regenerate") return { kind: "confirm" };
		if (record.action === "cancel_regenerate") return { kind: "cancel" };
		if (typeof record.message === "string") {
			const trimmed = record.message.trim();
			if (trimmed) return { kind: "send", message: trimmed };
		}
	}
	return { kind: "invalid" };
}

// ---------------------------------------------------------------------------
// Conversation / regenerate DB helpers — exported for unit tests
// ---------------------------------------------------------------------------

export async function selectConversationHistory(
	dbExec: DBExecutor,
	boardId: number,
): Promise<Array<{ role: string; content: string }>> {
	const rows = await dbExec
		.selectFrom("agent_conversations")
		.select(["role", "content"])
		.where("board_id", "=", boardId)
		.orderBy("created_at")
		.execute();
	return rows;
}

export async function deleteOutputsForBoard(
	dbExec: DBExecutor,
	boardId: number,
): Promise<void> {
	await dbExec
		.deleteFrom("agent_card_outputs")
		.where("board_id", "=", boardId)
		.execute();
}

export async function deleteCardsForBoard(
	dbExec: DBExecutor,
	boardId: number,
): Promise<void> {
	await dbExec
		.deleteFrom("cards")
		.where("column_id", "in", (eb) =>
			eb.selectFrom("columns").select("id").where("board_id", "=", boardId),
		)
		.execute();
}

// ---------------------------------------------------------------------------
// Real dependency implementations
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Board column allowlist — exported for unit tests
// ---------------------------------------------------------------------------

const ALLOWED_BOARD_COLUMNS = new Set([
	"status",
	"execution_status",
	"original_intent",
]);

export function validateBoardColumns(keys: string[]): void {
	for (const key of keys) {
		if (!ALLOWED_BOARD_COLUMNS.has(key)) {
			throw new Error(`updateBoard: illegal column "${key}"`);
		}
	}
}

// Workspace membership helper
// ---------------------------------------------------------------------------

async function lookupMembership(
	userId: number,
	workspaceId: number,
): Promise<string | null> {
	const row = await db
		.selectFrom("workspace_members")
		.select("role")
		.where("user_id", "=", userId)
		.where("workspace_id", "=", workspaceId)
		.executeTakeFirst();
	return row?.role ?? null;
}

const realDeps: AgentBoardServiceDeps = {
	classifyIntent: realClassifyIntent,
	classifyFollowUpIntent: realClassifyFollowUpIntent,
	executeCard: realExecuteCard,
	generateClarificationQuestion: realGenerateClarificationQuestion,
	detectReportPeriod: realDetectReportPeriod,
	toolRegistry: defaultToolRegistry,
	publishEvent: realPublishEvent as (
		workspaceId: number,
		event: Record<string, unknown>,
	) => Promise<void>,

	insertBoard: async (data) => {
		const inserted = await db
			.insertInto("agent_boards")
			.values({
				workspace_id: data.workspaceId,
				user_id: data.userId,
				template_id: data.templateId,
				original_intent: data.originalIntent,
				status: data.status,
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		return { id: inserted.id };
	},

	insertConversation: async (data) => {
		await db
			.insertInto("agent_conversations")
			.values({ board_id: data.boardId, role: data.role, content: data.content })
			.execute();
	},

	insertColumns: (data) =>
		runInsertColumns(db, data as Parameters<typeof runInsertColumns>[1]),

	getBoard: async (boardId) => {
		const r = await db
			.selectFrom("agent_boards")
			.select([
				"id",
				"workspace_id",
				"user_id",
				"template_id",
				"original_intent",
				"status",
				"execution_status",
				"created_at",
			])
			.where("id", "=", boardId)
			.executeTakeFirst();
		if (!r) return null;
		return {
			id: r.id,
			workspaceId: r.workspace_id,
			userId: r.user_id,
			templateId: r.template_id,
			originalIntent: r.original_intent,
			status: r.status,
			executionStatus: r.execution_status,
			createdAt: r.created_at.toISOString(),
		};
	},

	updateBoard: async (boardId, data) => {
		validateBoardColumns(Object.keys(data));
		await db
			.updateTable("agent_boards")
			.set({
				...(data as {
					status?: string;
					execution_status?: string;
					original_intent?: string;
				}),
				updated_at: sql`now()`,
			})
			.where("id", "=", boardId)
			.execute();
	},

	approveBoardAtomic: async (boardId) => {
		const result = await db
			.updateTable("agent_boards")
			.set({ status: "approved", execution_status: "running", updated_at: sql`now()` })
			.where("id", "=", boardId)
			.where("status", "=", "pending")
			.executeTakeFirst();
		return { rowCount: Number(result.numUpdatedRows ?? 0) };
	},

	listBoards: async (workspaceId) => {
		const rows = await db
			.selectFrom("agent_boards")
			.select([
				"id",
				"original_intent",
				"template_id",
				"status",
				"execution_status",
				"created_at",
			])
			.where("workspace_id", "=", workspaceId)
			.orderBy("created_at", "desc")
			.execute();
		return rows.map((r) => ({
			id: r.id,
			originalIntent: r.original_intent,
			templateId: r.template_id,
			status: r.status,
			executionStatus: r.execution_status,
			createdAt: r.created_at.toISOString(),
		}));
	},

	getFirstCard: async (boardId) => {
		const r = await db
			.selectFrom("columns")
			.select(["id", "slug", "system_prompt", "reasoning", "tools", "tool_budget"])
			.where("board_id", "=", boardId)
			.orderBy("position")
			.limit(1)
			.executeTakeFirst();
		if (!r) return null;
		return {
			columnId: r.id,
			columnSlug: r.slug as string,
			systemPrompt: r.system_prompt as string,
			reasoning: r.reasoning,
			tools: r.tools ?? [],
			toolBudget: r.tool_budget ?? null,
		};
	},

	getColumns: async (boardId) => {
		const rows = await db
			.selectFrom("columns")
			.select(["id", "slug", "system_prompt", "reasoning", "tools", "tool_budget"])
			.where("board_id", "=", boardId)
			.orderBy("position")
			.execute();
		return rows.map((r) => ({
			columnId: r.id,
			columnSlug: r.slug as string,
			systemPrompt: r.system_prompt as string,
			reasoning: r.reasoning,
			tools: r.tools ?? [],
			toolBudget: r.tool_budget ?? null,
		}));
	},

	insertCard: async (data) => {
		await db
			.insertInto("cards")
			.values({
				column_id: data.columnId,
				title: data.title,
				position: data.position,
				workspace_id: data.workspaceId,
			})
			.execute();
	},

	insertOutput: async (data) => {
		await db
			.insertInto("agent_card_outputs")
			.values({
				board_id: data.boardId,
				column_slug: data.columnSlug,
				card_index: data.cardIndex,
				output: data.output,
				thinking: data.thinking ?? null,
			})
			.execute();
	},

	insertToolCall: async (data) => {
		await db
			.insertInto("agent_tool_calls")
			.values({
				board_id: data.boardId,
				column_slug: data.columnSlug,
				tool_name: data.toolName,
				input: data.input !== null ? JSON.stringify(data.input) : null,
				result: data.result ?? null,
				error_code: data.errorCode ?? null,
				attempt: data.attempt ?? 1,
			})
			.execute();
	},

	getOutput: async (data) => {
		const row = await db
			.selectFrom("agent_card_outputs")
			.select(["output", "thinking"])
			.where("board_id", "=", data.boardId)
			.where("column_slug", "=", data.columnSlug)
			.orderBy("card_index")
			.limit(1)
			.executeTakeFirst();
		if (!row) return null;
		return { output: row.output, thinking: row.thinking };
	},

	insertArtifact: (data) => realArtifactDeps.insertArtifact(db, data),

	getArtifact: (boardId) => realArtifactDeps.getArtifact(db, boardId),

	getConversationHistory: (boardId) => selectConversationHistory(db, boardId),

	deleteOutputsForBoard: (boardId) => deleteOutputsForBoard(db, boardId),

	deleteCardsForBoard: (boardId) => deleteCardsForBoard(db, boardId),

	fetchCardTimestamps: async (workspaceId) => {
		const rows = await db
			.selectFrom("cards")
			.select(["created_at", "started_at", "done_at"])
			.where("workspace_id", "=", workspaceId)
			.where("deleted_at", "is", null)
			.execute();
		return rows.map((r) => ({
			createdAt: r.created_at,
			startedAt: r.started_at,
			doneAt: r.done_at,
		}));
	},

	fetchActivityEvents: async (workspaceId, limit) => {
		const rows = await db
			.selectFrom("card_events as e")
			.leftJoin("cards as c", (join) =>
				join.onRef("c.id", "=", "e.card_id").on("c.deleted_at", "is", null),
			)
			.select(["e.event_type", "e.payload", "e.created_at", "c.title as current_card_title"])
			.where("e.workspace_id", "=", workspaceId)
			.orderBy("e.created_at", "desc")
			.orderBy("e.id", "desc")
			.limit(limit)
			.execute();
		return rows.map((r) => {
			const payload = r.payload as { cardTitle?: string } | null;
			return {
				type: r.event_type,
				cardTitle: r.current_card_title ?? payload?.cardTitle ?? null,
				at: r.created_at.toISOString(),
			};
		});
	},
};

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createAgentRouter(
	overrides?: Partial<AgentBoardServiceDeps>,
): Router {
	const router = Router();
	const service = createAgentBoardService({ ...realDeps, ...overrides });

	// 2-minute socket timeout for agent routes (LLM calls can be slow)
	router.use(llmTimeout(120000));

	// Helper: check workspace membership and short-circuit with 404
	async function requireWorkspaceMember(
		req: Request,
		res: Parameters<Parameters<typeof router.get>[1]>[1],
		workspaceId: number,
	): Promise<boolean> {
		const membership = await lookupMembership(req.user!.id, workspaceId);
		if (!membership) {
			res.status(404).json({ error: "Not found" });
			return false;
		}
		return true;
	}

	// ---- POST /workspaces/:workspaceId/agent/boards ----
	router.post(
		"/workspaces/:workspaceId/agent/boards",
		requireAuth,
		async (req, res) => {
			const workspaceId = Number(req.params.workspaceId);
			if (!Number.isInteger(workspaceId)) {
				return res
					.status(400)
					.json({ error: "workspaceId must be an integer" });
			}

			const { intent } = req.body ?? {};
			if (typeof intent !== "string" || !intent.trim()) {
				return res.status(400).json({ error: "intent is required" });
			}

			try {
				if (!(await requireWorkspaceMember(req, res, workspaceId))) return;

				const result = await service.createBoard({
					workspaceId,
					userId: req.user!.id,
					intent: intent.trim(),
				});

				if ("status" in result && typeof result.status === "number") {
					return res.status(result.status).json({
						error: "message" in result ? result.message : "Request failed",
					});
				}
				res.status(201).json(result);
			} catch (err) {
				console.error("agent createBoard error:", err);
				res.status(500).json({ error: "Failed to create board" });
			}
		},
	);

	// ---- POST /workspaces/:workspaceId/agent/boards/:boardId/message ----
	router.post(
		"/workspaces/:workspaceId/agent/boards/:boardId/message",
		requireAuth,
		async (req, res) => {
			const workspaceId = Number(req.params.workspaceId);
			const boardId = Number(req.params.boardId);
			if (!Number.isInteger(workspaceId) || !Number.isInteger(boardId)) {
				return res.status(400).json({ error: "Invalid params" });
			}

			const action = resolveMessageAction(req.body);

			if (action.kind === "invalid") {
				return res.status(400).json({ error: "message or action is required" });
			}

			try {
				if (!(await requireWorkspaceMember(req, res, workspaceId))) return;

				const result =
					action.kind === "confirm"
						? await service.confirmRegenerateBoard({
								boardId,
								userId: req.user!.id,
								workspaceId,
							})
						: action.kind === "cancel"
							? await service.cancelRegenerateBoard({
									boardId,
									userId: req.user!.id,
									workspaceId,
								})
							: await service.sendMessage({
									boardId,
									userId: req.user!.id,
									workspaceId,
									message: action.message,
								});

				if ("status" in result && typeof result.status === "number") {
					return res.status(result.status).json(result);
				}
				res.json(result);
			} catch (err) {
				console.error("agent sendMessage error:", err);
				res.status(500).json({ error: "Failed to send message" });
			}
		},
	);

	// ---- POST /workspaces/:workspaceId/agent/boards/:boardId/approve ----
	router.post(
		"/workspaces/:workspaceId/agent/boards/:boardId/approve",
		requireAuth,
		async (req, res) => {
			const workspaceId = Number(req.params.workspaceId);
			const boardId = Number(req.params.boardId);
			if (!Number.isInteger(workspaceId) || !Number.isInteger(boardId)) {
				return res.status(400).json({ error: "Invalid params" });
			}

			try {
				if (!(await requireWorkspaceMember(req, res, workspaceId))) return;

				const result = await service.approveBoard({
					boardId,
					userId: req.user!.id,
					workspaceId,
				});

				if (result && "status" in result && typeof result.status === "number") {
					return res.status(result.status).json(result);
				}

				// Fire-and-forget execution — client receives progress via SSE
				service.runPipeline({ boardId, workspaceId }).catch((err) => {
					console.error("agent runPipeline error:", err);
				});

				res.json({ ok: true });
			} catch (err) {
				console.error("agent approveBoard error:", err);
				res.status(500).json({ error: "Failed to approve board" });
			}
		},
	);

	// ---- GET /workspaces/:workspaceId/agent/boards ----
	router.get(
		"/workspaces/:workspaceId/agent/boards",
		requireAuth,
		async (req, res) => {
			const workspaceId = Number(req.params.workspaceId);
			if (!Number.isInteger(workspaceId)) {
				return res
					.status(400)
					.json({ error: "workspaceId must be an integer" });
			}

			try {
				if (!(await requireWorkspaceMember(req, res, workspaceId))) return;

				const boards = await service.getBoards({ workspaceId });
				res.json(boards);
			} catch (err) {
				console.error("agent getBoards error:", err);
				res.status(500).json({ error: "Failed to list boards" });
			}
		},
	);

	// ---- GET /workspaces/:workspaceId/agent/boards/:id ----
	router.get(
		"/workspaces/:workspaceId/agent/boards/:id",
		requireAuth,
		async (req, res) => {
			const workspaceId = Number(req.params.workspaceId);
			const boardId = Number(req.params.id);
			if (!Number.isInteger(workspaceId) || !Number.isInteger(boardId)) {
				return res.status(400).json({ error: "Invalid params" });
			}

			try {
				if (!(await requireWorkspaceMember(req, res, workspaceId))) return;

				const result = await service.getBoardById({ boardId, workspaceId });
				if (
					!result ||
					("status" in result && typeof result.status === "number")
				) {
					const statusCode =
						result && "status" in result && typeof result.status === "number"
							? result.status
							: 404;
					return res.status(statusCode).json(result ?? { error: "Not found" });
				}

				// Fetch columns + cards for this agent board
				const colRows = await db
					.selectFrom("columns")
					.select(["id", "title", "position", "slug", "reasoning", "system_prompt"])
					.where("board_id", "=", boardId)
					.orderBy("position")
					.execute();
				const columns = [];
				for (const col of colRows) {
					const cardRows = await db
						.selectFrom("cards")
						.select(["id", "column_id", "title", "position"])
						.where("column_id", "=", col.id)
						.where("deleted_at", "is", null)
						.orderBy("position")
						.execute();
					columns.push({
						id: col.id,
						slug: col.slug,
						name: col.title,
						position: col.position,
						reasoning: col.reasoning,
						systemPrompt: col.system_prompt,
						cards: cardRows.map((c) => ({
							id: c.id,
							columnId: c.column_id,
							title: c.title,
							position: c.position,
						})),
					});
				}

				// Fetch stored tool trace (read-only replay)
				const toolTrace = await getToolTrace(db, boardId);
				const conversations = await selectConversationHistory(db, boardId);

				res.json({ ...result, columns, toolTrace, conversations });
			} catch (err) {
				console.error("agent getBoardById error:", err);
				res.status(500).json({ error: "Failed to get board" });
			}
		},
	);

	// ---- GET /workspaces/:workspaceId/agent/boards/:boardId/outputs/:columnSlug ----
	router.get(
		"/workspaces/:workspaceId/agent/boards/:boardId/outputs/:columnSlug",
		requireAuth,
		async (req, res) => {
			const workspaceId = Number(req.params.workspaceId);
			const boardId = Number(req.params.boardId);
			const columnSlug = req.params.columnSlug as string;
			if (!Number.isInteger(workspaceId) || !Number.isInteger(boardId)) {
				return res.status(400).json({ error: "Invalid params" });
			}

			try {
				if (!(await requireWorkspaceMember(req, res, workspaceId))) return;

				const result = await service.getCardOutput({
					boardId,
					columnSlug,
					workspaceId,
				});

				if ("status" in result && typeof result.status === "number") {
					return res.status(result.status).json(result);
				}
				res.json(result);
			} catch (err) {
				console.error("agent getCardOutput error:", err);
				res.status(500).json({ error: "Failed to get output" });
			}
		},
	);

	// ---- GET /workspaces/:workspaceId/agent/boards/:boardId/artifact ----
	router.get(
		"/workspaces/:workspaceId/agent/boards/:boardId/artifact",
		requireAuth,
		async (req, res) => {
			const workspaceId = Number(req.params.workspaceId);
			const boardId = Number(req.params.boardId);
			if (!Number.isInteger(workspaceId) || !Number.isInteger(boardId)) {
				return res.status(400).json({ error: "Invalid params" });
			}

			try {
				if (!(await requireWorkspaceMember(req, res, workspaceId))) return;

				const result = await service.getArtifact({ boardId, workspaceId });

				if ("status" in result && typeof result.status === "number") {
					return res.status(result.status).json(result);
				}
				res.json(result);
			} catch (err) {
				console.error("agent getArtifact error:", err);
				res.status(500).json({ error: "Failed to get artifact" });
			}
		},
	);

	// ---- GET /workspaces/:workspaceId/agent/boards/:boardId/artifact/download ----
	router.get(
		"/workspaces/:workspaceId/agent/boards/:boardId/artifact/download",
		requireAuth,
		async (req, res) => {
			const workspaceId = Number(req.params.workspaceId);
			const boardId = Number(req.params.boardId);
			if (!Number.isInteger(workspaceId) || !Number.isInteger(boardId)) {
				return res.status(400).json({ error: "Invalid params" });
			}

			try {
				if (!(await requireWorkspaceMember(req, res, workspaceId))) return;

				const result = await service.getArtifact({ boardId, workspaceId });

				if ("status" in result) {
					return res.status(result.status).json(result);
				}

				const { headers, body } = buildArtifactDownload({
					filename: result.filename,
					content: result.content,
				});
				res.set(headers).send(body);
			} catch (err) {
				console.error("agent downloadArtifact error:", err);
				res.status(500).json({ error: "Failed to download artifact" });
			}
		},
	);

	return router;
}
