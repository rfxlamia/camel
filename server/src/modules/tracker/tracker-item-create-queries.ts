import { sql } from "kysely";
import { positionBetween } from "../../core/position.js";
import { derivePrefix } from "../../core/tracker-key.js";
import type { DBExecutor } from "../../db/kysely.js";

export async function workspacePrefix(
	dbExec: DBExecutor,
	workspaceId: number,
): Promise<string | null> {
	const row = await dbExec
		.selectFrom("workspaces")
		.select("name")
		.where("id", "=", workspaceId)
		.executeTakeFirst();
	return row ? derivePrefix(row.name) : null;
}

export async function backlogStatusId(
	dbExec: DBExecutor,
	workspaceId: number,
): Promise<number> {
	const row = await dbExec
		.selectFrom("tracker_vocabularies")
		.select("id")
		.where("workspace_id", "=", workspaceId)
		.where("kind", "=", "status")
		.where(sql`lower(name)`, "=", "backlog")
		.executeTakeFirst();
	if (!row) throw new Error("Backlog status not found for workspace");
	return row.id;
}

export async function statusCategory(
	dbExec: DBExecutor,
	workspaceId: number,
	statusId: number,
): Promise<string | null> {
	const row = await dbExec
		.selectFrom("tracker_vocabularies")
		.select("category")
		.where("id", "=", statusId)
		.where("workspace_id", "=", workspaceId)
		.where("kind", "=", "status")
		.executeTakeFirst();
	return row?.category ?? null;
}

export async function endOfBucketPosition(
	dbExec: DBExecutor,
	workspaceId: number,
	projectId: number | null,
	phaseId: number | null,
): Promise<number> {
	let query = dbExec
		.selectFrom("cards")
		.select(sql<number | null>`max(plan_position)`.as("max_position"))
		.where("workspace_id", "=", workspaceId)
		.where("column_id", "is", null)
		.where("deleted_at", "is", null);
	query =
		projectId === null
			? query.where("project_id", "is", null)
			: query.where("project_id", "=", projectId);
	query =
		phaseId === null
			? query.where("phase_id", "is", null)
			: query.where("phase_id", "=", phaseId);
	const row = await query.executeTakeFirst();
	return positionBetween(row?.max_position ?? null, null);
}

export async function syncLabels(
	dbExec: DBExecutor,
	cardId: number,
	labelIds: number[],
): Promise<void> {
	for (const vocabularyId of [...new Set(labelIds)]) {
		await dbExec
			.insertInto("card_labels")
			.values({ card_id: cardId, vocabulary_id: vocabularyId })
			.onConflict((oc) => oc.doNothing())
			.execute();
	}
}
