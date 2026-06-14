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
 *
 * requireAuth is per-route (NOT router-level) to avoid double-mounting
 * when both this and the existing api router are on /api.
 *
 * CRITICAL: Agent card execution output writes to agent_card_outputs,
 * NOT card_events — human Activity Feed must stay clean.
 */

import { Router } from "express";
import type { Request } from "express";
import { requireAuth } from "../auth.js";
import { pool } from "../db/pool.js";
import { publishEvent as realPublishEvent } from "../realtime.js";
import {
	classifyIntent as realClassifyIntent,
	executeCard as realExecuteCard,
	generateClarificationQuestion as realGenerateClarificationQuestion,
} from "./llm.js";
import {
	createAgentBoardService,
	type AgentBoardServiceDeps,
} from "./service.js";

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
	executeCard: realExecuteCard,
	generateClarificationQuestion: realGenerateClarificationQuestion,
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

	insertColumns: async (data) => {
		for (const col of data.columns) {
			await pool.query(
				`INSERT INTO columns (title, position, board_id, slug, reasoning, system_prompt, workspace_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				[
					col.name,
					col.position,
					data.boardId,
					col.slug,
					col.reasoning,
					col.system_prompt,
					data.workspaceId,
				],
			);
		}
	},

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
			`SELECT slug, system_prompt, reasoning
       FROM columns
       WHERE board_id = $1
       ORDER BY position
       LIMIT 1`,
			[boardId],
		);
		if (rows.length === 0) return null;
		return {
			columnSlug: rows[0].slug,
			systemPrompt: rows[0].system_prompt,
			reasoning: rows[0].reasoning,
		};
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
};

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createAgentRouter(
	overrides?: Partial<AgentBoardServiceDeps>,
): Router {
	const router = Router();
	const service = createAgentBoardService({ ...realDeps, ...overrides });

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
					return res.status(result.status).json(result);
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

			const { message } = req.body ?? {};
			if (typeof message !== "string" || !message.trim()) {
				return res.status(400).json({ error: "message is required" });
			}

			try {
				if (!(await requireWorkspaceMember(req, res, workspaceId))) return;

				const result = await service.sendMessage({
					boardId,
					userId: req.user!.id,
					workspaceId,
					message: message.trim(),
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
				service.triggerExecution({ boardId, workspaceId }).catch((err) => {
					console.error("agent triggerExecution error:", err);
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

				res.json({ ...result, columns });
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

	return router;
}
