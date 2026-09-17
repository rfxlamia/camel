import { derivePrefix } from "../../core/tracker-key.js";
import { type DBExecutor } from "../../db/kysely.js";
import {
	type BoardWorkItemRow,
	findBoardCardByKeyNumber,
	findTrackerItemByKeyNumber,
	hydrateBoardWorkItems,
	hydrateTrackerWorkItems,
} from "../../lib/work-item-response.js";

export function routeKeyParam(raw: string | string[]): string {
	return Array.isArray(raw) ? (raw[0] ?? "") : raw;
}

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

export async function resolveWorkItemByKey(
	dbExec: DBExecutor,
	workspaceId: number,
	keyNumber: number,
	prefix: string,
	redirectFrom?: string,
) {
	const trackerRow = await findTrackerItemByKeyNumber(
		dbExec,
		workspaceId,
		keyNumber,
	);
	if (trackerRow) {
		const [item] = await hydrateTrackerWorkItems(dbExec, [trackerRow], prefix);
		if (redirectFrom) {
			return { ...item, canonicalKey: item.key, redirectFrom };
		}
		return item;
	}

	const boardRow = await findBoardCardByKeyNumber(
		dbExec,
		workspaceId,
		keyNumber,
	);
	if (!boardRow || boardRow.key_number == null) return null;

	const [item] = await hydrateBoardWorkItems(
		dbExec,
		[boardRow as BoardWorkItemRow],
		prefix,
	);
	if (redirectFrom) {
		return { ...item, canonicalKey: item.key, redirectFrom };
	}
	return item;
}
