import type { AuthUser } from "../../auth.js";
import { applyAction, type FocusAction } from "../../core/focus-session.js";
import { db } from "../../db/kysely.js";
import { recordActivity } from "../../lib/helpers.js";
import type { publishEvent } from "../../realtime.js";
import type { buildReadySessionInput } from "./focus-session-inputs.js";
import type {
	FocusSessionRepo,
	FocusSessionRow,
	FocusSessionUpdatePatch,
} from "./focus-session-repo.js";
import type { RecordFocusActivity } from "./focus-session-serialize.js";

export type FocusHandlerDeps = {
	repo: FocusSessionRepo;
	now: () => Date;
	publish: typeof publishEvent;
	recordFocusActivity: RecordFocusActivity;
};

export function buildLifecyclePatch(
	action: FocusAction,
	result: ReturnType<typeof applyAction>,
	now: Date,
): FocusSessionUpdatePatch {
	const patch: FocusSessionUpdatePatch = {
		state: result.state,
		accumulated_seconds: result.accumulatedSeconds,
		running_since: result.runningSince,
	};
	if (action === "finish") {
		patch.finished_at = now;
	}
	return patch;
}

export async function insertFocusSession(
	repo: FocusSessionRepo,
	actorId: number,
	workspaceId: number,
	input: ReturnType<typeof buildReadySessionInput>,
): Promise<
	| { status: "inserted"; session: FocusSessionRow }
	| { status: "conflict"; active: FocusSessionRow | null }
> {
	try {
		const inserted = await repo.insert(input);
		return { status: "inserted", session: inserted };
	} catch (err) {
		if ((err as { code?: string }).code === "23505") {
			const active = await repo.findActive(actorId, workspaceId);
			return { status: "conflict", active };
		}
		throw err;
	}
}

export async function autoFinishMissingTask(
	repo: FocusSessionRepo,
	session: FocusSessionRow,
	actor: AuthUser,
	workspaceId: number,
	now: Date,
	publish: typeof publishEvent,
	recordFocusActivity: RecordFocusActivity,
): Promise<{
	autoFinished: { reason: "task_missing"; taskKey: string | null };
} | null> {
	const finished = applyAction(
		{
			state: session.state,
			accumulatedSeconds: session.accumulated_seconds,
			runningSince: session.running_since,
		},
		"finish",
		now,
	);

	const updated = await repo.update(
		session.id,
		{
			state: "finished",
			accumulated_seconds: finished.accumulatedSeconds,
			running_since: null,
			finished_at: now,
		},
		session.version,
	);

	if (!updated) {
		return null;
	}

	await publish(workspaceId, {
		type: "focus_session.updated",
		userId: actor.id,
		workspaceId,
		payload: { session: null },
	});

	await recordFocusActivity({
		actor,
		workspaceId,
		sessionId: session.id,
		action: "auto_finish",
	});

	return {
		autoFinished: {
			reason: "task_missing",
			taskKey: session.task_key,
		},
	};
}

export const defaultRecordFocusActivity: RecordFocusActivity = ({
	actor,
	workspaceId,
	sessionId,
	action,
}) =>
	recordActivity(db, actor, workspaceId, "focus_session", {
		cardId: null,
		payload: {
			kind: "focus_session",
			action,
			sessionId,
			workspaceId,
			userId: actor.id,
		},
	});
