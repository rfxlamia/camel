import { Router } from "express";
import { sql } from "kysely";
import { db } from "../db/kysely.js";
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

	const rows = await db
		.selectFrom("notifications")
		.selectAll()
		.where("user_id", "=", userId)
		.where("workspace_id", "=", workspaceId)
		.$if(cursor !== null, (qb) => qb.where("id", "<", cursor as number))
		.orderBy("created_at", "desc")
		.limit(limit)
		.execute();

	const countRow = await db
		.selectFrom("notifications")
		.select(sql<number>`count(*)::int`.as("count"))
		.where("user_id", "=", userId)
		.where("workspace_id", "=", workspaceId)
		.where("read_at", "is", null)
		.executeTakeFirstOrThrow();

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
		unreadCount: Number(countRow.count ?? 0),
		nextCursor: rows.length === limit ? rows[rows.length - 1].id : null,
	});
});

notificationsRouter.patch("/:id/read", async (req, res) => {
	const userId = (req.user as { id: number }).id;
	const params = req.params as { workspaceId: string; id: string };
	const id = Number(params.id);
	const updated = await db
		.updateTable("notifications")
		.set({ read_at: sql`now()` })
		.where("id", "=", id)
		.where("user_id", "=", userId)
		.where("read_at", "is", null)
		.returning("id")
		.executeTakeFirst();
	if (!updated) return res.status(404).json({ error: "Not found" });
	pushReadEvent(userId, Number(params.workspaceId), updated.id);
	res.json({ ok: true });
});

notificationsRouter.post("/read-all", async (req, res) => {
	const userId = (req.user as { id: number }).id;
	const workspaceId = Number(
		(req.params as { workspaceId: string }).workspaceId,
	);
	const result = await db
		.updateTable("notifications")
		.set({ read_at: sql`now()` })
		.where("user_id", "=", userId)
		.where("workspace_id", "=", workspaceId)
		.where("read_at", "is", null)
		.executeTakeFirst();
	pushReadAllEvent(userId, workspaceId);
	res.json({ ok: true, markedCount: Number(result.numUpdatedRows ?? 0) });
});

notificationsRouter.get("/stream", sseNotificationHandler);

notificationsRouter.post("/system-alert", async (req, res) => {
	const workspaceId = Number(
		(req.params as { workspaceId: string }).workspaceId,
	);
	const actor = req.user as { id: number; role?: string };
	const member = await db
		.selectFrom("workspace_members")
		.select("role")
		.where("workspace_id", "=", workspaceId)
		.where("user_id", "=", actor.id)
		.executeTakeFirst();
	if (!member || !["admin", "owner"].includes(member.role)) {
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
