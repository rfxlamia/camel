import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { ApiError, api } from "../api";
import type { FocusSession, WorkItemSource } from "../types";
import { useBoard } from "./BoardContext";

const TASK_MISSING_TOAST =
	"Your focus session ended because the task is no longer available.";

const ACCESS_REVOKED_TOAST =
	"Your focus session ended because you no longer have access to this workspace.";

function deletionEventTargetsFocusedTask(
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

interface FocusSessionContextValue {
	session: FocusSession | null;
	loading: boolean;
	actionError: string | null;
	focus: (params: {
		source: WorkItemSource;
		taskId: number;
	}) => Promise<void>;
	switchTo: (params: {
		source: WorkItemSource;
		taskId: number;
		version: number;
	}) => Promise<void>;
	start: () => Promise<void>;
	pause: () => Promise<void>;
	resume: () => Promise<void>;
	finish: () => Promise<FocusSession>;
}

const FocusSessionContext = createContext<FocusSessionContextValue | null>(
	null,
);

export function useFocusSession(): FocusSessionContextValue {
	const ctx = useContext(FocusSessionContext);
	if (!ctx) {
		throw new Error("useFocusSession must be used within FocusSessionProvider");
	}
	return ctx;
}

function isActiveSession(session: FocusSession | null): boolean {
	return session !== null && session.state !== "finished";
}

export function FocusSessionProvider({ children }: { children: ReactNode }) {
	const {
		activeWorkspaceId,
		user,
		showToast,
		subscribeFocusEvents,
		subscribeCardEvents: subscribeCardEventsFromBoard,
		subscribeTrackerEvents: subscribeTrackerEventsFromBoard,
		subscribeMembershipEvents: subscribeMembershipEventsFromBoard,
		setHasActiveFocusSession,
		setFocusSessionHydrated,
	} = useBoard();

	const subscribeCardEvents =
		subscribeCardEventsFromBoard ?? (() => () => undefined);
	const subscribeTrackerEvents =
		subscribeTrackerEventsFromBoard ?? (() => () => undefined);
	const subscribeMembershipEvents =
		subscribeMembershipEventsFromBoard ?? (() => () => undefined);

	const [session, setSession] = useState<FocusSession | null>(null);
	const [loading, setLoading] = useState(true);
	const [actionError, setActionError] = useState<string | null>(null);
	const loadGeneration = useRef(0);
	const sessionRef = useRef<FocusSession | null>(null);

	const adoptSession = useCallback(
		(next: FocusSession | null) => {
			setSession(next);
			setHasActiveFocusSession(isActiveSession(next));
		},
		[setHasActiveFocusSession],
	);

	useEffect(() => {
		if (activeWorkspaceId === null) {
			setSession(null);
			setLoading(false);
			setActionError(null);
			setHasActiveFocusSession(false);
			setFocusSessionHydrated(false);
			return;
		}

		const workspaceId = activeWorkspaceId;
		const generation = ++loadGeneration.current;
		setSession(null);
		setLoading(true);
		setActionError(null);
		setHasActiveFocusSession(false);
		setFocusSessionHydrated(false);

		void api.focus
			.get(workspaceId)
			.then((response) => {
				if (generation !== loadGeneration.current) return;
				if (response.autoFinished?.reason === "task_missing") {
					showToast(TASK_MISSING_TOAST, "warning");
					adoptSession(null);
					return;
				}
				adoptSession(response.session);
			})
			.catch((err) => {
				if (generation !== loadGeneration.current) return;
				if (err instanceof ApiError && err.status === 404) {
					adoptSession(null);
					return;
				}
				throw err;
			})
			.finally(() => {
				if (generation !== loadGeneration.current) return;
				setLoading(false);
				setFocusSessionHydrated(true);
			});

		return () => {
			loadGeneration.current += 1;
			setHasActiveFocusSession(false);
			setFocusSessionHydrated(false);
		};
	}, [
		activeWorkspaceId,
		adoptSession,
		setFocusSessionHydrated,
		setHasActiveFocusSession,
		showToast,
	]);

	useEffect(() => {
		sessionRef.current = session;
	}, [session]);

	useEffect(() => {
		if (activeWorkspaceId === null) return;
		return subscribeFocusEvents((event) => {
			if (event.userId !== user.id) return;
			if (event.workspaceId !== activeWorkspaceId) return;
			adoptSession(event.payload.session as FocusSession | null);
		});
	}, [activeWorkspaceId, adoptSession, subscribeFocusEvents, user.id]);

	const reconcileVersionConflict = useCallback(
		(err: ApiError): boolean => {
			if (err.status !== 409 || err.code !== "version_conflict") return false;
			adoptSession(err.session ?? null);
			setActionError(null);
			return true;
		},
		[adoptSession],
	);

	const handleMutationError = useCallback((err: unknown): void => {
		if (!(err instanceof ApiError)) throw err;
		if (reconcileVersionConflict(err)) return;
		if (err.status >= 500 || err.status === 409) {
			setActionError(err.message);
			return;
		}
		throw err;
	}, [reconcileVersionConflict]);

	const runPost = useCallback(
		async (body: {
			action: "focus" | "switch";
			source: WorkItemSource;
			taskId: number;
			version?: number;
		}) => {
			if (activeWorkspaceId === null) return;
			setActionError(null);
			try {
				const { session: next } = await api.focus.post(activeWorkspaceId, body);
				adoptSession(next);
				setActionError(null);
			} catch (err) {
				if (err instanceof ApiError && err.code === "session_active") {
					adoptSession(err.session ?? null);
					throw err;
				}
				handleMutationError(err);
			}
		},
		[activeWorkspaceId, adoptSession, handleMutationError],
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
		[activeWorkspaceId, adoptSession, handleMutationError, session],
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

	const autoFinishFromGuard = useCallback(
		async (message: string) => {
			if (sessionRef.current === null) return;
			try {
				await finish();
			} catch {
				// Guard clears locally even when finish fails (404, 409, 5xx).
			}
			adoptSession(null);
			showToast(message, "warning");
		},
		[adoptSession, finish, showToast],
	);

	useEffect(() => {
		return subscribeCardEvents((event) => {
			const current = sessionRef.current;
			if (current === null) return;
			if (!deletionEventTargetsFocusedTask(current, event)) return;
			void autoFinishFromGuard(TASK_MISSING_TOAST);
		});
	}, [autoFinishFromGuard, subscribeCardEvents]);

	useEffect(() => {
		return subscribeTrackerEvents((event) => {
			const current = sessionRef.current;
			if (current === null) return;
			if (!deletionEventTargetsFocusedTask(current, event)) return;
			void autoFinishFromGuard(TASK_MISSING_TOAST);
		});
	}, [autoFinishFromGuard, subscribeTrackerEvents]);

	useEffect(() => {
		if (activeWorkspaceId === null) return;
		return subscribeMembershipEvents((event) => {
			const current = sessionRef.current;
			if (current === null) return;
			if (event.userId !== user.id) return;
			if (event.workspaceId !== activeWorkspaceId) return;
			void autoFinishFromGuard(ACCESS_REVOKED_TOAST);
		});
	}, [
		activeWorkspaceId,
		autoFinishFromGuard,
		subscribeMembershipEvents,
		user.id,
	]);

	return (
		<FocusSessionContext.Provider
			value={{
				session,
				loading,
				actionError,
				focus,
				switchTo,
				start,
				pause,
				resume,
				finish,
			}}
		>
			{children}
		</FocusSessionContext.Provider>
	);
}
