import type { Request, Response } from "express";
import { sql } from "kysely";
import { neighborsAt, positionBetween, rebalance } from "../core/position.js";
import {
	derivePrefix,
	formatKey,
	parseKeyFromUrl,
} from "../core/tracker-key.js";
import { type DBExecutor, db } from "../db/kysely.js";
import { publishEvent } from "../realtime.js";
import { recordTrackerActivity } from "./tracker-activity.js";
import {
	findBoardCardByKeyNumber,
	findTrackerItemByKeyNumber,
	hydrateMutationItem,
} from "./work-item-response.js";

function routeKeyParam(raw: string | string[]): string {
	return Array.isArray(raw) ? (raw[0] ?? "") : raw;
}

async function workspacePrefix(
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

async function loadBucketSiblings(
	dbExec: DBExecutor,
	workspaceId: number,
	projectId: number | null,
	phaseId: number | null,
	excludeId: number,
): Promise<Array<{ id: number; key_number: number; position: number }>> {
	let query = dbExec
		.selectFrom("tracker_items")
		.select([
			"id",
			"key_number",
			sql<number>`COALESCE(position, 1e15)`.as("position"),
		])
		.where("workspace_id", "=", workspaceId)
		.where("deleted_at", "is", null)
		.where("id", "<>", excludeId)
		.orderBy(sql`COALESCE(position, 1e15)`)
		.orderBy("id")
		.forUpdate();

	if (projectId === null) {
		query = query.where("project_id", "is", null);
	} else {
		query = query.where("project_id", "=", projectId);
	}

	if (phaseId === null) {
		query = query.where("phase_id", "is", null);
	} else {
		query = query.where("phase_id", "=", phaseId);
	}

	return query.execute();
}

function resolveNeighborKeyNumber(key: string, prefix: string): number | null {
	const parsed = parseKeyFromUrl(key);
	if (!parsed || parsed.prefix !== prefix) return null;
	return parsed.keyNumber;
}

export async function reorderTrackerItemHandler(req: Request, res: Response) {
	const { workspaceId } = req.workspace!;
	const actor = req.user!;
	const parsed = parseKeyFromUrl(routeKeyParam(req.params.key));
	if (!parsed) {
		return res.status(400).json({ error: "invalid tracker key" });
	}

	const body = req.body ?? {};
	if ("projectId" in body || "phaseId" in body) {
		return res
			.status(400)
			.json({ error: "cross-bucket move not allowed on reorder" });
	}

	const { beforeKey, afterKey } = body as {
		beforeKey?: unknown;
		afterKey?: unknown;
	};
	if (beforeKey !== undefined && typeof beforeKey !== "string") {
		return res.status(400).json({ error: "beforeKey must be a string" });
	}
	if (afterKey !== undefined && typeof afterKey !== "string") {
		return res.status(400).json({ error: "afterKey must be a string" });
	}
	if (beforeKey === undefined && afterKey === undefined) {
		return res.status(400).json({ error: "beforeKey or afterKey is required" });
	}

	const prefix = await workspacePrefix(db, workspaceId);
	if (!prefix) return res.status(404).json({ error: "Not found" });

	const existing = await findTrackerItemByKeyNumber(
		db,
		workspaceId,
		parsed.keyNumber,
	);
	if (!existing) {
		const boardCard = await findBoardCardByKeyNumber(
			db,
			workspaceId,
			parsed.keyNumber,
		);
		if (boardCard) {
			return res.status(409).json({
				error: "Board items cannot be reordered from Tracker.",
				code: "board_item_use_card_api",
			});
		}
		return res.status(404).json({ error: "Not found" });
	}

	const beforeKeyNumber =
		beforeKey === undefined
			? undefined
			: resolveNeighborKeyNumber(beforeKey, prefix);
	const afterKeyNumber =
		afterKey === undefined
			? undefined
			: resolveNeighborKeyNumber(afterKey, prefix);
	if (beforeKeyNumber === null || afterKeyNumber === null) {
		return res.status(400).json({ error: "invalid neighbor key" });
	}

	type ReorderResult =
		| { kind: "bad_neighbors" }
		| { kind: "non_adjacent_neighbors" }
		| { kind: "ok" };

	const result: ReorderResult = await db.transaction().execute(async (trx) => {
		const siblings = await loadBucketSiblings(
			trx,
			workspaceId,
			existing.project_id,
			existing.phase_id,
			existing.id,
		);

		const beforeIndex =
			beforeKeyNumber === undefined
				? undefined
				: siblings.findIndex((s) => s.key_number === beforeKeyNumber);
		const afterIndex =
			afterKeyNumber === undefined
				? undefined
				: siblings.findIndex((s) => s.key_number === afterKeyNumber);
		if (
			(beforeIndex !== undefined && beforeIndex === -1) ||
			(afterIndex !== undefined && afterIndex === -1)
		) {
			return { kind: "bad_neighbors" };
		}

		let index: number;
		if (beforeIndex !== undefined && afterIndex !== undefined) {
			if (afterIndex !== beforeIndex + 1) {
				return { kind: "non_adjacent_neighbors" };
			}
			index = beforeIndex + 1;
		} else if (beforeIndex !== undefined) {
			index = beforeIndex + 1;
		} else {
			index = afterIndex as number;
		}

		let position: number;
		try {
			const positions = siblings.map((s) => Number(s.position));
			const { before, after } = neighborsAt(positions, index);
			position = positionBetween(before, after);
		} catch {
			const fresh = rebalance(siblings.length);
			for (let i = 0; i < siblings.length; i++) {
				await trx
					.updateTable("tracker_items")
					.set({ position: fresh[i] })
					.where("id", "=", siblings[i].id)
					.execute();
			}
			const { before, after } = neighborsAt(fresh, index);
			position = positionBetween(before, after);
		}

		await trx
			.updateTable("tracker_items")
			.set({ position })
			.where("id", "=", existing.id)
			.execute();

		await recordTrackerActivity(
			trx,
			actor,
			workspaceId,
			"tracker_item_updated",
			{
				trackerItemId: existing.id,
				payload: {
					title: existing.title,
					changed: ["position"],
				},
			},
		);

		return { kind: "ok" };
	});

	if (result.kind === "bad_neighbors") {
		return res.status(400).json({ error: "neighbor not in bucket" });
	}
	if (result.kind === "non_adjacent_neighbors") {
		return res.status(400).json({ error: "neighbors must be adjacent" });
	}

	const row = await findTrackerItemByKeyNumber(
		db,
		workspaceId,
		parsed.keyNumber,
	);
	if (!row) return res.status(404).json({ error: "Not found" });

	const redirectFrom =
		parsed.prefix !== prefix
			? formatKey(parsed.prefix, parsed.keyNumber)
			: undefined;
	const item = await hydrateMutationItem(db, row, prefix, {
		canonicalWorkItem: req.canonicalWorkItemsRoute,
		redirectFrom,
	});
	await publishEvent(workspaceId, {
		type: "tracker.updated",
		actor,
		trackerItemId: existing.id,
	});
	res.json(item);
}
