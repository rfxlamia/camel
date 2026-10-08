import { sql } from "kysely";
import type { AuthUser } from "../../auth.js";
import { positionBetween } from "../../core/position.js";
import { type DBExecutor, db } from "../../db/kysely.js";
import { recordActivity } from "../../lib/helpers.js";
import { lockWorkspaceMutation } from "../../lib/workspace-mutation-lock.js";

type PhaseActivityEvent =
	| "tracker_phase_created"
	| "tracker_phase_updated"
	| "tracker_phase_deleted";

export async function recordPhaseActivity(
	dbExec: DBExecutor,
	actor: AuthUser,
	workspaceId: number,
	eventType: PhaseActivityEvent,
	opts: { payload?: Record<string, unknown> },
): Promise<void> {
	await recordActivity(dbExec, actor, workspaceId, eventType, opts);
}

export async function lookupPhaseInWorkspace(
	dbExec: DBExecutor,
	workspaceId: number,
	phaseId: number,
): Promise<{ id: number; project_id: number } | undefined> {
	return dbExec
		.selectFrom("tracker_phases as tp")
		.innerJoin("tracker_projects as tpr", "tpr.id", "tp.project_id")
		.select(["tp.id as id", "tp.project_id as project_id"])
		.where("tp.id", "=", phaseId)
		.where("tp.deleted_at", "is", null)
		.where("tpr.workspace_id", "=", workspaceId)
		.where("tpr.deleted_at", "is", null)
		.executeTakeFirst();
}

/**
 * Moves the phase's live column-less items (Tracker items) to the end of the
 * project's no-phase bucket, ordered by `plan_position`. Board cards are
 * released separately in `deletePhaseTransaction`.
 */
async function releasePhaseItemsToNoPhase(
	trx: DBExecutor,
	workspaceId: number,
	projectId: number,
	phaseId: number,
): Promise<
	Array<{ itemId: number; projectId: number; phaseId: number | null }>
> {
	const items = await trx
		.selectFrom("cards")
		.select(["id", "project_id", "phase_id"])
		.where("workspace_id", "=", workspaceId)
		.where("column_id", "is", null)
		.where("phase_id", "=", phaseId)
		.where("deleted_at", "is", null)
		.orderBy(sql`COALESCE(plan_position, 1e15)`)
		.orderBy("id")
		.execute();

	const releasedTriples = items.map((item) => ({
		itemId: item.id,
		projectId: item.project_id!,
		phaseId: item.phase_id,
	}));

	const bucketRow = await trx
		.selectFrom("cards")
		.select(sql<number | null>`max(plan_position)`.as("max_position"))
		.where("workspace_id", "=", workspaceId)
		.where("column_id", "is", null)
		.where("project_id", "=", projectId)
		.where("phase_id", "is", null)
		.where("deleted_at", "is", null)
		.executeTakeFirst();

	let prevPosition = bucketRow?.max_position ?? null;

	for (const item of items) {
		const newPosition = positionBetween(prevPosition, null);
		await trx
			.updateTable("cards")
			.set({ phase_id: null, plan_position: newPosition })
			.where("id", "=", item.id)
			.execute();
		prevPosition = newPosition;
	}

	return releasedTriples;
}

export async function deletePhaseTransaction(
	workspaceId: number,
	actor: AuthUser,
	phaseId: number,
) {
	return db.transaction().execute(async (trx) => {
		await lockWorkspaceMutation(trx, workspaceId);

		const project = await trx
			.selectFrom("tracker_projects as tpr")
			.select("tpr.id as id")
			.where("tpr.workspace_id", "=", workspaceId)
			.where("tpr.deleted_at", "is", null)
			.where("tpr.id", "in", (eb) =>
				eb
					.selectFrom("tracker_phases as tp")
					.select("tp.project_id")
					.where("tp.id", "=", phaseId)
					.where("tp.deleted_at", "is", null),
			)
			.orderBy("tpr.id")
			.forUpdate()
			.executeTakeFirst();

		if (!project) {
			return { kind: "not_found" as const };
		}

		const phase = await trx
			.selectFrom("tracker_phases as tp")
			.innerJoin("tracker_projects as tpr", "tpr.id", "tp.project_id")
			.select(["tp.id as id", "tp.project_id as project_id"])
			.where("tp.id", "=", phaseId)
			.where("tp.deleted_at", "is", null)
			.where("tpr.workspace_id", "=", workspaceId)
			.where("tpr.deleted_at", "is", null)
			.orderBy("tp.id")
			.forUpdate()
			.executeTakeFirst();

		if (!phase) {
			return { kind: "not_found" as const };
		}

		const cards = await trx
			.selectFrom("cards")
			.select(["id", "title", "project_id", "phase_id"])
			.where("workspace_id", "=", workspaceId)
			.where("column_id", "is not", null)
			.where("phase_id", "=", phaseId)
			.where("deleted_at", "is", null)
			.execute();

		const releasedTriples = await releasePhaseItemsToNoPhase(
			trx,
			workspaceId,
			phase.project_id,
			phaseId,
		);

		const releasedCardIds: number[] = [];
		if (cards.length > 0) {
			const updatedCards = await trx
				.updateTable("cards")
				.set({
					phase_id: null,
					version: sql`version + 1`,
				})
				.where("workspace_id", "=", workspaceId)
				.where("column_id", "is not", null)
				.where("phase_id", "=", phaseId)
				.where("deleted_at", "is", null)
				.returning(["id"])
				.execute();
			releasedCardIds.push(...updatedCards.map((card) => card.id));
		}

		for (const card of cards) {
			await recordActivity(trx, actor, workspaceId, "update", {
				cardId: card.id,
				payload: {
					cardTitle: card.title,
					changed: ["phase"],
				},
			});
		}

		await trx
			.updateTable("tracker_phases")
			.set({ deleted_at: sql`now()`, updated_at: sql`now()` })
			.where("id", "=", phaseId)
			.where("deleted_at", "is", null)
			.execute();

		await recordPhaseActivity(
			trx,
			actor,
			workspaceId,
			"tracker_phase_deleted",
			{
				payload: {
					phaseId,
					projectId: phase.project_id,
					released: releasedTriples,
				},
			},
		);

		return { kind: "ok" as const, releasedCardIds };
	});
}
