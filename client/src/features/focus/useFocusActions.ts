import { useCallback } from "react";
import { ApiError, api } from "../../api";
import type { FocusSession, WorkItemSource } from "../../types";

export interface FocusSessionActions {
	focus: (params: { source: WorkItemSource; taskId: number }) => Promise<void>;
	switchTo: (params: {
		source: WorkItemSource;
		taskId: number;
		version: number;
		sessionId: number;
	}) => Promise<void>;
	start: () => Promise<void>;
	pause: () => Promise<void>;
	resume: () => Promise<void>;
	finish: () => Promise<FocusSession>;
}

interface UseFocusActionsParams {
	activeWorkspaceId: number | null;
	session: FocusSession | null;
	adoptSession: (next: FocusSession | null) => void;
	setActionError: (message: string | null) => void;
}

export function useFocusActions({
	activeWorkspaceId,
	session,
	adoptSession,
	setActionError,
}: UseFocusActionsParams): FocusSessionActions {
	const reconcileVersionConflict = useCallback(
		(err: ApiError): boolean => {
			if (err.status !== 409 || err.code !== "version_conflict") return false;
			adoptSession(err.session ?? null);
			setActionError(null);
			return true;
		},
		[adoptSession, setActionError],
	);

	const handleMutationError = useCallback(
		(err: unknown): void => {
			if (!(err instanceof ApiError)) throw err;
			if (reconcileVersionConflict(err)) return;
			if (err.status >= 500 || err.status === 409) {
				setActionError(err.message);
				return;
			}
			throw err;
		},
		[reconcileVersionConflict, setActionError],
	);

	const runPost = useCallback(
		async (body: {
			action: "focus" | "switch";
			source: WorkItemSource;
			taskId: number;
			version?: number;
			sessionId?: number;
		}) => {
			if (activeWorkspaceId === null) return;
			setActionError(null);
			try {
				const { session: next } = await api.focus.post(activeWorkspaceId, body);
				adoptSession(next);
				setActionError(null);
			} catch (err) {
				if (!(err instanceof ApiError)) throw err;
				if (err.code === "session_active") {
					adoptSession(err.session ?? null);
					throw err;
				}
				if (err.status === 409 && err.code === "version_conflict") {
					const adopted = err.session ?? null;
					adoptSession(adopted);
					const landedOnTarget =
						adopted !== null &&
						adopted.source === body.source &&
						adopted.taskId === body.taskId;
					if (landedOnTarget) {
						setActionError(null);
						return;
					}
					throw err;
				}
				if (err.status >= 500 || err.status === 409) {
					setActionError(err.message);
				}
				throw err;
			}
		},
		[activeWorkspaceId, adoptSession, setActionError],
	);

	const runPatchAction = useCallback(
		async (
			action: "start" | "pause" | "resume" | "finish",
		): Promise<FocusSession | undefined> => {
			if (activeWorkspaceId === null || session === null) return undefined;
			setActionError(null);
			try {
				const { session: next } = await api.focus.patch(activeWorkspaceId, {
					action,
					version: session.version,
					sessionId: session.id,
				});
				setActionError(null);
				if (action === "finish") {
					adoptSession(null);
					return next;
				}
				adoptSession(next);
				return next;
			} catch (err) {
				handleMutationError(err);
				return undefined;
			}
		},
		[
			activeWorkspaceId,
			adoptSession,
			handleMutationError,
			session,
			setActionError,
		],
	);

	const focus = useCallback(
		(params: { source: WorkItemSource; taskId: number }) =>
			runPost({ action: "focus", ...params }),
		[runPost],
	);

	const switchTo = useCallback(
		(params: {
			source: WorkItemSource;
			taskId: number;
			version: number;
			sessionId: number;
		}) => runPost({ action: "switch", ...params }),
		[runPost],
	);

	const start = useCallback(
		() => runPatchAction("start").then(() => undefined),
		[runPatchAction],
	);

	const pause = useCallback(
		() => runPatchAction("pause").then(() => undefined),
		[runPatchAction],
	);

	const resume = useCallback(
		() => runPatchAction("resume").then(() => undefined),
		[runPatchAction],
	);

	const finish = useCallback(async (): Promise<FocusSession> => {
		const finished = await runPatchAction("finish");
		if (!finished) {
			throw new Error("Finish failed");
		}
		return finished;
	}, [runPatchAction]);

	return { focus, switchTo, start, pause, resume, finish };
}
