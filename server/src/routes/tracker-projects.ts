import { Router } from "express";
import { sql } from "kysely";
import type { AuthUser } from "../auth.js";
import { positionBetween } from "../core/position.js";
import { type DBExecutor, db } from "../db/kysely.js";
import { requireWorkspaceMember } from "../middleware/workspace.js";
import { publishEvent } from "../realtime.js";
import { recordTrackerActivity } from "./tracker-activity.js";

export const TRACKER_PROJECT_LIMIT = 10;
export const TRACKER_PROJECT_CAP_ERROR = `You've reached the project limit (${TRACKER_PROJECT_LIMIT}).`;

const PROJECT_COLUMNS = [
	"id",
	"workspace_id",
	"name",
	"start_date",
	"end_date",
	"position",
	"version",
	"created_at",
	"updated_at",
] as const;

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

type ProjectRow = {
	id: number;
	workspace_id: number;
	name: string;
	start_date: Date | string | null;
	end_date: Date | string | null;
	position: number;
	version: number;
	created_at: Date | string;
	updated_at: Date | string;
};

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

type ProjectActivityEvent =
	| "tracker_project_created"
	| "tracker_project_updated"
	| "tracker_project_deleted";

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

function serializeProject(
	row: Partial<ProjectRow> & Pick<ProjectRow, "id" | "name" | "version">,
	phases: PhaseRow[] = [],
) {
	return {
		id: row.id,
		name: row.name,
		startDate: formatDate(row.start_date ?? null),
		endDate: formatDate(row.end_date ?? null),
		position: row.position ?? 0,
		version: row.version,
		phases: phases.map(serializePhase),
		...(row.created_at != null
			? { createdAt: formatTimestamp(row.created_at) }
			: {}),
		...(row.updated_at != null
			? { updatedAt: formatTimestamp(row.updated_at) }
			: {}),
	};
}

async function recordProjectActivity(
	dbExec: DBExecutor,
	actor: AuthUser,
	workspaceId: number,
	eventType: ProjectActivityEvent,
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

async function loadPhasesForProjects(
	dbExec: DBExecutor,
	projectIds: number[],
): Promise<Map<number, PhaseRow[]>> {
	if (projectIds.length === 0) return new Map();

	const rows = await dbExec
		.selectFrom("tracker_phases")
		.select(PHASE_COLUMNS)
		.where("project_id", "in", projectIds)
		.where("deleted_at", "is", null)
		.orderBy("position", "asc")
		.execute();

	const byProject = new Map<number, PhaseRow[]>();
	for (const row of rows) {
		const list = byProject.get(row.project_id) ?? [];
		list.push(row);
		byProject.set(row.project_id, list);
	}
	return byProject;
}

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
		const trimmedName =
			typeof req.body?.name === "string" ? req.body.name.trim() : "";

		if (!trimmedName) {
			return res.status(400).json({ error: "name is required" });
		}

		try {
			const created = await db.transaction().execute(async (trx) => {
				await trx
					.selectFrom("workspaces")
					.select("id")
					.where("id", "=", workspaceId)
					.forUpdate()
					.executeTakeFirstOrThrow();

				const capRow = await trx
					.selectFrom("tracker_projects")
					.select([
						sql<number>`count(*)::int`.as("n"),
						sql<number | null>`max(position)`.as("max_position"),
					])
					.where("workspace_id", "=", workspaceId)
					.where("deleted_at", "is", null)
					.executeTakeFirstOrThrow();

				if (capRow.n >= TRACKER_PROJECT_LIMIT) {
					const err = new Error("project cap") as Error & { cap?: boolean };
					err.cap = true;
					throw err;
				}

				const position = positionBetween(capRow.max_position ?? null, null);

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
		} catch (err: unknown) {
			const capErr = err as { cap?: boolean };
			if (capErr.cap) {
				return res.status(409).json({ error: TRACKER_PROJECT_CAP_ERROR });
			}
			throw err;
		}
	},
);

trackerProjectsRouter.patch(
	"/tracker/projects/:id",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;
		const actor = req.user!;
		const projectId = Number(req.params.id);
		const { name, version } = req.body ?? {};

		if (!Number.isInteger(projectId) || projectId <= 0) {
			return res.status(400).json({ error: "invalid project id" });
		}

		const trimmedName = typeof name === "string" ? name.trim() : "";
		if (!trimmedName) {
			return res.status(400).json({ error: "name is required" });
		}

		if (typeof version !== "number" || !Number.isInteger(version)) {
			return res.status(400).json({ error: "version must be an integer" });
		}

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

		await recordProjectActivity(db, actor, workspaceId, "tracker_project_updated", {
			payload: { projectId, name: trimmedName },
		});

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
		const projectId = Number(req.params.id);

		if (!Number.isInteger(projectId) || projectId <= 0) {
			return res.status(400).json({ error: "invalid project id" });
		}

		const released = await db.transaction().execute(async (trx) => {
			const project = await trx
				.selectFrom("tracker_projects")
				.select(["id"])
				.where("id", "=", projectId)
				.where("workspace_id", "=", workspaceId)
				.where("deleted_at", "is", null)
				.executeTakeFirst();

			if (!project) {
				return { kind: "not_found" as const };
			}

			const items = await trx
				.selectFrom("tracker_items")
				.select(["id", "project_id", "phase_id"])
				.where("project_id", "=", projectId)
				.where("deleted_at", "is", null)
				.execute();

			const releasedTriples = items.map((item) => ({
				itemId: item.id,
				projectId: item.project_id!,
				phaseId: item.phase_id,
			}));

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

			await trx
				.updateTable("tracker_items")
				.set({ project_id: null, phase_id: null })
				.where("project_id", "=", projectId)
				.execute();

			await recordProjectActivity(
				trx,
				actor,
				workspaceId,
				"tracker_project_deleted",
				{
					payload: { projectId, released: releasedTriples },
				},
			);

			return { kind: "ok" as const };
		});

		if (released.kind === "not_found") {
			return res.status(404).json({ error: "Not found" });
		}

		await publishEvent(workspaceId, {
			type: "tracker.project.deleted",
			actor,
		});

		res.status(204).end();
	},
);
