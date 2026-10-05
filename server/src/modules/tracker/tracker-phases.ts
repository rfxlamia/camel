import { Router } from "express";
import { sql } from "kysely";
import { positionBetween } from "../../core/position.js";
import { db } from "../../db/kysely.js";
import { parseDateRange } from "../../lib/tracker-item-parsers.js";
import { requireWorkspaceMember } from "../../middleware/workspace.js";
import { publishEvent } from "../../realtime.js";
import { parseWith, sendValidationError } from "../../validators/http.js";
import {
	deletePhaseTransaction,
	lookupPhaseInWorkspace,
	recordPhaseActivity,
} from "./tracker-phase-queries.js";
import { PHASE_COLUMNS, serializePhase } from "./tracker-phase-serialize.js";
import {
	nameField,
	phaseIdParam,
	projectIdParam,
	requiredVersion,
} from "./tracker-schemas.js";

export const trackerPhasesRouter = Router({ mergeParams: true });

trackerPhasesRouter.post(
	"/tracker/projects/:projectId/phases",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;
		const actor = req.user!;

		const parsedProjectId = parseWith(projectIdParam, req.params.projectId);
		if (!parsedProjectId.ok) {
			return sendValidationError(res, parsedProjectId.body);
		}
		const projectId = parsedProjectId.data;

		const parsedName = parseWith(nameField, req.body?.name);
		if (!parsedName.ok) return sendValidationError(res, parsedName.body);
		const trimmedName = parsedName.data;

		const hasDates = "startDate" in req.body || "endDate" in req.body;
		let startDate: string | null = null;
		let endDate: string | null = null;
		if (hasDates) {
			const parsed = parseDateRange(req.body ?? {});
			if ("error" in parsed) {
				return sendValidationError(res, { error: parsed.error });
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

			await recordPhaseActivity(
				trx,
				actor,
				workspaceId,
				"tracker_phase_created",
				{
					payload: { phaseId: row.id, projectId, name: trimmedName },
				},
			);

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

		const parsedPhaseId = parseWith(phaseIdParam, req.params.id);
		if (!parsedPhaseId.ok) return sendValidationError(res, parsedPhaseId.body);
		const phaseId = parsedPhaseId.data;

		const parsedName = parseWith(nameField, req.body?.name);
		if (!parsedName.ok) return sendValidationError(res, parsedName.body);
		const trimmedName = parsedName.data;

		const parsedVersion = parseWith(requiredVersion, req.body?.version);
		if (!parsedVersion.ok) return sendValidationError(res, parsedVersion.body);
		const version = parsedVersion.data;

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
				return sendValidationError(res, { error: parsed.error });
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

		const parsedPhaseId = parseWith(phaseIdParam, req.params.id);
		if (!parsedPhaseId.ok) return sendValidationError(res, parsedPhaseId.body);
		const phaseId = parsedPhaseId.data;

		const result = await deletePhaseTransaction(workspaceId, actor, phaseId);

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
