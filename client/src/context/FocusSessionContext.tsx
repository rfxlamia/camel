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
import {
	ACCESS_REVOKED_TOAST,
	deletionEventTargetsFocusedTask,
	isActiveFocusSession,
	membershipRemovalTargetsUser,
	TASK_MISSING_TOAST,
} from "../lib/focusGuards";
import type { FocusSession, WorkItemSource } from "../types";
import { useBoard } from "./BoardContext";

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
			setHasActiveFocusSession(isActiveFocusSession(next));
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
				} else {
					adoptSession(response.session);
				}
				setLoading(false);
				setFocusSessionHydrated(true);
			})
			.catch((err) => {
				if (generation !== loadGeneration.current) return;
				if (err instanceof ApiError && err.status === 404) {
					adoptSession(null);
					setLoading(false);
					setFocusSessionHydrated(true);
					return;
				}
				// Unknown server state: stay unhydrated so the workspace-switch
				// guard keeps blocking rather than assuming no session exists.
				setLoading(false);
				setActionError(
					err instanceof ApiError
						? err.message
						: "Couldn't load your focus session.",
				);
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
		[activeWorkspaceId, adoptSession],
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
			if (
				!membershipRemovalTargetsUser(event, user.id, activeWorkspaceId)
			) {
				return;
			}
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
