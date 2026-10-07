import { sql } from "kysely";
import type { AuthUser } from "../../auth.js";
import {
	neighborsAt,
	positionBetween,
	rebalance,
} from "../../core/position.js";
import { type DBExecutor } from "../../db/kysely.js";
import { recordActivity } from "../../lib/helpers.js";

type Sibling = { id: number; key_number: number; position: number };

export type ReorderWriteResult =
	| { kind: "not_found" }
	| { kind: "bad_neighbors" }
	| { kind: "non_adjacent_neighbors" }
	| { kind: "ok" };

export type ReorderWriteInput = {
	workspaceId: number;
	actor: AuthUser;
	cardId: number;
	/** Neighbor key numbers; `undefined` means that side was not supplied. */
	beforeKeyNumber: number | undefined;
	afterKeyNumber: number | undefined;
};

/** Live column-less siblings in one project/phase bucket, ordered by plan_position. */
async function loadBucketSiblings(
	trx: DBExecutor,
	workspaceId: number,
	projectId: number | null,
	phaseId: number | null,
	excludeId: number,
): Promise<Sibling[]> {
	let query = trx
		.selectFrom("cards")
		.select([
			"id",
			sql<number>`key_number`.as("key_number"),
			sql<number>`COALESCE(plan_position, 1e15)`.as("position"),
		])
		.where("workspace_id", "=", workspaceId)
		.where("column_id", "is", null)
		.where("deleted_at", "is", null)
		.where("id", "<>", excludeId)
		.orderBy(sql`COALESCE(plan_position, 1e15)`)
		.orderBy("id")
		.forUpdate();
	query =
		projectId === null
			? query.where("project_id", "is", null)
			: query.where("project_id", "=", projectId);
	query =
		phaseId === null
			? query.where("phase_id", "is", null)
			: query.where("phase_id", "=", phaseId);
	return query.execute();
}

/** Target index among siblings, or the failure kind for unusable neighbors. */
function targetIndex(
	siblings: Sibling[],
	before: number | undefined,
	after: number | undefined,
): number | "bad_neighbors" | "non_adjacent_neighbors" {
	const indexOf = (keyNumber: number | undefined) =>
		keyNumber === undefined
			? undefined
			: siblings.findIndex((s) => s.key_number === keyNumber);
	const beforeIndex = indexOf(before);
	const afterIndex = indexOf(after);
	if (beforeIndex === -1 || afterIndex === -1) return "bad_neighbors";
	if (beforeIndex !== undefined && afterIndex !== undefined) {
		return afterIndex === beforeIndex + 1
			? afterIndex
			: "non_adjacent_neighbors";
	}
	return beforeIndex !== undefined ? beforeIndex + 1 : (afterIndex as number);
}

/** Midpoint position at `index`; on too-close neighbors respace the bucket first. */
async function positionAt(
	trx: DBExecutor,
	siblings: Sibling[],
	index: number,
): Promise<number> {
	try {
		const { before, after } = neighborsAt(
			siblings.map((s) => Number(s.position)),
			index,
		);
		return positionBetween(before, after);
	} catch (error) {
		if (!(error instanceof RangeError)) throw error;
		const fresh = rebalance(siblings.length);
		for (let i = 0; i < siblings.length; i++) {
			await trx
				.updateTable("cards")
				.set({ plan_position: fresh[i] })
				.where("id", "=", siblings[i].id)
				.execute();
		}
		const { before, after } = neighborsAt(fresh, index);
		return positionBetween(before, after);
	}
}

/** Move one column-less item between two bucket neighbors (plan_position only). */
export async function reorderInTransaction(
	trx: DBExecutor,
	input: ReorderWriteInput,
): Promise<ReorderWriteResult> {
	const { workspaceId, cardId } = input;
	const locked = await trx
		.selectFrom("cards")
		.select(["id", "title", "project_id", "phase_id"])
		.where("id", "=", cardId)
		.where("workspace_id", "=", workspaceId)
		.where("column_id", "is", null)
		.where("deleted_at", "is", null)
		.forUpdate()
		.executeTakeFirst();
	if (!locked) return { kind: "not_found" };

	const siblings = await loadBucketSiblings(
		trx,
		workspaceId,
		locked.project_id,
		locked.phase_id,
		locked.id,
	);
	const index = targetIndex(
		siblings,
		input.beforeKeyNumber,
		input.afterKeyNumber,
	);
	if (typeof index === "string") return { kind: index };

	const position = await positionAt(trx, siblings, index);
	await trx
		.updateTable("cards")
		.set({ plan_position: position })
		.where("id", "=", locked.id)
		.execute();
	await recordActivity(trx, input.actor, workspaceId, "tracker_item_updated", {
		cardId: locked.id,
		payload: { title: locked.title, changed: ["position"] },
	});
	return { kind: "ok" };
}
