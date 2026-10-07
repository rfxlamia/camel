// Shared lookups for Tracker item writes on the merged `cards` table.
// A Tracker item is a `cards` row with NULL `column_id`; it never gets a column.
import type { DBExecutor } from "../../db/kysely.js";
import {
	findWorkItemByKeyNumber,
	legacyTrackerItemResponse,
} from "../../lib/work-item-response.js";
import { resolveWorkItemByKey } from "./tracker-item-route-helpers.js";

/** Live column-less row for a key, or undefined (board cards are not matched). */
export async function findColumnlessItem(
	dbExec: DBExecutor,
	workspaceId: number,
	keyNumber: number,
) {
	const row = await findWorkItemByKeyNumber(dbExec, workspaceId, keyNumber);
	return row && row.column_id == null ? row : undefined;
}

/** After a guarded write matched no row: stale version (conflict) or gone (not_found). */
export async function classifyWriteFailure(
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

/** Response body for a mutated Tracker item (`source` stripped on legacy routes). */
export async function loadMutationResponse(
	dbExec: DBExecutor,
	input: {
		workspaceId: number;
		keyNumber: number;
		prefix: string;
		canonical: boolean;
		redirectFrom?: string;
	},
): Promise<Record<string, unknown> | null> {
	const item = await resolveWorkItemByKey(
		dbExec,
		input.workspaceId,
		input.keyNumber,
		input.prefix,
		input.redirectFrom,
	);
	if (!item) return null;
	return legacyTrackerItemResponse(
		item as Record<string, unknown>,
		input.canonical,
	);
}
