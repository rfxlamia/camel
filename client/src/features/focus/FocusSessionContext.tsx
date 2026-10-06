import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { ApiError, api } from "../../api";
import { useShowToast } from "../../shared/ToastContext";
import { useWorkspace } from "../../shared/WorkspaceContext";
import type { FocusSession, WorkItemSource } from "../../types";
import { useBoard } from "../board";
import {
	ACCESS_REVOKED_TOAST,
	deletionEventTargetsFocusedTask,
	isActiveFocusSession,
	membershipRemovalTargetsUser,
	TASK_MISSING_TOAST,
} from "./focusGuards";
import { useFocusActions } from "./useFocusActions";

interface FocusSessionContextValue {
	session: FocusSession | null;
	loading: boolean;
	actionError: string | null;
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
		setHasActiveFocusSession,
		setFocusSessionHydrated,
	} = useWorkspace();
	const showToast = useShowToast();
	const {
		subscribeFocusEvents,
		subscribeCardEvents: subscribeCardEventsFromBoard,
		subscribeTrackerEvents: subscribeTrackerEventsFromBoard,
		subscribeMembershipEvents: subscribeMembershipEventsFromBoard,
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
			// Stay unhydrated: this phase also runs on every page load before the
			// workspace resolves, and FocusPage must not read it as "settled, no
			// session". The workspace-switch guard skips focus checks while no
			// workspace is active, so the picker is not blocked.
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

	const { focus, switchTo, start, pause, resume, finish } = useFocusActions({
		activeWorkspaceId,
		session,
		adoptSession,
		setActionError,
	});

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
			if (!membershipRemovalTargetsUser(event, user.id, activeWorkspaceId)) {
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
