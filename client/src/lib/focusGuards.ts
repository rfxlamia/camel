import type { FocusSession } from "../types";

export const TASK_MISSING_TOAST =
	"Your focus session ended because the task is no longer available.";

export const ACCESS_REVOKED_TOAST =
	"Your focus session ended because you no longer have access to this workspace.";

export function isActiveFocusSession(session: FocusSession | null): boolean {
	return session !== null && session.state !== "finished";
}

export function deletionEventTargetsFocusedTask(
	current: FocusSession,
	event: {
		type: string;
		cardId?: number;
		trackerItemId?: number;
	},
): boolean {
	if (event.type === "card.deleted") {
		if (current.source !== "board") return false;
		return event.cardId === current.taskId;
	}
	if (event.type === "tracker.deleted") {
		if (current.source !== "tracker") return false;
		if (event.trackerItemId === undefined) return false;
		return event.trackerItemId === current.taskId;
	}
	return false;
}

export function membershipRemovalTargetsUser(
	event: { userId: number; workspaceId: number },
	userId: number,
	workspaceId: number,
): boolean {
	return event.userId === userId && event.workspaceId === workspaceId;
}
