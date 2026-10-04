import { sql } from "kysely";
import { type DBExecutor, db } from "../../db/kysely.js";
import { loadCardAssigneesForCards } from "../../lib/card-assignees.js";
import {
	buildCardResponse,
	type CardResponseRow,
	loadCardLabelsForCards,
} from "../../lib/card-response.js";
import { loadCardAttachmentsForCards } from "./attachment-response.js";

export function selectFullCard(dbExec: DBExecutor) {
	return dbExec
		.selectFrom("cards as c")
		.innerJoin("workspaces as w", "w.id", "c.workspace_id")
		.leftJoin("tracker_vocabularies as st", (join) =>
			join.onRef("st.id", "=", "c.status_id").on("st.kind", "=", "status"),
		)
		.leftJoin("tracker_vocabularies as pr", (join) =>
			join.onRef("pr.id", "=", "c.priority_id").on("pr.kind", "=", "priority"),
		)
		.leftJoin("tracker_projects as tpr", (join) =>
			join
				.onRef("tpr.id", "=", "c.project_id")
				.on("tpr.deleted_at", "is", null),
		)
		.leftJoin("tracker_phases as tph", (join) =>
			join.onRef("tph.id", "=", "c.phase_id").on("tph.deleted_at", "is", null),
		)
		.select([
			"c.id",
			"c.workspace_id",
			"c.column_id",
			"c.title",
			"c.description",
			"c.position",
			"c.version",
			"c.created_at",
			"c.started_at",
			"c.done_at",
			sql<string | null>`c.due_date::text`.as("due_date"),
			"c.key_number",
			"w.name as workspace_name",
			"c.status_id",
			"st.kind as status_kind",
			"st.name as status_name",
			"st.position as status_position",
			"st.colour as status_colour",
			"st.category as status_category",
			"st.slot as status_slot",
			"c.priority_id",
			"pr.kind as priority_kind",
			"pr.name as priority_name",
			"pr.position as priority_position",
			"pr.colour as priority_colour",
			"c.project_id",
			"tpr.name as project_name",
			"c.phase_id",
			"tph.name as phase_name",
		]);
}

/** Hydrate one `selectFullCard` row into the card API response shape. */
export async function loadCardResponse(
	dbExec: DBExecutor,
	workspaceId: number,
	row: CardResponseRow,
) {
	const [assigneesByCard, labelsByCard, attachmentsByCard] = await Promise.all([
		loadCardAssigneesForCards(dbExec, [row.id]),
		loadCardLabelsForCards(dbExec, [row.id]),
		loadCardAttachmentsForCards(dbExec, workspaceId, [row.id]),
	]);
	return buildCardResponse(row, {
		assignees: assigneesByCard.get(row.id) ?? [],
		labels: labelsByCard.get(row.id) ?? [],
		attachments: attachmentsByCard.get(row.id) ?? [],
	});
}

export async function hydrateCard(cardId: number, workspaceId: number) {
	const row = await selectFullCard(db)
		.where("c.id", "=", cardId)
		.where("c.workspace_id", "=", workspaceId)
		.where("c.deleted_at", "is", null)
		.executeTakeFirst();
	if (!row) return null;
	return loadCardResponse(db, workspaceId, row);
}
