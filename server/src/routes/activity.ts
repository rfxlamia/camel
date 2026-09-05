import { Router } from "express";
import { db } from "../db/kysely.js";
import { requireWorkspaceMember } from "../middleware/workspace.js";
import { getUnifiedWorkspaceActivity } from "./work-item-events.js";

function activitySelect() {
	return db
		.selectFrom("card_events as e")
		.leftJoin("users as u", "u.id", "e.actor_id")
		.leftJoin("cards as c", (join) =>
			join.onRef("c.id", "=", "e.card_id").on("c.deleted_at", "is", null),
		)
		.leftJoin("columns as fc", "fc.id", "e.from_column_id")
		.leftJoin("columns as tc", "tc.id", "e.to_column_id")
		.select([
			"e.id",
			"e.event_type",
			"e.payload",
			"e.created_at",
			"e.card_id",
			"u.username",
			"u.display_name",
			"c.title as current_card_title",
			"fc.title as from_column_title",
			"tc.title as to_column_title",
		]);
}

function toActivityEvent(e: {
	id: number;
	event_type: string;
	payload: unknown;
	created_at: Date;
	card_id: number | null;
	username: string | null;
	display_name: string | null;
	current_card_title: string | null;
	from_column_title: string | null;
	to_column_title: string | null;
}) {
	const payload = e.payload as { cardTitle?: string } | null;
	return {
		id: e.id,
		type: e.event_type,
		cardId: e.card_id,
		cardTitle: e.current_card_title ?? payload?.cardTitle ?? null,
		fromColumn: e.from_column_title,
		toColumn: e.to_column_title,
		actor: e.username
			? { username: e.username, displayName: e.display_name }
			: null,
		createdAt: e.created_at,
	};
}

export const activityRouter = Router({ mergeParams: true });

activityRouter.get("/activity", requireWorkspaceMember, async (req, res) => {
	const { workspaceId } = req.workspace!;

	const rawLimit = Number(req.query.limit);
	const limit =
		Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;
	const rows = await activitySelect()
		.where("e.workspace_id", "=", workspaceId)
		.where("e.event_type", "<>", "focus_session")
		.orderBy("e.created_at", "desc")
		.orderBy("e.id", "desc")
		.limit(limit)
		.execute();
	res.json({ events: rows.map(toActivityEvent) });
});

activityRouter.get(
	"/activity/unified",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;

		const rawLimit = Number(req.query.limit);
		const limit =
			Number.isInteger(rawLimit) && rawLimit > 0
				? Math.min(rawLimit, 200)
				: 50;
		const events = await getUnifiedWorkspaceActivity(workspaceId, limit);
		res.json({ events });
	},
);

activityRouter.get(
	"/cards/:id/activity",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;

		const cardId = Number(req.params.id);
		if (!Number.isInteger(cardId)) {
			return res.status(400).json({ error: "card id must be an integer" });
		}

		const cardCheck = await db
			.selectFrom("cards")
			.select("id")
			.where("id", "=", cardId)
			.where("workspace_id", "=", workspaceId)
			.where("deleted_at", "is", null)
			.executeTakeFirst();
		if (!cardCheck) {
			return res.status(404).json({ error: "Not found" });
		}

		const rows = await activitySelect()
			.where("e.card_id", "=", cardId)
			.where("e.workspace_id", "=", workspaceId)
			.orderBy("e.created_at", "desc")
			.orderBy("e.id", "desc")
			.execute();
		res.json({ events: rows.map(toActivityEvent) });
	},
);
