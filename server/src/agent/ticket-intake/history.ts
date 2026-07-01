import type { Queryable } from "../../routes/helpers.js";

export type TicketHistoryEntry = {
	title: string;
	issueUrl: string;
	createdAt: Date;
};

export async function getTicketHistory(
	db: Queryable,
	workspaceId: number,
	cardId: number,
): Promise<TicketHistoryEntry[]> {
	const { rows } = await db.query(
		`SELECT payload, created_at FROM card_events WHERE workspace_id = $1 AND card_id = $2 AND event_type = 'linear_ticket_created' ORDER BY created_at DESC`,
		[workspaceId, cardId],
	);

	return rows.map((row) => {
		const payload = row.payload as { title?: string; issueUrl?: string };
		return {
			title: payload.title ?? "",
			issueUrl: payload.issueUrl ?? "",
			createdAt: row.created_at as Date,
		};
	});
}
