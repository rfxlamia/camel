import type { DBExecutor } from "../db/kysely.js";

/**
 * After a guarded write on a Tracker item (column-less `cards` row) matched no
 * row: the row still exists (stale version, conflict) or is gone (not_found).
 */
export async function classifyColumnlessWriteFailure(
	trx: DBExecutor,
	workspaceId: number,
	cardId: number,
): Promise<"conflict" | "not_found"> {
	const current = await trx
		.selectFrom("cards")
		.select("id")
		.where("id", "=", cardId)
		.where("workspace_id", "=", workspaceId)
		.where("column_id", "is", null)
		.where("deleted_at", "is", null)
		.executeTakeFirst();
	return current ? "conflict" : "not_found";
}
