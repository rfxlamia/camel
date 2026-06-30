import { Router } from "express";
import { pool } from "../db/pool.js";
import { domainBus, EVENTS } from "../events.js";
import { requireWorkspaceMember } from "../middleware/workspace.js";
import { registerPush } from "./service.js";
import {
	pushNotificationToUser,
	pushReadAllEvent,
	pushReadEvent,
	sseNotificationHandler,
} from "./sse.js";

registerPush(pushNotificationToUser);

export const notificationsRouter = Router({ mergeParams: true });

notificationsRouter.use(requireWorkspaceMember);

notificationsRouter.get("/", async (req, res) => {
	const workspaceId = Number(
		(req.params as { workspaceId: string }).workspaceId,
	);
	const userId = (req.user as { id: number }).id;
	const limit = Math.min(Number(req.query.limit ?? 50), 100);
	const cursor = req.query.cursor ? Number(req.query.cursor) : null;

	const { rows } = await pool.query(
		`SELECT * FROM notifications
     WHERE user_id = $1 AND workspace_id = $2
       ${cursor ? "AND id < $3" : ""}
     ORDER BY created_at DESC LIMIT ${cursor ? "$4" : "$3"}`,
		cursor ? [userId, workspaceId, cursor, limit] : [userId, workspaceId, limit],
	);

	const { rows: countRows } = await pool.query(
		"SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND workspace_id = $2 AND read_at IS NULL",
		[userId, workspaceId],
	);

	const notifications = rows.map((r) => ({
		id: r.id,
		type: r.type,
		title: r.title,
		body: r.body,
		cardId: r.card_id,
		boardId: r.board_id,
		actorId: r.actor_id,
		readAt: r.read_at,
		sourceDeleted: r.source_deleted,
		createdAt: r.created_at,
	}));

	res.json({
		notifications,
		unreadCount: Number(countRows[0]?.count ?? 0),
		nextCursor: rows.length === limit ? rows[rows.length - 1].id : null,
	});
});

notificationsRouter.patch("/:id/read", async (req, res) => {
	const userId = (req.user as { id: number }).id;
	const params = req.params as { workspaceId: string; id: string };
	const id = Number(params.id);
	const { rows, rowCount } = await pool.query(
		"UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL RETURNING id",
		[id, userId],
	);
	if (!rowCount) return res.status(404).json({ error: "Not found" });
	pushReadEvent(userId, Number(params.workspaceId), rows[0].id);
	res.json({ ok: true });
});

notificationsRouter.post("/read-all", async (req, res) => {
	const userId = (req.user as { id: number }).id;
	const workspaceId = Number(
		(req.params as { workspaceId: string }).workspaceId,
	);
	const { rowCount } = await pool.query(
		"UPDATE notifications SET read_at = now() WHERE user_id = $1 AND workspace_id = $2 AND read_at IS NULL",
		[userId, workspaceId],
	);
	pushReadAllEvent(userId, workspaceId);
	res.json({ ok: true, markedCount: rowCount ?? 0 });
});

notificationsRouter.get("/stream", sseNotificationHandler);

notificationsRouter.post("/system-alert", async (req, res) => {
	const workspaceId = Number(
		(req.params as { workspaceId: string }).workspaceId,
	);
	const actor = req.user as { id: number; role?: string };
	const { rows: memberRows } = await pool.query(
		"SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
		[workspaceId, actor.id],
	);
	if (!memberRows.length || !["admin", "owner"].includes(memberRows[0].role)) {
		return res.status(403).json({ error: "Admin or owner required" });
	}
	const { title, body } = req.body ?? {};
	if (typeof title !== "string" || !title.trim()) {
		return res.status(400).json({ error: "title is required" });
	}
	domainBus.emit(EVENTS.SYSTEM_ALERT, {
		type: EVENTS.SYSTEM_ALERT,
		workspaceId,
		actorId: actor.id,
		payload: { title: title.trim(), body: body ?? null },
	});
	res.status(202).json({ ok: true });
});
