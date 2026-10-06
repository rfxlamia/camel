import type { AuthUser } from "../../auth.js";
import type { FocusSessionRow } from "./focus-session-repo.js";

export type FocusAuditAction =
	| "focus"
	| "switch"
	| "start"
	| "pause"
	| "resume"
	| "finish"
	| "auto_finish"
	| "membership_removed";

export type RecordFocusActivity = (input: {
	actor: AuthUser;
	workspaceId: number;
	sessionId: number;
	action: FocusAuditAction;
}) => Promise<void>;

export type FocusSessionDto = {
	id: number;
	state: FocusSessionRow["state"];
	accumulatedSeconds: number;
	runningSince: string | null;
	version: number;
	source: "board" | "tracker";
	taskId: number;
	taskKey: string | null;
	returnPath: string;
	finishedAt: string | null;
};

function formatTimestamp(value: Date | string | null): string | null {
	if (value == null) return null;
	if (value instanceof Date) return value.toISOString();
	return value;
}

export function serializeFocusSession(row: FocusSessionRow): FocusSessionDto {
	return {
		id: row.id,
		state: row.state,
		accumulatedSeconds: row.accumulated_seconds,
		runningSince: formatTimestamp(row.running_since),
		version: row.version,
		source: row.task_source,
		taskId: row.task_id,
		taskKey: row.task_key,
		returnPath: row.return_path,
		finishedAt: formatTimestamp(row.finished_at),
	};
}
