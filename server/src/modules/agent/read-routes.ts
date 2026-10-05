import type { Router } from "express";
import { requireAuth } from "../../auth.js";
import { db } from "../../db/kysely.js";
import { buildArtifactDownload } from "./artifact-db.js";
import {
	getToolTrace,
	loadAgentBoardColumns,
	selectConversationHistory,
} from "./board-db.js";
import { assertWorkspaceMember } from "./membership.js";
import type { createAgentBoardService } from "./service.js";

const COLUMN_SLUG_RE = /^[\w-]{1,100}$/;

function isValidColumnSlug(slug: unknown): slug is string {
	return typeof slug === "string" && COLUMN_SLUG_RE.test(slug);
}

export function registerReadRoutes(
	router: Router,
	service: ReturnType<typeof createAgentBoardService>,
): void {
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

			if (!(await assertWorkspaceMember(req, res, workspaceId))) return;

			const boards = await service.getBoards({ workspaceId });
			res.json(boards);
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

			if (!(await assertWorkspaceMember(req, res, workspaceId))) return;

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

			const columns = await loadAgentBoardColumns(db, boardId, workspaceId);

			// Fetch stored tool trace (read-only replay)
			const toolTrace = await getToolTrace(db, boardId);
			const conversations = await selectConversationHistory(db, boardId);

			res.json({ ...result, columns, toolTrace, conversations });
		},
	);

	// ---- GET /workspaces/:workspaceId/agent/boards/:boardId/outputs/:columnSlug ----
	router.get(
		"/workspaces/:workspaceId/agent/boards/:boardId/outputs/:columnSlug",
		requireAuth,
		async (req, res) => {
			const workspaceId = Number(req.params.workspaceId);
			const boardId = Number(req.params.boardId);
			const columnSlug = req.params.columnSlug;
			if (!Number.isInteger(workspaceId) || !Number.isInteger(boardId)) {
				return res.status(400).json({ error: "Invalid params" });
			}
			if (!isValidColumnSlug(columnSlug)) {
				return res.status(400).json({ error: "Invalid params" });
			}

			if (!(await assertWorkspaceMember(req, res, workspaceId))) return;

			const result = await service.getCardOutput({
				boardId,
				columnSlug,
				workspaceId,
			});

			if ("status" in result && typeof result.status === "number") {
				return res.status(result.status).json(result);
			}
			res.json(result);
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

			if (!(await assertWorkspaceMember(req, res, workspaceId))) return;

			const result = await service.getArtifact({ boardId, workspaceId });

			if ("status" in result && typeof result.status === "number") {
				return res.status(result.status).json(result);
			}
			res.json(result);
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

			if (!(await assertWorkspaceMember(req, res, workspaceId))) return;

			const result = await service.getArtifact({ boardId, workspaceId });

			if ("status" in result) {
				return res.status(result.status).json(result);
			}

			const { headers, body } = buildArtifactDownload({
				filename: result.filename,
				content: result.content,
			});
			res.set(headers).send(body);
		},
	);
}
