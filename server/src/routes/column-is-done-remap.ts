import { sql } from "kysely";
import type { AuthUser } from "../auth.js";
import { buildRemapPlan } from "../core/remap-card-statuses.js";
import { type DBExecutor, db } from "../db/kysely.js";
import { getHumanColumns, recordActivity } from "./helpers.js";

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

type RemapCardEvent = {
	type: "card.updated";
	cardId: number;
	payload: Record<string, unknown>;
};

export type IsDoneRemapResult =
	| { kind: "not_found" }
	| {
			kind: "ok";
			updated: ColumnRow;
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

async function loadRemapPlan(
	trx: DBExecutor,
	workspaceId: number,
	beforeColumns: Awaited<ReturnType<typeof getHumanColumns>>,
) {
	const afterColumns = await getHumanColumns(trx, workspaceId);
	const cards = await trx
		.selectFrom("cards")
		.select(["id", "column_id", "status_id", "deleted_at"])
		.where("workspace_id", "=", workspaceId)
		.where("deleted_at", "is", null)
		.forUpdate()
		.execute();
	const statuses = await trx
		.selectFrom("tracker_vocabularies")
		.select(["id", "kind", "slot"])
		.where("workspace_id", "=", workspaceId)
		.where("kind", "=", "status")
		.execute();
	return {
		plan: buildRemapPlan({ beforeColumns, afterColumns, cards, statuses }),
		afterColumns,
	};
}

type RemapData = Awaited<ReturnType<typeof loadRemapPlan>>;
type Remap = RemapData["plan"][number];

type UpdatedCard = Awaited<ReturnType<typeof updateRemappedCard>>;

async function applyCardRemaps(
	trx: DBExecutor,
	input: { workspaceId: number; actor: AuthUser },
	remapData: RemapData,
) {
	const firstColumnId = remapData.afterColumns[0]?.id;
	const cardEvents: RemapCardEvent[] = [];
	for (const remap of remapData.plan) {
		const targetIsDone =
			remapData.afterColumns.find((column) => column.id === remap.columnId)
				?.is_done ?? false;
		const updatedCard = await updateRemappedCard(
			trx,
			input.workspaceId,
			remap,
			targetIsDone,
			firstColumnId,
		);
		await recordCardRemapActivity(
			trx,
			input.actor,
			input.workspaceId,
			updatedCard,
		);
		cardEvents.push(toCardEvent(updatedCard));
	}
	return cardEvents;
}

async function updateRemappedCard(
	trx: DBExecutor,
	workspaceId: number,
	remap: Remap,
	targetIsDone: boolean,
	firstColumnId: number | undefined,
) {
	return trx
		.updateTable("cards")
		.set({
			status_id: remap.statusId,
			version: sql`version + 1`,
			started_at: sql`CASE WHEN started_at IS NULL AND (${targetIsDone} OR ${remap.columnId !== firstColumnId}) THEN now() ELSE started_at END`,
			done_at: sql`CASE WHEN ${targetIsDone} THEN COALESCE(done_at, now()) ELSE NULL END`,
		})
		.where("id", "=", remap.cardId)
		.where("workspace_id", "=", workspaceId)
		.where("deleted_at", "is", null)
		.returning([
			"id",
			"column_id",
			"version",
			"status_id",
			"started_at",
			"done_at",
		])
		.executeTakeFirstOrThrow();
}

async function recordCardRemapActivity(
	trx: DBExecutor,
	actor: AuthUser,
	workspaceId: number,
	card: UpdatedCard,
) {
	await recordActivity(trx, actor, workspaceId, "update", {
		cardId: card.id,
		fromColumnId: card.column_id,
		toColumnId: card.column_id,
		payload: { changed: ["status"], statusId: card.status_id },
	});
}

function toCardEvent(card: UpdatedCard): RemapCardEvent {
	return {
		type: "card.updated",
		cardId: card.id,
		payload: {
			columnId: card.column_id,
			statusId: card.status_id,
			version: card.version,
			startedAt: card.started_at?.toISOString() ?? null,
			doneAt: card.done_at?.toISOString() ?? null,
		},
	};
}
