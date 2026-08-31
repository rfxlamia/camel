import { Router } from "express";
import { sql } from "kysely";
import { db } from "../db/kysely.js";
import { requireWorkspaceMember } from "../middleware/workspace.js";
import { loadCardAssigneesForCards } from "./card-assignees.js";
import {
	buildCardResponse,
	type CardResponseRow,
	loadCardLabelsForCards,
} from "./card-response.js";
import { getHumanColumns, type HumanColumn } from "./helpers.js";
import type { VocabularyRow } from "./vocabulary-response.js";

type CardRow = CardResponseRow;

export function buildBoardResponse(
	columns: HumanColumn[],
	cards: CardRow[],
	assigneesByCard: Map<
		number,
		{ id: number; username: string; displayName: string }[]
	>,
	labelsByCard: Map<number, VocabularyRow[]> = new Map(),
) {
	const cardsByColumn = new Map<number, CardRow[]>();
	for (const c of cards) {
		const list = cardsByColumn.get(c.column_id);
		if (list) list.push(c);
		else cardsByColumn.set(c.column_id, [c]);
	}

	return {
		columns: columns.map((col) => ({
			id: col.id,
			title: col.title,
			position: col.position,
			wipLimit: col.wip_limit,
			policy: col.policy,
			isDone: col.is_done,
			isSignable: col.is_signable,
			signableAssigneeId: col.signable_assignee_id,
			color: col.color,
			cards: (cardsByColumn.get(col.id) ?? []).map((c) =>
				buildCardResponse(c, {
					assignees: assigneesByCard.get(c.id) ?? [],
					labels: labelsByCard.get(c.id) ?? [],
				}),
			),
		})),
	};
}

export const boardRouter = Router({ mergeParams: true });

boardRouter.get("/board", requireWorkspaceMember, async (req, res) => {
	const { workspaceId } = req.workspace!;

	const columns = await getHumanColumns(db, workspaceId);
	const cardRows = await db
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
			join
				.onRef("tph.id", "=", "c.phase_id")
				.on("tph.deleted_at", "is", null),
		)
		.select([
			"c.id",
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
		])
		.where("c.workspace_id", "=", workspaceId)
		.where("c.deleted_at", "is", null)
		.orderBy("c.position")
		.execute();
	const cards = cardRows.map((c) => ({
		...c,
		created_at: c.created_at.toISOString(),
		started_at: c.started_at?.toISOString() ?? null,
		done_at: c.done_at?.toISOString() ?? null,
	}));
	const cardIds = cards.map((c) => c.id);
	const [assigneesByCard, labelsByCard] = await Promise.all([
		loadCardAssigneesForCards(db, cardIds),
		loadCardLabelsForCards(db, cardIds),
	]);
	res.json(buildBoardResponse(columns, cards, assigneesByCard, labelsByCard));
});
