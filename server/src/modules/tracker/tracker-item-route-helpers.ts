import { derivePrefix } from "../../core/tracker-key.js";
import { type DBExecutor } from "../../db/kysely.js";
import {
	findWorkItemByKeyNumber,
	hydrateWorkItems,
	type MergedWorkItemRow,
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
	const row = await findWorkItemByKeyNumber(dbExec, workspaceId, keyNumber);
	if (!row || row.key_number == null) return null;

	const [item] = await hydrateWorkItems(
		dbExec,
		[row as MergedWorkItemRow],
		prefix,
	);
	if (redirectFrom) {
		return { ...item, canonicalKey: item.key, redirectFrom };
	}
	return item;
}
