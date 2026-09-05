import { derivePrefix, formatKey } from "../core/tracker-key.js";
import type {
	FocusSessionInsertInput,
	FocusSessionRow,
	ResolvedTask,
} from "./focus-session-repo.js";

export function targetsSameTask(
	session: Pick<FocusSessionRow, "task_source" | "task_id">,
	target: { source: "board" | "tracker"; taskId: number },
): boolean {
	return (
		session.task_source === target.source && session.task_id === target.taskId
	);
}

function buildTaskKey(
	source: "board" | "tracker",
	task: ResolvedTask,
): string | null {
	if (task.keyNumber === null) return null;
	return formatKey(derivePrefix(task.workspaceName), task.keyNumber);
}

function buildReturnPath(
	source: "board" | "tracker",
	task: ResolvedTask,
	taskKey: string | null,
): string {
	if (source === "board") {
		return `/board/card/${task.id}`;
	}
	return `/tracker/${taskKey}`;
}

export function buildReadySessionInput(input: {
	userId: number;
	workspaceId: number;
	source: "board" | "tracker";
	taskId: number;
	task: ResolvedTask;
}): FocusSessionInsertInput {
	const taskKey = buildTaskKey(input.source, input.task);
	const returnPath = buildReturnPath(input.source, input.task, taskKey);
	return {
		user_id: input.userId,
		workspace_id: input.workspaceId,
		task_source: input.source,
		task_id: input.taskId,
		task_key: taskKey,
		return_path: returnPath,
		state: "ready",
		accumulated_seconds: 0,
		running_since: null,
	};
}
