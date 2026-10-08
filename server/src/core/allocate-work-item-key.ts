import { sql } from "kysely";
import type { DBExecutor } from "../db/kysely.js";

/**
 * Allocate the next work-item key number for a workspace.
 *
 * This is the only allocator for `workspaces.tracker_key_counter`. The single
 * row-locked UPDATE serializes concurrent allocations. The caller owns the
 * transaction; this helper has no column, status, event or activity concerns.
 */
export async function allocateWorkItemKey(
	dbExec: DBExecutor,
	input: { workspaceId: number },
): Promise<{ keyNumber: number }> {
	const counter = await dbExec
		.updateTable("workspaces")
		.set({ tracker_key_counter: sql`tracker_key_counter + 1` })
		.where("id", "=", input.workspaceId)
		.returning("tracker_key_counter")
		.executeTakeFirstOrThrow();
	return { keyNumber: counter.tracker_key_counter };
}
