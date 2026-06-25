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
import { requireAuth } from "../auth.js";
import { pool } from "../db/pool.js";
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
	db: {
		query: (
			sql: string,
			params: unknown[],
		) => Promise<{ rows: Array<Record<string, unknown>> }>;
	},
	boardId: number,
): Promise<ToolTraceItem[]> {
	const { rows } = await db.query(
		`SELECT column_slug, tool_name, input, result, error_code, attempt, created_at
		 FROM agent_tool_calls
		 WHERE board_id = $1
		 ORDER BY created_at`,
		[boardId],
	);

	return mergeToolTraceRows(
		rows.map((r) => ({
			column_slug: r.column_slug as string,
			tool_name: r.tool_name as string,
			input: r.input,
			result: r.result as string | null,
			error_code: r.error_code as string | null,
			attempt: r.attempt as number | null,
			created_at: r.created_at as string | null,
		})),
	);
}

// ---------------------------------------------------------------------------
// Exported helper for insertColumns — testable without a live pool
// ---------------------------------------------------------------------------

export async function runInsertColumns(
	db: { query: (sql: string, params: unknown[]) => Promise<unknown> },
	data: {
		boardId: number;
		workspaceId: number;
		columns: Array<Record<string, unknown>>;
	},
): Promise<void> {
	for (const col of data.columns) {
		const tools = col.tools as string[] | undefined;
		const toolBudget = col.tool_budget as number | undefined;
		await db.query(
			`INSERT INTO columns (title, position, board_id, slug, reasoning, system_prompt, workspace_id, tools, tool_budget)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			[
				col.name,
				col.position,
				data.boardId,
				col.slug,
				col.reasoning,
				col.system_prompt,
				data.workspaceId,
				tools ?? [],
				toolBudget ?? null,
			],
		);
	}
}

// ---------------------------------------------------------------------------
// Artifact DB helpers — exported for unit tests
// ---------------------------------------------------------------------------

export const realArtifactDeps = {
	insertArtifact: async (
		db: { query: (sql: string, params: unknown[]) => Promise<unknown> },
		data: {
			boardId: number;
			workspaceId: number;
			filename: string;
			format: "md";
			content: string;
		},
	): Promise<void> => {
		await db.query(
			`INSERT INTO agent_artifacts (board_id, workspace_id, filename, format, content)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (board_id) DO UPDATE SET
         filename = EXCLUDED.filename,
         content = EXCLUDED.content,
         format = EXCLUDED.format,
         created_at = now()`,
			[
				data.boardId,
				data.workspaceId,
				data.filename,
				data.format,
				data.content,
			],
		);
	},

	getArtifact: async (
		db: {
			query: (
				sql: string,
				params: unknown[],
			) => Promise<{ rows: Array<Record<string, unknown>> }>;
		},
		boardId: number,
	): Promise<{
		filename: string;
		format: "md";
		content: string;
	} | null> => {
		const { rows } = await db.query(
			`SELECT filename, format, content
       FROM agent_artifacts
       WHERE board_id = $1`,
			[boardId],
		);
		if (rows.length === 0) return null;
		return {
			filename: rows[0].filename as string,
			format: rows[0].format as "md",
			content: rows[0].content as string,
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
	db: {
		query: (
			sql: string,
			params: unknown[],
		) => Promise<{ rows: Array<Record<string, unknown>> }>;
	},
	boardId: number,
): Promise<Array<{ role: string; content: string }>> {
	const { rows } = await db.query(
		`SELECT role, content
     FROM agent_conversations
     WHERE board_id = $1
     ORDER BY created_at`,
		[boardId],
	);
	return rows.map((r) => ({
		role: r.role as string,
		content: r.content as string,
	}));
}

export async function deleteOutputsForBoard(
	db: { query: (sql: string, params: unknown[]) => Promise<unknown> },
	boardId: number,
): Promise<void> {
	await db.query(`DELETE FROM agent_card_outputs WHERE board_id = $1`, [
		boardId,
	]);
}

export async function deleteCardsForBoard(
	db: { query: (sql: string, params: unknown[]) => Promise<unknown> },
	boardId: number,
): Promise<void> {
	await db.query(
		`DELETE FROM cards
     WHERE column_id IN (SELECT id FROM columns WHERE board_id = $1)`,
		[boardId],
	);
}

// ---------------------------------------------------------------------------
// Real dependency implementations
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Workspace membership helper
// ---------------------------------------------------------------------------

async function lookupMembership(
	userId: number,
	workspaceId: number,
): Promise<string | null> {
	const { rows } = await pool.query(
		`SELECT role FROM workspace_members WHERE user_id = $1 AND workspace_id = $2`,
		[userId, workspaceId],
	);
	return rows.length > 0 ? rows[0].role : null;
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
		const { rows } = await pool.query(
			`INSERT INTO agent_boards (workspace_id, user_id, template_id, original_intent, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
			[
				data.workspaceId,
				data.userId,
				data.templateId,
				data.originalIntent,
				data.status,
			],
		);
		return { id: rows[0].id };
	},

	insertConversation: async (data) => {
		await pool.query(
			`INSERT INTO agent_conversations (board_id, role, content)
       VALUES ($1, $2, $3)`,
			[data.boardId, data.role, data.content],
		);
	},

	insertColumns: (data) =>
		runInsertColumns(pool, data as Parameters<typeof runInsertColumns>[1]),

	getBoard: async (boardId) => {
		const { rows } = await pool.query(
			`SELECT id, workspace_id, user_id, template_id, original_intent,
              status, execution_status, created_at
       FROM agent_boards WHERE id = $1`,
			[boardId],
		);
		if (rows.length === 0) return null;
		const r = rows[0];
		return {
			id: r.id,
			workspaceId: r.workspace_id,
			userId: r.user_id,
			templateId: r.template_id,
			originalIntent: r.original_intent,
			status: r.status,
			executionStatus: r.execution_status,
			createdAt: r.created_at,
		};
	},

	updateBoard: async (boardId, data) => {
		const sets: string[] = [];
		const values: unknown[] = [];
		let i = 1;
		for (const [key, value] of Object.entries(data)) {
			sets.push(`${key} = $${i}`);
			values.push(value);
			i++;
		}
		sets.push("updated_at = now()");
		values.push(boardId);
		await pool.query(
			`UPDATE agent_boards SET ${sets.join(", ")} WHERE id = $${i}`,
			values,
		);
	},

	approveBoardAtomic: async (boardId) => {
		const { rowCount } = await pool.query(
			`UPDATE agent_boards
			 SET status = 'approved', execution_status = 'running', updated_at = now()
			 WHERE id = $1 AND status = 'pending'
			 RETURNING id`,
			[boardId],
		);
		return { rowCount: rowCount ?? 0 };
	},

	listBoards: async (workspaceId) => {
		const { rows } = await pool.query(
			`SELECT id, original_intent, template_id, status, execution_status, created_at
       FROM agent_boards
       WHERE workspace_id = $1
       ORDER BY created_at DESC`,
			[workspaceId],
		);
		return rows.map((r: Record<string, unknown>) => ({
			id: r.id as number,
			originalIntent: r.original_intent as string,
			templateId: r.template_id as string,
			status: r.status as string,
			executionStatus: r.execution_status as string,
			createdAt: r.created_at as string,
		}));
	},

	getFirstCard: async (boardId) => {
		const { rows } = await pool.query(
			`SELECT id, slug, system_prompt, reasoning, tools, tool_budget
       FROM columns
       WHERE board_id = $1
       ORDER BY position
       LIMIT 1`,
			[boardId],
		);
		if (rows.length === 0) return null;
		return {
			columnId: rows[0].id,
			columnSlug: rows[0].slug,
			systemPrompt: rows[0].system_prompt,
			reasoning: rows[0].reasoning,
			tools: (rows[0].tools as string[] | null) ?? [],
			toolBudget: (rows[0].tool_budget as number | null) ?? null,
		};
	},

	getColumns: async (boardId) => {
		const { rows } = await pool.query(
			`SELECT id, slug, system_prompt, reasoning, tools, tool_budget
     FROM columns
     WHERE board_id = $1
     ORDER BY position`,
			[boardId],
		);
		return rows.map((r: Record<string, unknown>) => ({
			columnId: r.id as number,
			columnSlug: r.slug as string,
			systemPrompt: r.system_prompt as string,
			reasoning: r.reasoning as boolean,
			tools: (r.tools as string[] | null) ?? [],
			toolBudget: (r.tool_budget as number | null) ?? null,
		}));
	},

	insertCard: async (data) => {
		await pool.query(
			`INSERT INTO cards (column_id, title, position, workspace_id)
       VALUES ($1, $2, $3, $4)`,
			[data.columnId, data.title, data.position, data.workspaceId],
		);
	},

	insertOutput: async (data) => {
		await pool.query(
			`INSERT INTO agent_card_outputs (board_id, column_slug, card_index, output, thinking)
       VALUES ($1, $2, $3, $4, $5)`,
			[
				data.boardId,
				data.columnSlug,
				data.cardIndex,
				data.output,
				data.thinking ?? null,
			],
		);
	},

	insertToolCall: async (data) => {
		await pool.query(
			`INSERT INTO agent_tool_calls (board_id, column_slug, tool_name, input, result, error_code, attempt)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			[
				data.boardId,
				data.columnSlug,
				data.toolName,
				data.input !== null ? JSON.stringify(data.input) : null,
				data.result ?? null,
				data.errorCode ?? null,
				data.attempt ?? 1,
			],
		);
	},

	getOutput: async (data) => {
		const { rows } = await pool.query(
			`SELECT output, thinking
       FROM agent_card_outputs
       WHERE board_id = $1 AND column_slug = $2
       ORDER BY card_index
       LIMIT 1`,
			[data.boardId, data.columnSlug],
		);
		if (rows.length === 0) return null;
		return { output: rows[0].output, thinking: rows[0].thinking };
	},

	insertArtifact: (data) => realArtifactDeps.insertArtifact(pool, data),

	getArtifact: (boardId) => realArtifactDeps.getArtifact(pool, boardId),

	getConversationHistory: (boardId) => selectConversationHistory(pool, boardId),

	deleteOutputsForBoard: (boardId) => deleteOutputsForBoard(pool, boardId),

	deleteCardsForBoard: (boardId) => deleteCardsForBoard(pool, boardId),

	fetchCardTimestamps: async (workspaceId) => {
		const { rows } = await pool.query(
			`SELECT created_at, started_at, done_at
       FROM cards
       WHERE workspace_id = $1 AND deleted_at IS NULL`,
			[workspaceId],
		);
		return rows.map((r: Record<string, unknown>) => ({
			createdAt: r.created_at as Date,
			startedAt: r.started_at as Date | null,
			doneAt: r.done_at as Date | null,
		}));
	},

	fetchActivityEvents: async (workspaceId, limit) => {
		const { rows } = await pool.query(
			`SELECT e.event_type, e.payload, e.created_at,
              c.title AS current_card_title
       FROM card_events e
       LEFT JOIN cards c ON c.id = e.card_id AND c.deleted_at IS NULL
       WHERE e.workspace_id = $1
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT $2`,
			[workspaceId, limit],
		);
		return rows.map((r: Record<string, unknown>) => {
			const payload = r.payload as { cardTitle?: string } | null;
			return {
				type: r.event_type as string,
				cardTitle:
					(r.current_card_title as string | null) ?? payload?.cardTitle ?? null,
				at: (r.created_at as Date).toISOString(),
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
				const colsRes = await pool.query(
					`SELECT id, title, position, slug, reasoning, system_prompt
				 FROM columns WHERE board_id = $1 ORDER BY position`,
					[boardId],
				);
				const columns = [];
				for (const col of colsRes.rows) {
					const cardsRes = await pool.query(
						`SELECT id, column_id, title, position
					 FROM cards WHERE column_id = $1 AND deleted_at IS NULL ORDER BY position`,
						[col.id],
					);
					columns.push({
						id: col.id,
						slug: col.slug,
						name: col.title,
						position: col.position,
						reasoning: col.reasoning,
						systemPrompt: col.system_prompt,
						cards: cardsRes.rows.map((c: Record<string, unknown>) => ({
							id: c.id,
							columnId: c.column_id,
							title: c.title,
							position: c.position,
						})),
					});
				}

				// Fetch stored tool trace (read-only replay)
				const toolTrace = await getToolTrace(pool, boardId);
				const conversations = await selectConversationHistory(pool, boardId);

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
