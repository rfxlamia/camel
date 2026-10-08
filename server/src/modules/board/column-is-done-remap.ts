import type { AuthUser } from "../../auth.js";
import { type DBExecutor, db } from "../../db/kysely.js";
import { getAttachmentStorage } from "../../lib/attachment-storage.js";
import { getHumanColumns, recordActivity } from "../../lib/helpers.js";
import {
	loadAttachmentPairsForColumn,
	removeAttachmentPairsBestEffort,
} from "./card-attachment-cleanup.js";
import {
	applyCardRemaps,
	loadRemapPlan,
	type RemapCardEvent,
} from "./column-remap-cards.js";

const RETURNING_COLUMNS = [
	"id",
	"title",
	"position",
	"wip_limit",
	"policy",
	"is_done",
	"is_signable",
	"signable_assignee_id",
	"color",
] as const;

export type ColumnPatchFields = {
	title?: string;
	wip_limit?: number | null;
	policy?: string;
	is_done?: boolean;
	is_signable?: boolean;
	signable_assignee_id?: number | null;
	color?: string | null;
};

type ColumnRow = {
	id: number;
	title: string;
	position: number;
	wip_limit: number | null;
	policy: string;
	is_done: boolean;
	is_signable: boolean;
	signable_assignee_id: number | null;
	color: string | null;
};

export type IsDoneRemapResult =
	| { kind: "not_found" }
	| {
			kind: "ok";
			updated: ColumnRow;
			cardEvents: RemapCardEvent[];
	  };

export type DeleteColumnRemapResult =
	| { kind: "not_found" }
	| {
			kind: "ok";
			deletedTitle: string;
			cardEvents: RemapCardEvent[];
	  };

export function updateColumnWithIsDoneRemap(input: {
	workspaceId: number;
	columnId: number;
	isDone: boolean;
	patchFields: ColumnPatchFields;
	actor: AuthUser;
}): Promise<IsDoneRemapResult> {
	return db.transaction().execute(async (trx) => {
		await trx
			.selectFrom("workspaces")
			.select("id")
			.where("id", "=", input.workspaceId)
			.forUpdate()
			.executeTakeFirstOrThrow();

		const beforeColumns = await getHumanColumns(trx, input.workspaceId);
		if (!beforeColumns.some((column) => column.id === input.columnId)) {
			return { kind: "not_found" };
		}

		await clearPreviousDoneColumn(trx, input);
		const updated = await updateDoneColumn(trx, input);
		const plan = await loadRemapPlan(trx, input.workspaceId, beforeColumns);
		const cardEvents = await applyCardRemaps(trx, input, plan);

		await recordActivity(trx, input.actor, input.workspaceId, "update", {
			payload: {
				columnId: input.columnId,
				columnTitle: updated.title,
				isDone: input.isDone,
				isSignable: updated.is_signable,
				signableAssigneeId: updated.signable_assignee_id,
				color: updated.color,
			},
		});

		return { kind: "ok", updated, cardEvents };
	});
}

export async function deleteColumnWithStatusRemap(input: {
	workspaceId: number;
	columnId: number;
	actor: AuthUser;
}): Promise<DeleteColumnRemapResult> {
	const result = await db.transaction().execute(async (trx) => {
		await trx
			.selectFrom("workspaces")
			.select("id")
			.where("id", "=", input.workspaceId)
			.forUpdate()
			.executeTakeFirstOrThrow();

		const beforeColumns = await getHumanColumns(trx, input.workspaceId);
		if (!beforeColumns.some((column) => column.id === input.columnId)) {
			return { kind: "not_found" as const };
		}

		const attachmentPairs = await loadAttachmentPairsForColumn(
			trx,
			input.workspaceId,
			input.columnId,
		);
		const deleted = await trx
			.deleteFrom("columns")
			.where("id", "=", input.columnId)
			.where("workspace_id", "=", input.workspaceId)
			.where("board_id", "is", null)
			.returning(["title"])
			.executeTakeFirstOrThrow();

		const remapData = await loadRemapPlan(
			trx,
			input.workspaceId,
			beforeColumns,
		);
		const cardEvents = await applyCardRemaps(trx, input, remapData);

		await recordActivity(trx, input.actor, input.workspaceId, "delete", {
			payload: { columnTitle: deleted.title },
		});

		return {
			kind: "ok" as const,
			deletedTitle: deleted.title,
			cardEvents,
			attachmentPairs,
		};
	});

	if (result.kind !== "ok") return result;
	await removeAttachmentPairsBestEffort(
		getAttachmentStorage(),
		result.attachmentPairs,
	);
	const { attachmentPairs: _attachmentPairs, ...publicResult } = result;
	return publicResult;
}

async function clearPreviousDoneColumn(
	trx: DBExecutor,
	input: { workspaceId: number; columnId: number; isDone: boolean },
) {
	if (!input.isDone) return;
	await trx
		.updateTable("columns")
		.set({ is_done: false })
		.where("workspace_id", "=", input.workspaceId)
		.where("board_id", "is", null)
		.where("id", "!=", input.columnId)
		.where("is_done", "=", true)
		.execute();
}

async function updateDoneColumn(
	trx: DBExecutor,
	input: {
		workspaceId: number;
		columnId: number;
		isDone: boolean;
		patchFields: ColumnPatchFields;
	},
): Promise<ColumnRow> {
	return trx
		.updateTable("columns")
		.set({ ...input.patchFields, is_done: input.isDone })
		.where("id", "=", input.columnId)
		.where("workspace_id", "=", input.workspaceId)
		.where("board_id", "is", null)
		.returning(RETURNING_COLUMNS)
		.executeTakeFirstOrThrow();
}
