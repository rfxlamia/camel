import { sql } from "kysely";
import type { AuthUser } from "../../auth.js";
import { firstNonDoneColumnId } from "../../core/column-status-map.js";
import { buildRemapPlan } from "../../core/remap-card-statuses.js";
import type { DBExecutor } from "../../db/kysely.js";
import { getHumanColumns, recordActivity } from "../../lib/helpers.js";

export type RemapCardEvent = {
	type: "card.updated";
	cardId: number;
	payload: Record<string, unknown>;
};

export async function loadRemapPlan(
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
	const columnCards = cards.flatMap((card) =>
		card.column_id == null ? [] : [{ ...card, column_id: card.column_id }],
	);
	return {
		plan: buildRemapPlan({
			beforeColumns,
			afterColumns,
			cards: columnCards,
			statuses,
		}),
		afterColumns,
	};
}

export type RemapData = Awaited<ReturnType<typeof loadRemapPlan>>;
type Remap = RemapData["plan"][number];

type UpdatedCard = Awaited<ReturnType<typeof updateRemappedCard>>;

export async function applyCardRemaps(
	trx: DBExecutor,
	input: { workspaceId: number; actor: AuthUser },
	remapData: RemapData,
) {
	const backlogColumnId = firstNonDoneColumnId(remapData.afterColumns);
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
			backlogColumnId,
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
	backlogColumnId: number | undefined,
) {
	return trx
		.updateTable("cards")
		.set({
			status_id: remap.statusId,
			version: sql`version + 1`,
			started_at: sql`CASE WHEN started_at IS NULL AND (${targetIsDone} OR ${remap.columnId !== backlogColumnId}) THEN now() ELSE started_at END`,
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
