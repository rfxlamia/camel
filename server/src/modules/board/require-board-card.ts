import { sql } from "kysely";
import type { DBExecutor } from "../../db/kysely.js";

/**
 * Workspace-scoped lookup of a live board card. Column-less items (tracker-native
 * rows with `cards.column_id IS NULL`) are not board cards and resolve to `null`,
 * so every `/cards/*` route reports them with its existing 404 not-found shape.
 *
 * Pass `lock: true` inside a transaction to take `FOR UPDATE`.
 */
export async function requireBoardCard(
	dbExec: DBExecutor,
	workspaceId: number,
	cardId: number,
	opts: { lock?: boolean } = {},
) {
	let query = dbExec
		.selectFrom("cards")
		.select([
			"id",
			"title",
			"column_id",
			"version",
			"started_at",
			"done_at",
			"project_id",
			sql<string | null>`due_date::text`.as("due_date"),
		])
		.where("id", "=", cardId)
		.where("workspace_id", "=", workspaceId)
		.where("column_id", "is not", null)
		.where("deleted_at", "is", null);
	if (opts.lock) query = query.forUpdate();
	const row = await query.executeTakeFirst();
	if (!row || row.column_id === null) return null;
	return { ...row, column_id: row.column_id };
}
