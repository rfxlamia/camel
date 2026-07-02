import { Router } from "express";
import { sql } from "kysely";
import { db } from "../db/kysely.js";
import { requireWorkspaceMember } from "../middleware/workspace.js";
import { loadCardAssigneesForCards } from "./card-assignees.js";
import { getHumanColumns, type HumanColumn } from "./helpers.js";

type CardRow = {
	id: number;
	column_id: number;
	title: string;
	description: string;
	position: number;
	version: number;
	created_at: string;
	started_at: string | null;
	done_at: string | null;
	due_date: string | null;
};

export function buildBoardResponse(
	columns: HumanColumn[],
	cards: CardRow[],
	assigneesByCard: Map<number, { id: number; username: string; displayName: string }[]>,
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
			cards: (cardsByColumn.get(col.id) ?? []).map((c) => ({
				id: c.id,
				columnId: c.column_id,
				title: c.title,
				description: c.description,
				position: c.position,
				version: c.version,
				createdAt: c.created_at,
				startedAt: c.started_at,
				doneAt: c.done_at,
				dueDate: c.due_date,
				assignees: assigneesByCard.get(c.id) ?? [],
			})),
		})),
	};
}

export const boardRouter = Router({ mergeParams: true });

boardRouter.get("/board", requireWorkspaceMember, async (req, res) => {
	const { workspaceId } = req.workspace!;

	const columns = await getHumanColumns(db, workspaceId);
	const cardRows = await db
		.selectFrom("cards")
		.select([
			"id",
			"column_id",
			"title",
			"description",
			"position",
			"version",
			"created_at",
			"started_at",
			"done_at",
			sql<string | null>`due_date::text`.as("due_date"),
		])
		.where("workspace_id", "=", workspaceId)
		.where("deleted_at", "is", null)
		.orderBy("position")
		.execute();
	const cards = cardRows.map((c) => ({
		...c,
		created_at: c.created_at.toISOString(),
		started_at: c.started_at?.toISOString() ?? null,
		done_at: c.done_at?.toISOString() ?? null,
	}));
	const cardIds = cards.map((c) => c.id);
	const assigneesByCard = await loadCardAssigneesForCards(db, cardIds);
	res.json(buildBoardResponse(columns, cards, assigneesByCard));
});
