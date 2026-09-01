import { sql } from "kysely";
import {
	mapColumnSlots,
	statusIdForSlot,
	type StatusSlot,
} from "./column-status-map.js";
import { resolveColumnForStatusChange } from "./column-status-reverse.js";
import { positionBetween } from "./position.js";
import { checkWipLimit } from "./wip.js";
import type { DBExecutor } from "../db/kysely.js";
import type { AuthUser } from "../auth.js";
import { recordActivity } from "../routes/helpers.js";
import { addCardAssignee } from "../routes/card-assignees.js";

export type BoardCardStatusChangeResult =
	| { kind: "not_found" }
	| { kind: "conflict" }
	| { kind: "invalid_status" }
	| { kind: "wip"; reason?: string }
	| { kind: "ok"; moved: boolean; cardTitle: string };

export async function applyBoardCardStatusChange(
	trx: DBExecutor,
	params: {
		workspaceId: number;
		actor: AuthUser;
		cardId: number;
		targetStatusId: number;
		version?: number;
	},
): Promise<BoardCardStatusChangeResult> {
	const card = await trx
		.selectFrom("cards")
		.select([
			"id",
			"column_id",
			"title",
			"version",
			"started_at",
			"done_at",
		])
		.where("id", "=", params.cardId)
		.where("workspace_id", "=", params.workspaceId)
		.where("deleted_at", "is", null)
		.forUpdate()
		.executeTakeFirst();
	if (!card) return { kind: "not_found" };
	if (params.version !== undefined && card.version !== params.version) {
		return { kind: "conflict" };
	}

	const statusRow = await trx
		.selectFrom("tracker_vocabularies")
		.select(["id", "slot"])
		.where("id", "=", params.targetStatusId)
		.where("workspace_id", "=", params.workspaceId)
		.where("kind", "=", "status")
		.executeTakeFirst();
	if (!statusRow?.slot) return { kind: "invalid_status" };

	const targetSlot = statusRow.slot as StatusSlot;
	const destinationColumn = await trx
		.selectFrom("columns")
		.select("board_id")
		.where("id", "=", card.column_id)
		.where("workspace_id", "=", params.workspaceId)
		.executeTakeFirst();
	if (!destinationColumn) return { kind: "not_found" };

	const siblingColumns = await trx
		.selectFrom("columns")
		.select(["id", "position", "is_done"])
		.where("workspace_id", "=", params.workspaceId)
		.where(
			sql<boolean>`board_id IS NOT DISTINCT FROM ${destinationColumn.board_id}`,
		)
		.orderBy("position")
		.orderBy("id")
		.execute();

	const toColumnId = resolveColumnForStatusChange(
		card.column_id,
		targetSlot,
		siblingColumns,
	);

	if (toColumnId === null) {
		await trx
			.updateTable("cards")
			.set({
				status_id: params.targetStatusId,
				version: sql`version + 1`,
			})
			.where("id", "=", params.cardId)
			.execute();
		await recordActivity(trx, params.actor, params.workspaceId, "update", {
			cardId: params.cardId,
			payload: { cardTitle: card.title, field: "status" },
		});
		return { kind: "ok", moved: false, cardTitle: card.title };
	}

	if (toColumnId === card.column_id) {
		await trx
			.updateTable("cards")
			.set({
				status_id: params.targetStatusId,
				version: sql`version + 1`,
			})
			.where("id", "=", params.cardId)
			.execute();
		await recordActivity(trx, params.actor, params.workspaceId, "update", {
			cardId: params.cardId,
			payload: { cardTitle: card.title, field: "status" },
		});
		return { kind: "ok", moved: false, cardTitle: card.title };
	}

	const target = await trx
		.selectFrom("columns")
		.select([
			"id",
			"wip_limit",
			"is_done",
			"is_signable",
			"signable_assignee_id",
			sql<boolean>`(position = (SELECT MIN(position) FROM columns WHERE workspace_id = ${params.workspaceId}))`.as(
				"is_first",
			),
		])
		.where("id", "=", toColumnId)
		.where("workspace_id", "=", params.workspaceId)
		.executeTakeFirst();
	if (!target) return { kind: "not_found" };

	const siblings = await trx
		.selectFrom("cards")
		.select(["id", "position"])
		.where("column_id", "=", toColumnId)
		.where("workspace_id", "=", params.workspaceId)
		.where("deleted_at", "is", null)
		.orderBy("position")
		.forUpdate()
		.execute();

	const wip = checkWipLimit({
		currentCount: siblings.length,
		wipLimit: target.wip_limit,
		isSameColumn: false,
	});
	if (!wip.allowed) return { kind: "wip", reason: wip.reason };

	const maxPosition = siblings.at(-1)?.position ?? null;
	const position = positionBetween(
		maxPosition == null ? null : Number(maxPosition),
		null,
	);

	const slot = mapColumnSlots(siblingColumns).get(toColumnId);
	if (!slot) return { kind: "not_found" };
	const statusRows = await trx
		.selectFrom("tracker_vocabularies")
		.select(["id", "kind", "slot"])
		.where("workspace_id", "=", params.workspaceId)
		.where("kind", "=", "status")
		.execute();
	const destinationStatusId = statusIdForSlot(statusRows, slot);
	if (destinationStatusId === null) return { kind: "invalid_status" };

	await trx
		.updateTable("cards")
		.set({
			column_id: toColumnId,
			position,
			status_id: destinationStatusId,
			version: sql`version + 1`,
			started_at: sql`CASE WHEN started_at IS NULL AND (${target.is_done} OR NOT ${target.is_first}) THEN now() ELSE started_at END`,
			done_at: sql`CASE WHEN ${target.is_done} THEN COALESCE(done_at, now()) ELSE NULL END`,
		})
		.where("id", "=", params.cardId)
		.execute();

	if (target.is_signable && target.signable_assignee_id != null) {
		await addCardAssignee(trx, params.cardId, target.signable_assignee_id);
	}

	await recordActivity(trx, params.actor, params.workspaceId, "move", {
		cardId: params.cardId,
		fromColumnId: card.column_id,
		toColumnId,
		payload: { cardTitle: card.title },
	});

	return { kind: "ok", moved: true, cardTitle: card.title };
}
