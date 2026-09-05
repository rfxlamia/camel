import {
	type NextFunction,
	type Request,
	type Response,
	Router,
} from "express";
import type { AuthUser } from "../auth.js";
import { config } from "../config.js";
import {
	applyAction,
	type FocusAction,
	InvalidFocusTransitionError,
} from "../core/focus-session.js";
import { db } from "../db/kysely.js";
import { requireWorkspaceMember } from "../middleware/workspace.js";
import { publishEvent } from "../realtime.js";
import {
	buildReadySessionInput,
	targetsSameTask,
} from "./focus-session-inputs.js";
import {
	createFocusSessionRepo,
	type FocusSessionRepo,
	type FocusSessionRow,
	type FocusSessionUpdatePatch,
} from "./focus-session-repo.js";
import { recordActivity } from "./helpers.js";

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

type FocusSessionDto = {
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

function requireFocusModeEnabled(
	_req: Request,
	res: Response,
	next: NextFunction,
): void {
	if (config.FOCUS_MODE_ENABLED !== "true") {
		res.status(404).json({ error: "Not found" });
		return;
	}
	next();
}

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

function parseOptionalSessionIdentity(
	body: Record<string, unknown>,
): { version?: number; sessionId?: number } | null {
	const parsed: { version?: number; sessionId?: number } = {};
	if (body.version !== undefined) {
		if (typeof body.version !== "number" || !Number.isInteger(body.version)) {
			return null;
		}
		parsed.version = body.version;
	}
	if (body.sessionId !== undefined) {
		if (
			typeof body.sessionId !== "number" ||
			!Number.isInteger(body.sessionId)
		) {
			return null;
		}
		parsed.sessionId = body.sessionId;
	}
	return parsed;
}

function parseFocusPostBody(body: unknown): {
	action: "focus" | "switch";
	source: "board" | "tracker";
	taskId: number;
	version?: number;
	sessionId?: number;
} | null {
	if (body == null || typeof body !== "object") return null;
	const record = body as Record<string, unknown>;
	const { action, source, taskId } = record;
	if (action !== "focus" && action !== "switch") return null;
	if (source !== "board" && source !== "tracker") return null;
	if (typeof taskId !== "number" || !Number.isInteger(taskId)) return null;
	const identity = parseOptionalSessionIdentity(record);
	if (!identity) return null;
	return { action, source, taskId, ...identity };
}

const FOCUS_PATCH_ACTIONS = new Set<FocusAction>([
	"start",
	"pause",
	"resume",
	"finish",
]);

function parseFocusPatchBody(body: unknown): {
	action: FocusAction;
	version: number;
	sessionId: number;
} | null {
	if (body == null || typeof body !== "object") return null;
	const record = body as Record<string, unknown>;
	const { action } = record;
	if (
		typeof action !== "string" ||
		!FOCUS_PATCH_ACTIONS.has(action as FocusAction)
	) {
		return null;
	}
	const identity = parseOptionalSessionIdentity(record);
	if (
		!identity ||
		identity.version === undefined ||
		identity.sessionId === undefined
	) {
		return null;
	}
	return {
		action: action as FocusAction,
		version: identity.version,
		sessionId: identity.sessionId,
	};
}

function buildLifecyclePatch(
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

async function insertFocusSession(
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

async function autoFinishMissingTask(
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

const defaultRecordFocusActivity: RecordFocusActivity = ({
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

export function createFocusSessionRouter(deps: {
	repo: FocusSessionRepo;
	now?: () => Date;
	publish?: typeof publishEvent;
	recordFocusActivity?: RecordFocusActivity;
}) {
	const repo = deps.repo;
	const now = deps.now ?? (() => new Date());
	const publish = deps.publish ?? publishEvent;
	const recordFocusActivity =
		deps.recordFocusActivity ?? defaultRecordFocusActivity;

	const router = Router({ mergeParams: true });
	router.use(requireWorkspaceMember);

	router.get("/focus-session", async (req, res) => {
		const actor = req.user!;
		const workspaceId = req.workspace!.workspaceId;

		const session = await repo.findActive(actor.id, workspaceId);
		if (!session) {
			return res.json({ session: null });
		}

		const task = await repo.findTask(
			session.task_source,
			session.task_id,
			workspaceId,
		);
		if (!task) {
			const autoFinish = await autoFinishMissingTask(
				repo,
				session,
				actor,
				workspaceId,
				now(),
				publish,
				recordFocusActivity,
			);
			if (autoFinish) {
				return res.json({ session: null, ...autoFinish });
			}
			return res.json({ session: null });
		}

		return res.json({ session: serializeFocusSession(session) });
	});

	router.post("/focus-session", requireFocusModeEnabled, async (req, res) => {
		const actor = req.user!;
		const workspaceId = req.workspace!.workspaceId;

		const parsed = parseFocusPostBody(req.body);
		if (!parsed) {
			return res.status(400).json({ error: "Invalid request body" });
		}

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
				return res.status(400).json({ error: "Invalid request body" });
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
	});

	router.patch("/focus-session", async (req, res) => {
		const actor = req.user!;
		const workspaceId = req.workspace!.workspaceId;

		const parsed = parseFocusPatchBody(req.body);
		if (!parsed) {
			return res.status(400).json({ error: "Invalid request body" });
		}

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
	});

	return router;
}

const defaultRepo = createFocusSessionRepo(db);
export const focusSessionRouter = createFocusSessionRouter({
	repo: defaultRepo,
});
