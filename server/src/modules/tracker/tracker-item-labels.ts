import { diffIds } from "../../core/diff-ids.js";
import type { DBExecutor } from "../../db/kysely.js";

async function getTrackerItemLabelIds(
	dbExec: DBExecutor,
	cardId: number,
): Promise<number[]> {
	const rows = await dbExec
		.selectFrom("card_labels")
		.select("vocabulary_id")
		.where("card_id", "=", cardId)
		.orderBy("vocabulary_id")
		.execute();
	return rows.map((r) => r.vocabulary_id);
}

/** Replace a Tracker item's labels; the item is a column-less cards row. */
export async function syncTrackerItemLabels(
	dbExec: DBExecutor,
	cardId: number,
	labelIds: number[],
): Promise<void> {
	const prev = await getTrackerItemLabelIds(dbExec, cardId);
	const { added, removed } = diffIds(prev, labelIds);

	if (removed.length > 0) {
		await dbExec
			.deleteFrom("card_labels")
			.where("card_id", "=", cardId)
			.where("vocabulary_id", "in", removed)
			.execute();
	}
	for (const vocabularyId of added) {
		await dbExec
			.insertInto("card_labels")
			.values({ card_id: cardId, vocabulary_id: vocabularyId })
			.onConflict((oc) => oc.doNothing())
			.execute();
	}
}
