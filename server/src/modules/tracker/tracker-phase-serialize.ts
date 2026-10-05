export const PHASE_COLUMNS = [
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

export type PhaseRow = {
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

export function formatDate(value: Date | string | null): string | null {
	if (value == null) return null;
	if (typeof value === "string") return value.slice(0, 10);
	return value.toISOString().slice(0, 10);
}

export function formatTimestamp(value: Date | string): string {
	if (value instanceof Date) return value.toISOString();
	return value;
}

export function serializePhase(row: PhaseRow) {
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
