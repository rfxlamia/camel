import type { Request, Response } from "express";
import { applyAction } from "../../core/focus-session.js";
import { sendValidationError } from "../../validators/http.js";
import {
	buildReadySessionInput,
	targetsSameTask,
} from "./focus-session-inputs.js";
import {
	FOCUS_INVALID_BODY,
	parseFocusPostBody,
} from "./focus-session-parse.js";
import { serializeFocusSession } from "./focus-session-serialize.js";
import {
	type FocusHandlerDeps,
	insertFocusSession,
} from "./focus-session-support.js";

export function createFocusPostHandler(deps: FocusHandlerDeps) {
	const { repo, now, publish, recordFocusActivity } = deps;
	return async (req: Request, res: Response) => {
		const actor = req.user!;
		const workspaceId = req.workspace!.workspaceId;

		const parsedBody = parseFocusPostBody(req.body);
		if (!parsedBody.ok) return sendValidationError(res, parsedBody.body);
		const parsed = parsedBody.data;

		const { action, source, taskId } = parsed;

		const active = await repo.findActive(actor.id, workspaceId);

		if (action === "switch") {
			if (active && targetsSameTask(active, { source, taskId })) {
				return res.status(201).json({ session: serializeFocusSession(active) });
			}

			if (!active) {
				const task = await repo.findTask(source, taskId, workspaceId);
				if (!task) {
					return res.status(404).json({ error: "Not found" });
				}

				const result = await insertFocusSession(
					repo,
					actor.id,
					workspaceId,
					buildReadySessionInput({
						userId: actor.id,
						workspaceId,
						source,
						taskId,
						task,
					}),
				);

				if (result.status === "conflict") {
					if (
						result.active &&
						targetsSameTask(result.active, { source, taskId })
					) {
						return res
							.status(201)
							.json({ session: serializeFocusSession(result.active) });
					}
					return res.status(409).json({
						code: "session_active",
						session: result.active
							? serializeFocusSession(result.active)
							: null,
					});
				}

				const inserted = result.session;
				const session = serializeFocusSession(inserted);

				await publish(workspaceId, {
					type: "focus_session.updated",
					userId: actor.id,
					workspaceId,
					payload: { session },
				});

				await recordFocusActivity({
					actor,
					workspaceId,
					sessionId: inserted.id,
					action: "focus",
				});

				return res.status(201).json({ session });
			}

			if (parsed.version === undefined || parsed.sessionId === undefined) {
				return sendValidationError(res, { error: FOCUS_INVALID_BODY });
			}

			if (active.id !== parsed.sessionId) {
				return res.status(409).json({
					code: "version_conflict",
					session: serializeFocusSession(active),
				});
			}

			const task = await repo.findTask(source, taskId, workspaceId);
			if (!task) {
				return res.status(404).json({ error: "Not found" });
			}

			const finishedAt = now();
			const finishedSnapshot = applyAction(
				{
					state: active.state,
					accumulatedSeconds: active.accumulated_seconds,
					runningSince: active.running_since,
				},
				"finish",
				finishedAt,
			);

			const switched = await repo.switchSession(
				{
					id: parsed.sessionId,
					patch: {
						state: "finished",
						accumulated_seconds: finishedSnapshot.accumulatedSeconds,
						running_since: null,
						finished_at: finishedAt,
					},
					expectedVersion: parsed.version,
				},
				buildReadySessionInput({
					userId: actor.id,
					workspaceId,
					source,
					taskId,
					task,
				}),
			);

			if (!switched) {
				const current = await repo.findActive(actor.id, workspaceId);
				return res.status(409).json({
					code: "version_conflict",
					session: current ? serializeFocusSession(current) : null,
				});
			}

			const session = serializeFocusSession(switched.created);

			await publish(workspaceId, {
				type: "focus_session.updated",
				userId: actor.id,
				workspaceId,
				payload: { session },
			});

			await recordFocusActivity({
				actor,
				workspaceId,
				sessionId: switched.created.id,
				action: "switch",
			});

			return res.status(201).json({ session });
		}

		if (active && targetsSameTask(active, { source, taskId })) {
			return res.status(201).json({ session: serializeFocusSession(active) });
		}

		if (active) {
			return res.status(409).json({
				code: "session_active",
				session: serializeFocusSession(active),
			});
		}

		const task = await repo.findTask(source, taskId, workspaceId);
		if (!task) {
			return res.status(404).json({ error: "Not found" });
		}

		const result = await insertFocusSession(
			repo,
			actor.id,
			workspaceId,
			buildReadySessionInput({
				userId: actor.id,
				workspaceId,
				source,
				taskId,
				task,
			}),
		);

		if (result.status === "conflict") {
			if (result.active && targetsSameTask(result.active, { source, taskId })) {
				return res
					.status(201)
					.json({ session: serializeFocusSession(result.active) });
			}
			return res.status(409).json({
				code: "session_active",
				session: result.active ? serializeFocusSession(result.active) : null,
			});
		}

		const inserted = result.session;
		const session = serializeFocusSession(inserted);

		await publish(workspaceId, {
			type: "focus_session.updated",
			userId: actor.id,
			workspaceId,
			payload: { session },
		});

		await recordFocusActivity({
			actor,
			workspaceId,
			sessionId: inserted.id,
			action: "focus",
		});

		return res.status(201).json({ session });
	};
}
