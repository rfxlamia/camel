import { applyAction } from "../core/focus-session.js";
import type { AuthUser } from "../auth.js";
import type { RecordFocusActivity } from "./focus-session.js";
import type { FocusSessionRepo } from "./focus-session-repo.js";

export async function finishActiveFocusSessionForRemoval({
	repo,
	actor,
	userId,
	workspaceId,
	now,
	recordFocusActivity,
}: {
	repo: FocusSessionRepo;
	actor: AuthUser;
	userId: number;
	workspaceId: number;
	now: Date;
	recordFocusActivity: RecordFocusActivity;
}): Promise<boolean> {
	const session = await repo.findActive(userId, workspaceId);
	if (!session) {
		return false;
	}

	const finished = applyAction(
		{
			state: session.state,
			accumulatedSeconds: session.accumulated_seconds,
			runningSince: session.running_since,
		},
		"finish",
		now,
	);

	const updated = await repo.forceFinish(session.id, {
		state: finished.state,
		accumulated_seconds: finished.accumulatedSeconds,
		running_since: finished.runningSince,
		finished_at: now,
	});

	if (!updated) {
		return false;
	}

	await recordFocusActivity({
		actor,
		workspaceId,
		sessionId: session.id,
		action: "membership_removed",
	});

	return true;
}
