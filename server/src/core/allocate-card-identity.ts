import { sql } from "kysely";
import { type DBExecutor } from "../db/kysely.js";
import { mapColumnSlots, statusIdForSlot } from "./column-status-map.js";

export interface CardIdentity {
	keyNumber: number;
	statusId: number;
}

/**
 * Allocate the identity shared by board cards and tracker items.
 *
 * The caller owns the transaction. The workspace update serializes allocations;
 * all column/status reads therefore happen in that same transaction. This
 * helper deliberately has no event or activity side effects.
 */
export async function allocateCardIdentity(
	dbExec: DBExecutor,
	input: { workspaceId: number; columnId: number },
): Promise<CardIdentity> {
	const counter = await dbExec
		.updateTable("workspaces")
		.set({ tracker_key_counter: sql`tracker_key_counter + 1` })
		.where("id", "=", input.workspaceId)
		.returning("tracker_key_counter")
		.executeTakeFirstOrThrow();

	const destination = await dbExec
		.selectFrom("columns")
		.select("board_id")
		.where("id", "=", input.columnId)
		.where("workspace_id", "=", input.workspaceId)
		.executeTakeFirstOrThrow();

	const siblingColumns = await dbExec
		.selectFrom("columns")
		.select(["id", "position", "is_done"])
		.where("workspace_id", "=", input.workspaceId)
		.where(sql<boolean>`board_id IS NOT DISTINCT FROM ${destination.board_id}`)
		.orderBy("position")
		.orderBy("id")
		.execute();

	const slot = mapColumnSlots(siblingColumns).get(input.columnId);
	if (!slot) {
		throw new Error(
			"Destination column is not in the workspace board geometry",
		);
	}

	const statusRows = await dbExec
		.selectFrom("tracker_vocabularies")
		.select(["id", "kind", "slot"])
		.where("workspace_id", "=", input.workspaceId)
		.where("kind", "=", "status")
		.where("slot", "=", slot)
		.execute();
	const statusId = statusIdForSlot(statusRows, slot);
	if (statusId === null) {
		throw new Error(`Status vocabulary missing for slot: ${slot}`);
	}

	return {
		keyNumber: counter.tracker_key_counter,
		statusId,
	};
}
