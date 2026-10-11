import { sql } from "kysely";
import { type DBExecutor, db } from "../../db/kysely.js";
import { logger } from "../../lib/logger.js";

export async function recoverInterruptedAgentBoards(
	dbExec: DBExecutor = db,
): Promise<Array<{ boardId: number; workspaceId: number }>> {
	const rows = await dbExec
		.updateTable("agent_boards")
		.set({
			execution_status: "failed",
			updated_at: sql`now()`,
		})
		.where("execution_status", "=", "running")
		.returning(["id", "workspace_id"])
		.execute();

	const recovered = rows.map((row) => ({
		boardId: row.id,
		workspaceId: row.workspace_id,
	}));
	if (recovered.length > 0) {
		logger.warn(
			{ recoveredBoards: recovered },
			"Marked interrupted agent board runs as failed",
		);
	}
	return recovered;
}
