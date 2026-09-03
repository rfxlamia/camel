import { Router } from "express";
import { sql } from "kysely";
import type { AuthUser } from "../auth.js";
import { positionBetween } from "../core/position.js";
import { type DBExecutor, db } from "../db/kysely.js";
import { requireWorkspaceMember } from "../middleware/workspace.js";
import { publishEvent } from "../realtime.js";
import { recordActivity } from "./helpers.js";
import { parseDateRange } from "./tracker-item-parsers.js";
import { recordTrackerActivity } from "./tracker-activity.js";
import { lockWorkspaceMutation } from "./workspace-mutation-lock.js";

const PHASE_COLUMNS = [
	"id",
	"project_id",
	"name",
	"subtitle",
	"start_date",
	"end_date",
	"position",
	"version",
	"created_at",
	"updated_at",
] as const;

type PhaseRow = {
	id: number;
	project_id: number;
	name: string;
	subtitle: string;
	start_date: Date | string | null;
	end_date: Date | string | null;
	position: number;
	version: number;
	created_at: Date | string;
	updated_at: Date | string;
};

type PhaseActivityEvent =
	| "tracker_phase_created"
	| "tracker_phase_updated"
	| "tracker_phase_deleted";

function formatDate(value: Date | string | null): string | null {
	if (value == null) return null;
	if (typeof value === "string") return value.slice(0, 10);
	return value.toISOString().slice(0, 10);
}

function formatTimestamp(value: Date | string): string {
	if (value instanceof Date) return value.toISOString();
	return value;
}

function serializePhase(row: PhaseRow) {
	return {
		id: row.id,
		projectId: row.project_id,
		name: row.name,
		subtitle: row.subtitle,
		startDate: formatDate(row.start_date),
		endDate: formatDate(row.end_date),
		position: row.position,
		version: row.version,
		createdAt: formatTimestamp(row.created_at),
		updatedAt: formatTimestamp(row.updated_at),
	};
}

async function recordPhaseActivity(
	dbExec: DBExecutor,
	actor: AuthUser,
	workspaceId: number,
	eventType: PhaseActivityEvent,
	opts: { payload?: Record<string, unknown> },
): Promise<void> {
	await recordTrackerActivity(
		dbExec,
		actor,
		workspaceId,
		eventType as Parameters<typeof recordTrackerActivity>[3],
		opts,
	);
}

async function lookupPhaseInWorkspace(
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

async function releasePhaseItemsToNoPhase(
	trx: DBExecutor,
	projectId: number,
	phaseId: number,
): Promise<
	Array<{ itemId: number; projectId: number; phaseId: number | null }>
> {
	const items = await trx
		.selectFrom("tracker_items")
		.select(["id", "project_id", "phase_id", "position"])
		.where("phase_id", "=", phaseId)
		.where("deleted_at", "is", null)
		.orderBy("position", "asc")
		.execute();

	const releasedTriples = items.map((item) => ({
		itemId: item.id,
		projectId: item.project_id!,
		phaseId: item.phase_id,
	}));

	const bucketRow = await trx
		.selectFrom("tracker_items")
		.select(sql<number | null>`max(position)`.as("max_position"))
		.where("project_id", "=", projectId)
		.where("phase_id", "is", null)
		.where("deleted_at", "is", null)
		.executeTakeFirst();

	let prevPosition = bucketRow?.max_position ?? null;

	for (const item of items) {
		const newPosition = positionBetween(prevPosition, null);
		await trx
			.updateTable("tracker_items")
			.set({ phase_id: null, position: newPosition })
			.where("id", "=", item.id)
			.execute();
		prevPosition = newPosition;
	}

	return releasedTriples;
}

export const trackerPhasesRouter = Router({ mergeParams: true });

trackerPhasesRouter.post(
	"/tracker/projects/:projectId/phases",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;
		const actor = req.user!;
		const projectId = Number(req.params.projectId);
		const trimmedName =
			typeof req.body?.name === "string" ? req.body.name.trim() : "";

		if (!Number.isInteger(projectId) || projectId <= 0) {
			return res.status(400).json({ error: "invalid project id" });
		}

		if (!trimmedName) {
			return res.status(400).json({ error: "name is required" });
		}

		const hasDates = "startDate" in req.body || "endDate" in req.body;
		let startDate: string | null = null;
		let endDate: string | null = null;
		if (hasDates) {
			const parsed = parseDateRange(req.body ?? {});
			if ("error" in parsed) {
				return res.status(400).json({ error: parsed.error });
			}
			if ("startDate" in req.body) startDate = parsed.startDate;
			if ("endDate" in req.body) endDate = parsed.endDate;
		}

		const subtitle =
			typeof req.body?.subtitle === "string" ? req.body.subtitle : "";

		const created = await db.transaction().execute(async (trx) => {
			const project = await trx
				.selectFrom("tracker_projects")
				.select("id")
				.where("id", "=", projectId)
				.where("workspace_id", "=", workspaceId)
				.where("deleted_at", "is", null)
				.executeTakeFirst();

			if (!project) {
				return { kind: "not_found" as const };
			}

			const positionRow = await trx
				.selectFrom("tracker_phases")
				.select(sql<number | null>`max(position)`.as("max_position"))
				.where("project_id", "=", projectId)
				.where("deleted_at", "is", null)
				.executeTakeFirst();

			const position = positionBetween(positionRow?.max_position ?? null, null);

			const row = await trx
				.insertInto("tracker_phases")
				.values({
					project_id: projectId,
					name: trimmedName,
					subtitle,
					start_date: startDate,
					end_date: endDate,
					position,
				})
				.returning(PHASE_COLUMNS)
				.executeTakeFirstOrThrow();

			await recordPhaseActivity(trx, actor, workspaceId, "tracker_phase_created", {
				payload: { phaseId: row.id, projectId, name: trimmedName },
			});

			return { kind: "ok" as const, row };
		});

		if (created.kind === "not_found") {
			return res.status(404).json({ error: "Not found" });
		}

		await publishEvent(workspaceId, {
			type: "tracker.phase.created",
			actor,
		});

		res.status(201).json(serializePhase(created.row));
	},
);

trackerPhasesRouter.patch(
	"/tracker/phases/:id",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;
		const actor = req.user!;
		const phaseId = Number(req.params.id);
		const { name, version } = req.body ?? {};

		if (!Number.isInteger(phaseId) || phaseId <= 0) {
			return res.status(400).json({ error: "invalid phase id" });
		}

		const trimmedName = typeof name === "string" ? name.trim() : "";
		if (!trimmedName) {
			return res.status(400).json({ error: "name is required" });
		}

		if (typeof version !== "number" || !Number.isInteger(version)) {
			return res.status(400).json({ error: "version must be an integer" });
		}

		const phase = await lookupPhaseInWorkspace(db, workspaceId, phaseId);
		if (!phase) {
			return res.status(404).json({ error: "Not found" });
		}

		const hasDates = "startDate" in req.body || "endDate" in req.body;
		const setFields: Record<string, unknown> = {
			name: trimmedName,
			version: sql`version + 1`,
			updated_at: sql`now()`,
		};

		if (hasDates) {
			const parsed = parseDateRange(req.body ?? {});
			if ("error" in parsed) {
				return res.status(400).json({ error: parsed.error });
			}
			if ("startDate" in req.body) setFields.start_date = parsed.startDate;
			if ("endDate" in req.body) setFields.end_date = parsed.endDate;
		}

		const updated = await db
			.updateTable("tracker_phases")
			.set(setFields)
			.where("id", "=", phaseId)
			.where("deleted_at", "is", null)
			.where("version", "=", version)
			.returning(PHASE_COLUMNS)
			.executeTakeFirst();

		if (!updated) {
			const current = await db
				.selectFrom("tracker_phases as tp")
				.innerJoin("tracker_projects as tpr", "tpr.id", "tp.project_id")
				.select(["tp.id", "tp.version"])
				.where("tp.id", "=", phaseId)
				.where("tp.deleted_at", "is", null)
				.where("tpr.workspace_id", "=", workspaceId)
				.where("tpr.deleted_at", "is", null)
				.executeTakeFirst();

			if (!current) {
				return res.status(404).json({ error: "Not found" });
			}
			return res.status(409).json({
				error: "Someone else updated this phase first.",
				code: "version_conflict",
			});
		}

		await recordPhaseActivity(db, actor, workspaceId, "tracker_phase_updated", {
			payload: { phaseId, projectId: phase.project_id, name: trimmedName },
		});

		await publishEvent(workspaceId, {
			type: "tracker.phase.updated",
			actor,
		});

		res.json(serializePhase(updated));
	},
);

trackerPhasesRouter.delete(
	"/tracker/phases/:id",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;
		const actor = req.user!;
		const phaseId = Number(req.params.id);

		if (!Number.isInteger(phaseId) || phaseId <= 0) {
			return res.status(400).json({ error: "invalid phase id" });
		}

		const result = await db.transaction().execute(async (trx) => {
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
				.where("phase_id", "=", phaseId)
				.where("deleted_at", "is", null)
				.execute();

			const releasedTriples = await releasePhaseItemsToNoPhase(
				trx,
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

			await recordPhaseActivity(trx, actor, workspaceId, "tracker_phase_deleted", {
				payload: {
					phaseId,
					projectId: phase.project_id,
					released: releasedTriples,
				},
			});

			return { kind: "ok" as const, releasedCardIds };
		});

		if (result.kind === "not_found") {
			return res.status(404).json({ error: "Not found" });
		}

		for (const cardId of result.releasedCardIds) {
			await publishEvent(workspaceId, {
				type: "card.updated",
				actor,
				cardId,
			});
		}

		await publishEvent(workspaceId, {
			type: "tracker.phase.deleted",
			actor,
		});

		res.status(204).end();
	},
);
