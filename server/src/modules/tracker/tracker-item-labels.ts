import { diffIds } from "../../core/diff-ids.js";
import type { DBExecutor } from "../../db/kysely.js";

async function getTrackerItemLabelIds(
	dbExec: DBExecutor,
	trackerItemId: number,
): Promise<number[]> {
	const rows = await dbExec
		.selectFrom("tracker_item_labels")
		.select("vocabulary_id")
		.where("tracker_item_id", "=", trackerItemId)
		.orderBy("vocabulary_id")
		.execute();
	return rows.map((r) => r.vocabulary_id);
}

export async function syncTrackerItemLabels(
	dbExec: DBExecutor,
	trackerItemId: number,
	labelIds: number[],
): Promise<void> {
	const prev = await getTrackerItemLabelIds(dbExec, trackerItemId);
	const { added, removed } = diffIds(prev, labelIds);

	if (removed.length > 0) {
		await dbExec
			.deleteFrom("tracker_item_labels")
			.where("tracker_item_id", "=", trackerItemId)
			.where("vocabulary_id", "in", removed)
			.execute();
	}
	for (const vocabularyId of added) {
		await dbExec
			.insertInto("tracker_item_labels")
			.values({ tracker_item_id: trackerItemId, vocabulary_id: vocabularyId })
			.onConflict((oc) => oc.doNothing())
			.execute();
	}
}
