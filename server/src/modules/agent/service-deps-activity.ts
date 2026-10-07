import { db } from "../../db/kysely.js";
import type { AgentBoardServiceDeps } from "./service.js";

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
