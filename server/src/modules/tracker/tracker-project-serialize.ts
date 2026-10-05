import type { AuthUser } from "../../auth.js";
import { type DBExecutor } from "../../db/kysely.js";
import { recordTrackerActivity } from "../../lib/tracker-activity.js";
import {
	formatDate,
	formatTimestamp,
	PHASE_COLUMNS,
	type PhaseRow,
	serializePhase,
} from "./tracker-phase-serialize.js";

export const PROJECT_COLUMNS = [
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

export type ProjectRow = {
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

type ProjectActivityEvent =
	| "tracker_project_created"
	| "tracker_project_updated"
	| "tracker_project_deleted";

export function serializeProject(
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

export async function recordProjectActivity(
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

export async function loadPhasesForProjects(
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
