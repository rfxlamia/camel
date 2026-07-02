import type { DBExecutor } from "../../db/kysely.js";

export type TicketHistoryEntry = {
	title: string;
	issueUrl: string;
	createdAt: Date;
};

export async function getTicketHistory(
	dbExec: DBExecutor,
	workspaceId: number,
	cardId: number,
): Promise<TicketHistoryEntry[]> {
	const rows = await dbExec
		.selectFrom("card_events")
		.select(["payload", "created_at"])
		.where("workspace_id", "=", workspaceId)
		.where("card_id", "=", cardId)
		.where("event_type", "=", "linear_ticket_created")
		.orderBy("created_at", "desc")
		.execute();

	return rows.map((row) => {
		const payload = row.payload as { title?: string; issueUrl?: string };
		return {
			title: payload.title ?? "",
			issueUrl: payload.issueUrl ?? "",
			createdAt: row.created_at,
		};
	});
}
