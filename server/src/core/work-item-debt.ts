import type { DBExecutor } from "../db/kysely.js";

export type KeyCollision = {
	workspaceId: number;
	keyNumber: number;
	cardId: number;
	trackerItemId: number;
};

export async function findKeyCollisions(
	dbExec: DBExecutor,
): Promise<KeyCollision[]> {
	const rows = await dbExec
		.selectFrom("cards as c")
		.innerJoin("tracker_items as ti", (join) =>
			join
				.onRef("ti.workspace_id", "=", "c.workspace_id")
				.onRef("ti.key_number", "=", "c.key_number"),
		)
		.select([
			"c.workspace_id",
			"c.key_number",
			"c.id as card_id",
			"ti.id as tracker_item_id",
		])
		.where("c.deleted_at", "is", null)
		.where("ti.deleted_at", "is", null)
		.where("c.key_number", "is not", null)
		.execute();

	return rows.map((row) => ({
		workspaceId: row.workspace_id,
		keyNumber: row.key_number as number,
		cardId: row.card_id,
		trackerItemId: row.tracker_item_id,
	}));
}
