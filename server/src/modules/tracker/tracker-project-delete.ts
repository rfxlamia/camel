import { sql } from "kysely";
import type { AuthUser } from "../../auth.js";
import { type DBExecutor, db } from "../../db/kysely.js";
import { recordActivity } from "../../lib/helpers.js";
import { lockWorkspaceMutation } from "../../lib/workspace-mutation-lock.js";
import { recordProjectActivity } from "./tracker-project-serialize.js";

/**
 * Live `cards` rows in the project. Column-less rows are Tracker items and feed
 * the released triples; rows with a column are board cards.
 */
async function loadProjectCards(
	trx: DBExecutor,
	workspaceId: number,
	projectId: number,
) {
	const rows = await trx
		.selectFrom("cards")
		.select(["id", "title", "column_id", "project_id", "phase_id"])
		.where("workspace_id", "=", workspaceId)
		.where("project_id", "=", projectId)
		.where("deleted_at", "is", null)
		.orderBy("id")
		.execute();

	return {
		cards: rows.filter((row) => row.column_id !== null),
		releasedTriples: rows
			.filter((row) => row.column_id === null)
			.map((row) => ({
				itemId: row.id,
				projectId: row.project_id!,
				phaseId: row.phase_id,
			})),
	};
}

/** Locks the live project row; `undefined` when it does not exist. */
async function lockLiveProject(
	trx: DBExecutor,
	workspaceId: number,
	projectId: number,
) {
	return trx
		.selectFrom("tracker_projects")
		.select(["id"])
		.where("id", "=", projectId)
		.where("workspace_id", "=", workspaceId)
		.where("deleted_at", "is", null)
		.forUpdate()
		.executeTakeFirst();
}

async function softDeleteProjectAndPhases(
	trx: DBExecutor,
	workspaceId: number,
	projectId: number,
): Promise<void> {
	await trx
		.updateTable("tracker_projects")
		.set({ deleted_at: sql`now()`, updated_at: sql`now()` })
		.where("id", "=", projectId)
		.where("workspace_id", "=", workspaceId)
		.where("deleted_at", "is", null)
		.execute();

	await trx
		.updateTable("tracker_phases")
		.set({ deleted_at: sql`now()`, updated_at: sql`now()` })
		.where("project_id", "=", projectId)
		.where("deleted_at", "is", null)
		.execute();
}

/** Column-less Tracker items: cleared without a version bump. */
async function releaseColumnLessRows(
	trx: DBExecutor,
	workspaceId: number,
	projectId: number,
): Promise<void> {
	await trx
		.updateTable("cards")
		.set({ project_id: null, phase_id: null })
		.where("workspace_id", "=", workspaceId)
		.where("column_id", "is", null)
		.where("project_id", "=", projectId)
		.execute();
}

type ReleasableCard = { id: number; title: string; phase_id: number | null };

/** Board cards: version bump plus one "update" event per card. */
async function releaseBoardCards(
	trx: DBExecutor,
	actor: AuthUser,
	workspaceId: number,
	projectId: number,
	cards: ReleasableCard[],
): Promise<number[]> {
	const releasedCardIds: number[] = [];
	if (cards.length > 0) {
		const updatedCards = await trx
			.updateTable("cards")
			.set({
				project_id: null,
				phase_id: null,
				version: sql`version + 1`,
			})
			.where("project_id", "=", projectId)
			.where("workspace_id", "=", workspaceId)
			.where("column_id", "is not", null)
			.where("deleted_at", "is", null)
			.returning(["id"])
			.execute();
		releasedCardIds.push(...updatedCards.map((card) => card.id));
	}

	for (const card of cards) {
		const changed = ["project"];
		if (card.phase_id != null) changed.push("phase");
		await recordActivity(trx, actor, workspaceId, "update", {
			cardId: card.id,
			payload: { cardTitle: card.title, changed },
		});
	}
	return releasedCardIds;
}

export async function deleteProjectTransaction(
	workspaceId: number,
	actor: AuthUser,
	projectId: number,
) {
	return db.transaction().execute(async (trx) => {
		await lockWorkspaceMutation(trx, workspaceId);

		const project = await lockLiveProject(trx, workspaceId, projectId);
		if (!project) {
			return { kind: "not_found" as const };
		}

		const { cards, releasedTriples } = await loadProjectCards(
			trx,
			workspaceId,
			projectId,
		);

		await softDeleteProjectAndPhases(trx, workspaceId, projectId);
		await releaseColumnLessRows(trx, workspaceId, projectId);
		const releasedCardIds = await releaseBoardCards(
			trx,
			actor,
			workspaceId,
			projectId,
			cards,
		);

		await recordProjectActivity(
			trx,
			actor,
			workspaceId,
			"tracker_project_deleted",
			{
				payload: { projectId, released: releasedTriples },
			},
		);

		return { kind: "ok" as const, releasedCardIds };
	});
}
