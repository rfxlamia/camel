import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireWorkspaceMember } from "../middleware/workspace.js";

const ACTIVITY_SELECT = `
  SELECT e.id, e.event_type, e.payload, e.created_at, e.card_id,
         u.username, u.display_name,
         c.title AS current_card_title,
         fc.title AS from_column_title,
         tc.title AS to_column_title
  FROM card_events e
  LEFT JOIN users u ON u.id = e.actor_id
  LEFT JOIN cards c ON c.id = e.card_id AND c.deleted_at IS NULL
  LEFT JOIN columns fc ON fc.id = e.from_column_id
  LEFT JOIN columns tc ON tc.id = e.to_column_id`;

function toActivityEvent(e: {
	id: number;
	event_type: string;
	payload: { cardTitle?: string } | null;
	created_at: Date;
	card_id: number | null;
	username: string | null;
	display_name: string | null;
	current_card_title: string | null;
	from_column_title: string | null;
	to_column_title: string | null;
}) {
	return {
		id: e.id,
		type: e.event_type,
		cardId: e.card_id,
		cardTitle: e.current_card_title ?? e.payload?.cardTitle ?? null,
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

	const limit = Math.min(Number(req.query.limit) || 50, 200);
	const { rows } = await pool.query(
		`${ACTIVITY_SELECT}
     WHERE e.workspace_id = $1
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT $2`,
		[workspaceId, limit],
	);
	res.json({ events: rows.map(toActivityEvent) });
});

activityRouter.get(
	"/cards/:id/activity",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;

		const cardId = Number(req.params.id);
		if (!Number.isInteger(cardId)) {
			return res.status(400).json({ error: "card id must be an integer" });
		}

		const cardCheck = await pool.query(
			"SELECT id FROM cards WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL",
			[cardId, workspaceId],
		);
		if (cardCheck.rows.length === 0) {
			return res.status(404).json({ error: "Not found" });
		}

		const { rows } = await pool.query(
			`${ACTIVITY_SELECT}
     WHERE e.card_id = $1 AND e.workspace_id = $2
     ORDER BY e.created_at DESC, e.id DESC`,
			[cardId, workspaceId],
		);
		res.json({ events: rows.map(toActivityEvent) });
	},
);
