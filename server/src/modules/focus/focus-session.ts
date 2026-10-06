import {
	type NextFunction,
	type Request,
	type Response,
	Router,
} from "express";
import { config } from "../../config.js";
import { db } from "../../db/kysely.js";
import { requireWorkspaceMember } from "../../middleware/workspace.js";
import { publishEvent } from "../../realtime.js";
import { createFocusPatchHandler } from "./focus-session-patch.js";
import { createFocusPostHandler } from "./focus-session-post.js";
import {
	createFocusSessionRepo,
	type FocusSessionRepo,
} from "./focus-session-repo.js";
import {
	type RecordFocusActivity,
	serializeFocusSession,
} from "./focus-session-serialize.js";
import {
	autoFinishMissingTask,
	defaultRecordFocusActivity,
} from "./focus-session-support.js";

export {
	type FocusAuditAction,
	type RecordFocusActivity,
	serializeFocusSession,
} from "./focus-session-serialize.js";

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
	const handlerDeps = { repo, now, publish, recordFocusActivity };

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

	router.post(
		"/focus-session",
		requireFocusModeEnabled,
		createFocusPostHandler(handlerDeps),
	);

	router.patch("/focus-session", createFocusPatchHandler(handlerDeps));

	return router;
}

const defaultRepo = createFocusSessionRepo(db);
export const focusSessionRouter = createFocusSessionRouter({
	repo: defaultRepo,
});
