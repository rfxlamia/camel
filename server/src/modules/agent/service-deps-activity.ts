import { db } from "../../db/kysely.js";
import { resolveEventTitle } from "../../lib/event-title.js";
import type { AgentBoardServiceDeps } from "./service.js";
import type { ActivityItem } from "./tools/queryBoardData.js";

type ActivityRow = {
	event_type: string;
	payload: unknown;
	created_at: Date;
	current_card_title: string | null;
};

export function toActivityItem(r: ActivityRow): ActivityItem {
	return {
		type: r.event_type,
		cardTitle: r.current_card_title ?? resolveEventTitle(r.payload),
		at: r.created_at.toISOString(),
	};
}

export const activityDeps: Pick<
	AgentBoardServiceDeps,
	"fetchCardTimestamps" | "fetchActivityEvents"
> = {
	fetchCardTimestamps: async (workspaceId) => {
		const rows = await db
			.selectFrom("cards")
			.select(["created_at", "started_at", "done_at"])
			.where("workspace_id", "=", workspaceId)
			.where("deleted_at", "is", null)
			.where("column_id", "is not", null)
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
			.select([
				"e.event_type",
				"e.payload",
				"e.created_at",
				"c.title as current_card_title",
			])
			.where("e.workspace_id", "=", workspaceId)
			.orderBy("e.created_at", "desc")
			.orderBy("e.id", "desc")
			.limit(limit)
			.execute();
		return rows.map(toActivityItem);
	},
};
