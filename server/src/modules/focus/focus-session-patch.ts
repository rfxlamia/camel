import type { Request, Response } from "express";
import {
	applyAction,
	InvalidFocusTransitionError,
} from "../../core/focus-session.js";
import { sendValidationError } from "../../validators/http.js";
import { parseFocusPatchBody } from "./focus-session-parse.js";
import { serializeFocusSession } from "./focus-session-serialize.js";
import {
	buildLifecyclePatch,
	type FocusHandlerDeps,
} from "./focus-session-support.js";

export function createFocusPatchHandler(deps: FocusHandlerDeps) {
	const { repo, now, publish, recordFocusActivity } = deps;
	return async (req: Request, res: Response) => {
		const actor = req.user!;
		const workspaceId = req.workspace!.workspaceId;

		const result = parseFocusPatchBody(req.body);
		if (!result.ok) return sendValidationError(res, result.body);
		const parsed = result.data;

		const { action, version: expectedVersion, sessionId } = parsed;

		const active = await repo.findActive(actor.id, workspaceId);
		if (!active) {
			return res.status(404).json({ error: "Not found" });
		}

		if (active.id !== sessionId) {
			return res.status(409).json({
				code: "version_conflict",
				session: serializeFocusSession(active),
			});
		}

		const currentSession = serializeFocusSession(active);
		const actionAt = now();

		let nextSnapshot: ReturnType<typeof applyAction>;
		try {
			nextSnapshot = applyAction(
				{
					state: active.state,
					accumulatedSeconds: active.accumulated_seconds,
					runningSince: active.running_since,
				},
				action,
				actionAt,
			);
		} catch (error) {
			if (error instanceof InvalidFocusTransitionError) {
				return res.status(409).json({
					code: "invalid_transition",
					session: currentSession,
				});
			}
			throw error;
		}

		const updated = await repo.update(
			sessionId,
			buildLifecyclePatch(action, nextSnapshot, actionAt),
			expectedVersion,
		);

		if (!updated) {
			const current = await repo.findActive(actor.id, workspaceId);
			return res.status(409).json({
				code: "version_conflict",
				session: current ? serializeFocusSession(current) : null,
			});
		}

		const session = serializeFocusSession(updated);

		await publish(workspaceId, {
			type: "focus_session.updated",
			userId: actor.id,
			workspaceId,
			payload: {
				session: action === "finish" ? null : session,
			},
		});

		await recordFocusActivity({
			actor,
			workspaceId,
			sessionId: updated.id,
			action,
		});

		return res.json({ session });
	};
}
