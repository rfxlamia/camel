import { Router } from "express";
import { sql } from "kysely";
import { positionBetween } from "../../core/position.js";
import { db } from "../../db/kysely.js";
import { requireWorkspaceMember } from "../../middleware/workspace.js";
import { publishEvent } from "../../realtime.js";
import { parseWith, sendValidationError } from "../../validators/http.js";
import { deleteProjectTransaction } from "./tracker-project-delete.js";
import {
	loadPhasesForProjects,
	PROJECT_COLUMNS,
	recordProjectActivity,
	serializeProject,
} from "./tracker-project-serialize.js";
import {
	nameField,
	projectIdParam,
	requiredVersion,
} from "./tracker-schemas.js";

export const trackerProjectsRouter = Router({ mergeParams: true });

trackerProjectsRouter.get(
	"/tracker/projects",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;

		const projects = await db
			.selectFrom("tracker_projects")
			.select(PROJECT_COLUMNS)
			.where("workspace_id", "=", workspaceId)
			.where("deleted_at", "is", null)
			.orderBy("position", "asc")
			.execute();

		const phasesByProject = await loadPhasesForProjects(
			db,
			projects.map((p) => p.id),
		);

		res.json(
			projects.map((project) =>
				serializeProject(project, phasesByProject.get(project.id) ?? []),
			),
		);
	},
);

trackerProjectsRouter.post(
	"/tracker/projects",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;
		const actor = req.user!;

		const parsedName = parseWith(nameField, req.body?.name);
		if (!parsedName.ok) return sendValidationError(res, parsedName.body);
		const trimmedName = parsedName.data;

		const created = await db.transaction().execute(async (trx) => {
			await trx
				.selectFrom("workspaces")
				.select("id")
				.where("id", "=", workspaceId)
				.forUpdate()
				.executeTakeFirstOrThrow();

			// Lock is held before this read so concurrent creates can't both
			// compute the same max(position) and insert colliding positions.
			const positionRow = await trx
				.selectFrom("tracker_projects")
				.select(sql<number | null>`max(position)`.as("max_position"))
				.where("workspace_id", "=", workspaceId)
				.where("deleted_at", "is", null)
				.executeTakeFirstOrThrow();

			const position = positionBetween(positionRow.max_position ?? null, null);

			const row = await trx
				.insertInto("tracker_projects")
				.values({
					workspace_id: workspaceId,
					name: trimmedName,
					position,
				})
				.returning(PROJECT_COLUMNS)
				.executeTakeFirstOrThrow();

			await recordProjectActivity(
				trx,
				actor,
				workspaceId,
				"tracker_project_created",
				{
					payload: { projectId: row.id, name: trimmedName },
				},
			);

			return row;
		});

		await publishEvent(workspaceId, {
			type: "tracker.project.created",
			actor,
		});
		res.status(201).json(serializeProject(created));
	},
);

trackerProjectsRouter.patch(
	"/tracker/projects/:id",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;
		const actor = req.user!;

		const parsedProjectId = parseWith(projectIdParam, req.params.id);
		if (!parsedProjectId.ok) {
			return sendValidationError(res, parsedProjectId.body);
		}
		const projectId = parsedProjectId.data;

		const parsedName = parseWith(nameField, req.body?.name);
		if (!parsedName.ok) return sendValidationError(res, parsedName.body);
		const trimmedName = parsedName.data;

		const parsedVersion = parseWith(requiredVersion, req.body?.version);
		if (!parsedVersion.ok) return sendValidationError(res, parsedVersion.body);
		const version = parsedVersion.data;

		const updated = await db
			.updateTable("tracker_projects")
			.set({
				name: trimmedName,
				version: sql`version + 1`,
				updated_at: sql`now()`,
			})
			.where("id", "=", projectId)
			.where("workspace_id", "=", workspaceId)
			.where("deleted_at", "is", null)
			.where("version", "=", version)
			.returning(PROJECT_COLUMNS)
			.executeTakeFirst();

		if (!updated) {
			const current = await db
				.selectFrom("tracker_projects")
				.select(["id", "version"])
				.where("id", "=", projectId)
				.where("workspace_id", "=", workspaceId)
				.where("deleted_at", "is", null)
				.executeTakeFirst();

			if (!current) {
				return res.status(404).json({ error: "Not found" });
			}
			return res.status(409).json({
				error: "Someone else updated this project first.",
				code: "version_conflict",
			});
		}

		await recordProjectActivity(
			db,
			actor,
			workspaceId,
			"tracker_project_updated",
			{
				payload: { projectId, name: trimmedName },
			},
		);

		await publishEvent(workspaceId, {
			type: "tracker.project.updated",
			actor,
		});

		res.json(serializeProject(updated, []));
	},
);

trackerProjectsRouter.delete(
	"/tracker/projects/:id",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;
		const actor = req.user!;

		const parsedProjectId = parseWith(projectIdParam, req.params.id);
		if (!parsedProjectId.ok) {
			return sendValidationError(res, parsedProjectId.body);
		}
		const projectId = parsedProjectId.data;

		const released = await deleteProjectTransaction(
			workspaceId,
			actor,
			projectId,
		);

		if (released.kind === "not_found") {
			return res.status(404).json({ error: "Not found" });
		}

		await publishEvent(workspaceId, {
			type: "tracker.project.deleted",
			actor,
		});
		for (const cardId of released.releasedCardIds) {
			await publishEvent(workspaceId, {
				type: "card.updated",
				actor,
				cardId,
			});
		}

		res.status(204).end();
	},
);
