import {
	createContext,
	type Dispatch,
	type ReactNode,
	type SetStateAction,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { ApiError, api } from "../api";
import type { TicketIntakeResultEvent } from "../hooks/useTicketIntakeChat";
import { shouldClearOnWorkspaceChange } from "../lib/agentStream";
import {
	type BoardViewMode,
	readBoardViewMode,
	writeBoardViewMode,
} from "../lib/boardViewPrefs";
import {
	chooseInitialWorkspace,
	clearSavedWorkspaceId,
	getRemovalRedirect,
	persistWorkspaceId,
	readSavedWorkspaceId,
} from "../lib/workspaceSelection";
import {
	applyCreatedWorkspaceSelection,
	FOCUS_BLOCKED_TOAST,
	FOCUS_LOADING_TOAST,
	getSwitchAttemptState,
	persistRemindedInviteIds,
	readRemindedInviteIds,
} from "../lib/workspaceSwitcher";
import type {
	ActivityEvent,
	AgentEvent,
	Column,
	FlowMetrics,
	PresenceUser,
	SettingsMap,
	SwitchConfirmState,
	User,
	Workspace,
	WorkspaceInvite,
} from "../types";

const HEARTBEAT_INTERVAL_MS = 25_000;
const PRESENCE_REFRESH_MS = 30_000;
/** Trailing debounce for SSE-triggered refreshes. Chosen to coalesce burst
 *  events (e.g. own mutation + its echo) without noticeable UI lag. */
const REFRESH_DEBOUNCE_MS = 150;

/** Outcome of a save, so callers (e.g. the context panel) can react to a 409. */
export type SaveCardResult = "saved" | "conflict" | "error";

export type ToastType = "success" | "error" | "warning" | "info";

export type TrackerEventHandler = (event: {
	type: string;
	payload?: unknown;
	trackerItemId?: number;
}) => void;

export type FocusEventHandler = (event: {
	type: "focus_session.updated";
	userId: number;
	workspaceId: number;
	payload: { session: unknown };
}) => void;

export type CardEventHandler = (event: {
	type: string;
	actor: User;
	cardId: number;
	payload?: unknown;
}) => void;

export type MembershipEventHandler = (event: {
	type: "membership.removed";
	userId: number;
	workspaceId: number;
	workspaceName: string;
}) => void;

function createSubscriberRegistry<T>() {
	const subscribers = new Set<T>();
	return {
		subscribe(handler: T) {
			subscribers.add(handler);
			return () => {
				subscribers.delete(handler);
			};
		},
		dispatch(handler: (subscriber: T) => void) {
			for (const subscriber of subscribers) {
				handler(subscriber);
			}
		},
	};
}

interface BoardContextValue {
	user: User;
	activeWorkspaceId: number | null;
	activeWorkspace: Workspace | null;
	workspaces: Workspace[];
	pendingInvites: WorkspaceInvite[];
	pickerRequired: boolean;
	workspacesReady: boolean;
	remindedInviteIds: number[];
	hasUnsavedCardEdits: boolean;
	setHasUnsavedCardEdits: (dirty: boolean) => void;
	switchConfirm: SwitchConfirmState;
	attemptSwitchWorkspace: (workspaceId: number) => void;
	confirmPendingSwitch: () => void;
	cancelPendingSwitch: () => void;
	switchWorkspace: (workspaceId: number) => void;
	reloadWorkspaces: () => Promise<Workspace[]>;
	acceptWorkspaceInvite: (invite: WorkspaceInvite) => Promise<void>;
	declineWorkspaceInvite: (invite: WorkspaceInvite) => Promise<void>;
	remindInviteLater: (invite: WorkspaceInvite) => void;
	openCreateWorkspace: () => void;
	closeCreateWorkspace: () => void;
	createWorkspaceOpen: boolean;
	submitCreateWorkspace: (name: string) => Promise<void>;
	columns: Column[] | null;
	setColumns: Dispatch<SetStateAction<Column[] | null>>;
	metrics: FlowMetrics | null;
	activity: ActivityEvent[];
	presence: PresenceUser[];
	loadError: boolean;
	refreshTick: number;
	refresh: () => Promise<void>;
	/** Cancel a pending debounced SSE refresh. Call before mutations to prevent
	 *  the debounced refresh from overwriting the mutation's own refresh. */
	cancelScheduledRefresh: () => void;
	saveCard: (
		id: number,
		patch: {
			title?: string;
			description?: string;
			assigneeIds?: number[];
			dueDate?: string | null;
			priorityId?: number | null;
			labelIds?: number[];
			projectId?: number | null;
			phaseId?: number | null;
			version?: number;
		},
	) => Promise<SaveCardResult>;
	deleteCard: (id: number) => Promise<void>;
	toast: { message: string; type: ToastType } | null;
	showToast: (message: string, type?: ToastType) => void;
	logout: () => Promise<void>;
	settings: SettingsMap;
	settingsVersion: number;
	refreshSettings: () => Promise<void>;
	agentEvents: AgentEvent[];
	clearAgentEvents: () => void;
	clearFollowUpAgentEvents: () => void;
	ticketIntakeEvents: TicketIntakeResultEvent[];
	ticketIntakeEnabled: boolean;
	focusModeEnabled: boolean;
	boardViewMode: BoardViewMode;
	setBoardViewMode: (mode: BoardViewMode) => void;
	subscribeTrackerEvents: (handler: TrackerEventHandler) => () => void;
	subscribeFocusEvents: (handler: FocusEventHandler) => () => void;
	subscribeCardEvents: (handler: CardEventHandler) => () => void;
	subscribeMembershipEvents: (handler: MembershipEventHandler) => () => void;
	hasActiveFocusSession: boolean;
	setHasActiveFocusSession: (active: boolean) => void;
	focusSessionHydrated: boolean;
	setFocusSessionHydrated: (hydrated: boolean) => void;
	/** Reload the tracker list page (registered by TrackerPage). */
	refreshTrackerList: () => void;
	registerRefreshTrackerList: (fn: (() => void) | null) => void;
}

const BoardContext = createContext<BoardContextValue | null>(null);

export function useBoard(): BoardContextValue {
	const ctx = useContext(BoardContext);
	if (!ctx) throw new Error("useBoard must be used within BoardProvider");
	return ctx;
}

interface Props {
	user: User;
	onSignedOut: () => void;
	children: ReactNode;
}

export function BoardProvider({ user, onSignedOut, children }: Props) {
	const [activeWorkspaceId, setActiveWorkspaceId] = useState<number | null>(
		null,
	);
	const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
	const [pendingInvites, setPendingInvites] = useState<WorkspaceInvite[]>([]);
	const [pickerRequired, setPickerRequired] = useState(false);
	const [workspacesReady, setWorkspacesReady] = useState(false);
	const [remindedInviteIds, setRemindedInviteIds] = useState<number[]>(() =>
		readRemindedInviteIds(),
	);
	const [hasUnsavedCardEdits, setHasUnsavedCardEdits] = useState(false);
	const [switchConfirm, setSwitchConfirm] = useState<SwitchConfirmState>({
		open: false,
	});
	const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
	const [columns, setColumns] = useState<Column[] | null>(null);
	const [metrics, setMetrics] = useState<FlowMetrics | null>(null);
	const [presence, setPresence] = useState<PresenceUser[]>([]);
	const [activity, setActivity] = useState<ActivityEvent[]>([]);
	const [loadError, setLoadError] = useState(false);
	const [refreshTick, setRefreshTick] = useState(0);
	const [toast, setToast] = useState<{
		message: string;
		type: ToastType;
	} | null>(null);
	const [settings, setSettings] = useState<SettingsMap>({
		boardName: "Camel",
		logoPath: "/logo.png",
		version: 0,
	});
	const [settingsVersion, setSettingsVersion] = useState(0);
	const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
	const [ticketIntakeEvents, setTicketIntakeEvents] = useState<
		TicketIntakeResultEvent[]
	>([]);
	const [ticketIntakeEnabled, setTicketIntakeEnabled] = useState(false);
	const [focusModeEnabled, setFocusModeEnabled] = useState(false);
	const [hasActiveFocusSession, setHasActiveFocusSession] = useState(false);
	const [focusSessionHydrated, setFocusSessionHydrated] = useState(false);
	const [boardViewMode, setBoardViewModeState] = useState<BoardViewMode>(() =>
		readBoardViewMode(activeWorkspaceId ?? 0),
	);
	const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const trackerEventRegistry = useRef(
		createSubscriberRegistry<TrackerEventHandler>(),
	);
	const focusEventRegistry = useRef(
		createSubscriberRegistry<FocusEventHandler>(),
	);
	const cardEventRegistry = useRef(
		createSubscriberRegistry<CardEventHandler>(),
	);
	const membershipEventRegistry = useRef(
		createSubscriberRegistry<MembershipEventHandler>(),
	);
	const trackerListRefreshRef = useRef<(() => void) | null>(null);
	const prevWorkspaceIdRef = useRef<number | null>(null);
	const workspacesRef = useRef(workspaces);
	workspacesRef.current = workspaces;
	const hasUnsavedRef = useRef(hasUnsavedCardEdits);
	hasUnsavedRef.current = hasUnsavedCardEdits;
	const hasActiveFocusRef = useRef(hasActiveFocusSession);
	hasActiveFocusRef.current = hasActiveFocusSession;
	const focusSessionHydratedRef = useRef(focusSessionHydrated);
	focusSessionHydratedRef.current = focusSessionHydrated;

	const activeWorkspace =
		activeWorkspaceId === null
			? null
			: (workspaces.find((w) => w.id === activeWorkspaceId) ?? null);

	// Ticket-intake availability (Linear API keys configured on server).
	useEffect(() => {
		let active = true;
		api.ticketIntake
			.getConfig()
			.then(({ enabled }) => {
				if (active) setTicketIntakeEnabled(enabled);
			})
			.catch(() => {
				if (active) setTicketIntakeEnabled(false);
			});
		return () => {
			active = false;
		};
	}, []);

	// Focus mode availability (FOCUS_MODE_ENABLED on server).
	useEffect(() => {
		let active = true;
		api.focus
			.getConfig()
			.then(({ enabled }) => {
				if (active) setFocusModeEnabled(enabled);
			})
			.catch(() => {
				if (active) setFocusModeEnabled(false);
			});
		return () => {
			active = false;
		};
	}, []);

	// Clear stale live agent events when switching workspaces (EC3).
	useEffect(() => {
		if (
			shouldClearOnWorkspaceChange(
				prevWorkspaceIdRef.current,
				activeWorkspaceId,
			)
		) {
			setAgentEvents([]);
			setTicketIntakeEvents([]);
		}
		prevWorkspaceIdRef.current = activeWorkspaceId;
	}, [activeWorkspaceId]);

	// Re-resolve view mode when active workspace changes.
	useEffect(() => {
		if (activeWorkspaceId === null) return;
		setBoardViewModeState(readBoardViewMode(activeWorkspaceId));
	}, [activeWorkspaceId]);

	const setBoardViewMode = useCallback(
		(mode: BoardViewMode) => {
			if (activeWorkspaceId === null) return;
			setBoardViewModeState(mode);
			writeBoardViewMode(activeWorkspaceId, mode);
		},
		[activeWorkspaceId],
	);

	const showToast = useCallback((message: string, type: ToastType = "info") => {
		setToast({ message, type });
		if (toastTimer.current) clearTimeout(toastTimer.current);
		toastTimer.current = setTimeout(() => setToast(null), 3500);
	}, []);

	const subscribeTrackerEvents = useCallback((handler: TrackerEventHandler) => {
		return trackerEventRegistry.current.subscribe(handler);
	}, []);

	const subscribeFocusEvents = useCallback((handler: FocusEventHandler) => {
		return focusEventRegistry.current.subscribe(handler);
	}, []);

	const subscribeCardEvents = useCallback((handler: CardEventHandler) => {
		return cardEventRegistry.current.subscribe(handler);
	}, []);

	const subscribeMembershipEvents = useCallback(
		(handler: MembershipEventHandler) => {
			return membershipEventRegistry.current.subscribe(handler);
		},
		[],
	);

	const registerRefreshTrackerList = useCallback(
		(fn: (() => void) | null) => {
			trackerListRefreshRef.current = fn;
		},
		[],
	);

	const refreshTrackerList = useCallback(() => {
		trackerListRefreshRef.current?.();
	}, []);

	const clearAgentEvents = useCallback(() => setAgentEvents([]), []);

	const clearFollowUpAgentEvents = useCallback(
		() =>
			setAgentEvents((prev) =>
				prev.filter((e) => e.columnSlug !== "__notfirst__"),
			),
		[],
	);

	const refresh = useCallback(async () => {
		if (activeWorkspaceId === null) return;
		try {
			const [board, m, a] = await Promise.all([
				api.getBoard(activeWorkspaceId),
				api.getMetrics(activeWorkspaceId),
				api.getActivity(activeWorkspaceId),
			]);
			setColumns(board.columns);
			setMetrics(m);
			setActivity(a.events);
			setLoadError(false);
			setRefreshTick((t) => t + 1);
		} catch (err) {
			if (err instanceof ApiError && err.status === 401) {
				onSignedOut();
				return;
			}
			setLoadError(true);
		}
	}, [activeWorkspaceId, onSignedOut]);

	// Stable ref so the debounced callback always calls the latest refresh.
	const refreshRef = useRef(refresh);
	refreshRef.current = refresh;

	/** Trailing debounce: coalesces burst SSE events into a single refresh.
	 *  Uses a stable empty-deps callback + ref pattern (same as toastTimer). */
	const scheduleRefresh = useCallback(() => {
		if (refreshTimer.current) clearTimeout(refreshTimer.current);
		refreshTimer.current = setTimeout(() => {
			refreshTimer.current = null;
			void refreshRef.current();
		}, REFRESH_DEBOUNCE_MS);
	}, []);

	/** Cancel a pending debounced refresh. Call before mutations to prevent
	 *  the debounced refresh from overwriting the mutation's own refresh. */
	const cancelScheduledRefresh = useCallback(() => {
		if (refreshTimer.current) {
			clearTimeout(refreshTimer.current);
			refreshTimer.current = null;
		}
	}, []);

	const refreshSettings = useCallback(async () => {
		if (activeWorkspaceId === null) return;
		const s = await api.getSettings(activeWorkspaceId);
		setSettings(s);
		setSettingsVersion(s.version);
	}, [activeWorkspaceId]);

	const reloadWorkspaces = useCallback(async () => {
		const { workspaces: list, pendingInvites: invites } =
			await api.getWorkspaces();
		setWorkspaces(list);
		setPendingInvites(invites);
		return list;
	}, []);

	const switchWorkspace = useCallback((workspaceId: number) => {
		setHasUnsavedCardEdits(false);
		setSwitchConfirm({ open: false });
		setActiveWorkspaceId(workspaceId);
		persistWorkspaceId(workspaceId);
		setPickerRequired(false);
		setColumns(null);
		setMetrics(null);
		setActivity([]);
		setPresence([]);
		setLoadError(false);
	}, []);

	const guardFocusBeforeSwitch = useCallback((): boolean => {
		if (!focusSessionHydratedRef.current) {
			showToast(FOCUS_LOADING_TOAST, "warning");
			return false;
		}
		if (hasActiveFocusRef.current) {
			showToast(FOCUS_BLOCKED_TOAST, "warning");
			return false;
		}
		return true;
	}, [showToast]);

	const attemptSwitchWorkspace = useCallback(
		(workspaceId: number) => {
			const state = getSwitchAttemptState({
				activeWorkspaceId,
				targetWorkspaceId: workspaceId,
				hasUnsavedCardEdits: hasUnsavedRef.current,
				hasActiveFocusSession: hasActiveFocusRef.current,
				focusSessionHydrated: focusSessionHydratedRef.current,
			});
			if (state.status === "noop") return;
			if (state.status === "focus-loading") {
				showToast(FOCUS_LOADING_TOAST, "warning");
				return;
			}
			if (state.status === "focus-blocked") {
				showToast(FOCUS_BLOCKED_TOAST, "warning");
				return;
			}
			if (state.status === "confirm-required") {
				setSwitchConfirm({
					open: true,
					pendingWorkspaceId: state.pendingWorkspaceId,
				});
				return;
			}
			switchWorkspace(state.workspaceId);
		},
		[activeWorkspaceId, showToast, switchWorkspace],
	);

	const confirmPendingSwitch = useCallback(() => {
		if (!switchConfirm.open) return;
		const pendingWorkspaceId = switchConfirm.pendingWorkspaceId;
		setSwitchConfirm({ open: false });
		if (!guardFocusBeforeSwitch()) return;
		switchWorkspace(pendingWorkspaceId);
	}, [switchConfirm, switchWorkspace, guardFocusBeforeSwitch]);

	const cancelPendingSwitch = useCallback(() => {
		setSwitchConfirm({ open: false });
	}, []);

	const acceptWorkspaceInvite = useCallback(
		async (invite: WorkspaceInvite) => {
			try {
				await api.acceptInvite(invite.workspaceId, invite.id);
				const list = await reloadWorkspaces();
				if (!guardFocusBeforeSwitch()) return;
				switchWorkspace(
					list.find((w) => w.id === invite.workspaceId)?.id ??
						invite.workspaceId,
				);
			} catch (err) {
				if (err instanceof ApiError && err.status === 409) {
					showToast(
						err.message || "Couldn't accept the invite. Try again.",
						"error",
					);
					return;
				}
				showToast("Couldn't accept the invite. Try again.", "error");
			}
		},
		[reloadWorkspaces, showToast, switchWorkspace, guardFocusBeforeSwitch],
	);

	const declineWorkspaceInvite = useCallback(
		async (invite: WorkspaceInvite) => {
			try {
				await api.declineInvite(invite.workspaceId, invite.id);
				await reloadWorkspaces();
			} catch {
				showToast("Couldn't decline the invite. Try again.", "error");
			}
		},
		[reloadWorkspaces, showToast],
	);

	const remindInviteLater = useCallback((invite: WorkspaceInvite) => {
		setRemindedInviteIds((prev) => {
			if (prev.includes(invite.id)) return prev;
			const next = [...prev, invite.id];
			persistRemindedInviteIds(next);
			return next;
		});
	}, []);

	const openCreateWorkspace = useCallback(() => {
		setCreateWorkspaceOpen(true);
	}, []);

	const closeCreateWorkspace = useCallback(() => {
		setCreateWorkspaceOpen(false);
	}, []);

	const submitCreateWorkspace = useCallback(
		async (name: string) => {
			const trimmed = name.trim();
			if (!trimmed) return;
			try {
				const prevIds = workspacesRef.current.map((w) => w.id);
				const created = await api.createWorkspace({ name: trimmed });
				await reloadWorkspaces();
				// .workspaces and .localStorageWrite are unused: reloadWorkspaces() and switchWorkspace() cover them.
				const selection = applyCreatedWorkspaceSelection({
					currentWorkspaceIds: prevIds,
					createdWorkspace: created,
				});
				setCreateWorkspaceOpen(false);
				if (!guardFocusBeforeSwitch()) return;
				switchWorkspace(selection.activeWorkspaceId);
				showToast(selection.toast, "success");
			} catch {
				showToast("Couldn't create the workspace. Try again.", "error");
			}
		},
		[reloadWorkspaces, showToast, switchWorkspace, guardFocusBeforeSwitch],
	);

	// Load workspace list and restore last-active workspace from localStorage.
	useEffect(() => {
		let active = true;
		void (async () => {
			try {
				const { workspaces: list, pendingInvites: invites } =
					await api.getWorkspaces();
				if (!active) return;
				const selection = chooseInitialWorkspace({
					workspaces: list,
					savedWorkspaceId: readSavedWorkspaceId(),
				});
				if (selection.clearSavedWorkspace) clearSavedWorkspaceId();
				setWorkspaces(list);
				setPendingInvites(invites);
				setPickerRequired(selection.pickerRequired);
				if (selection.activeWorkspaceId !== null) {
					setActiveWorkspaceId(selection.activeWorkspaceId);
					persistWorkspaceId(selection.activeWorkspaceId);
				}
			} catch (err) {
				if (err instanceof ApiError && err.status === 401) {
					onSignedOut();
					return;
				}
			} finally {
				if (active) setWorkspacesReady(true);
			}
		})();
		return () => {
			active = false;
		};
	}, [onSignedOut]);

	// Board + collaboration wiring scoped to the active workspace.
	useEffect(() => {
		if (activeWorkspaceId === null) return;

		void refresh();
		void refreshSettings();

		const beat = () => {
			void api
				.heartbeat(activeWorkspaceId)
				.catch((err) => console.debug("heartbeat failed", err));
			void api
				.getPresence(activeWorkspaceId)
				.then(({ users }) => setPresence(users))
				.catch((err) => console.debug("presence fetch failed", err));
		};
		beat();
		const heartbeatTimer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
		const presenceTimer = setInterval(
			() =>
				void api
					.getPresence(activeWorkspaceId)
					.then(({ users }) => setPresence(users))
					.catch((err) => console.debug("presence refresh failed", err)),
			PRESENCE_REFRESH_MS,
		);

		const stream = new EventSource(
			`/api/workspaces/${activeWorkspaceId}/events/stream`,
		);
		// Re-fetch board data whenever the SSE connection (re)opens — covers the
		// startup race where the server wasn't ready on first connect, leaving
		// loadError=true until the next board event arrived.
		stream.onopen = () => void refresh();
		stream.onmessage = (e) => {
			try {
				const data = JSON.parse(e.data) as {
					type?: string;
					userId?: number;
					workspaceId?: number;
					workspaceName?: string;
					role?: string;
				};
				if (
					data.type === "membership.role_changed" &&
					data.userId === user.id &&
					data.workspaceId === activeWorkspaceId
				) {
					void reloadWorkspaces();
					return;
				}
				if (
					data.type === "membership.removed" &&
					data.userId === user.id &&
					data.workspaceId !== undefined &&
					data.workspaceName
				) {
					const membershipEvent: Parameters<MembershipEventHandler>[0] = {
						type: "membership.removed",
						userId: data.userId,
						workspaceId: data.workspaceId,
						workspaceName: data.workspaceName,
					};
					membershipEventRegistry.current.dispatch((handler) => {
						handler(membershipEvent);
					});
					const redirect = getRemovalRedirect({
						activeWorkspaceId,
						removedWorkspaceId: data.workspaceId,
						removedWorkspaceName: data.workspaceName,
						workspaces: workspacesRef.current,
					});
					if (redirect) {
						showToast(redirect.toast, "warning");
						void reloadWorkspaces().then(() => {
							switchWorkspace(redirect.nextWorkspaceId);
						});
						return;
					}
				}
				if (data.type === "settings.updated") void refreshSettings();
				if (typeof data.type === "string" && data.type.startsWith("agent.")) {
					setAgentEvents((prev) => [...prev, data as AgentEvent]);
					return;
				}
				if (data.type === "ticket_intake.submit_result") {
					setTicketIntakeEvents((prev) => [
						...prev,
						data as TicketIntakeResultEvent,
					]);
					return;
				}
				if (data.type === "focus_session.updated") {
					const event = data as Parameters<FocusEventHandler>[0];
					focusEventRegistry.current.dispatch((handler) => {
						handler(event);
					});
					return;
				}
				if (typeof data.type === "string" && data.type.startsWith("card.")) {
					const event = data as Parameters<CardEventHandler>[0];
					cardEventRegistry.current.dispatch((handler) => {
						handler(event);
					});
				}
				if (typeof data.type === "string" && data.type.startsWith("tracker.")) {
					const event = data as {
						type: string;
						payload?: unknown;
						trackerItemId?: number;
					};
					trackerEventRegistry.current.dispatch((handler) => {
						handler(event);
					});
					return;
				}
			} catch {
				// non-JSON keep-alive comment
			}
			// Debounce: coalesce burst events (own mutation + echo, rapid updates)
			// into a single refresh.
			scheduleRefresh();
		};

		return () => {
			// Cancel pending debounced refresh — the new effect will call refresh()
			// on mount, so no event is truly lost.
			if (refreshTimer.current) {
				clearTimeout(refreshTimer.current);
				refreshTimer.current = null;
			}
			clearInterval(heartbeatTimer);
			clearInterval(presenceTimer);
			stream.close();
		};
	}, [
		activeWorkspaceId,
		refresh,
		refreshSettings,
		reloadWorkspaces,
		scheduleRefresh,
		showToast,
		switchWorkspace,
		user.id,
	]);

	const saveCard = useCallback(
		async (
			id: number,
			patch: {
				title?: string;
				description?: string;
				assigneeIds?: number[];
				dueDate?: string | null;
				priorityId?: number | null;
				labelIds?: number[];
				projectId?: number | null;
				phaseId?: number | null;
				version?: number;
			},
		): Promise<SaveCardResult> => {
			if (activeWorkspaceId === null) return "error";
			const current = columns
				?.flatMap((col) => col.cards)
				.find((c) => c.id === id);
			try {
				await api.updateCard(activeWorkspaceId, id, {
					...patch,
					version: patch.version ?? current?.version,
				});
				cancelScheduledRefresh();
				await refresh();
				return "saved";
			} catch (err) {
				if (err instanceof ApiError && err.code === "version_conflict") {
					showToast(
						"Someone else updated this card first — board refreshed.",
						"warning",
					);
					cancelScheduledRefresh();
					await refresh();
					return "conflict";
				}
				showToast(
					"Couldn't save the card. Check your connection and try again.",
					"error",
				);
				return "error";
			}
		},
		[activeWorkspaceId, columns, refresh, showToast, cancelScheduledRefresh],
	);

	const deleteCard = useCallback(
		async (id: number) => {
			if (activeWorkspaceId === null) return;
			const current = columns
				?.flatMap((col) => col.cards)
				.find((c) => c.id === id);
			await api.deleteCard(activeWorkspaceId, id, current?.version);
			cancelScheduledRefresh();
			await refresh();
		},
		[activeWorkspaceId, columns, refresh, cancelScheduledRefresh],
	);

	const logout = useCallback(async () => {
		try {
			await api.logout();
		} catch {
			// session cookie is gone either way
		}
		onSignedOut();
	}, [onSignedOut]);

	return (
		<BoardContext.Provider
			value={{
				user,
				activeWorkspaceId,
				activeWorkspace,
				workspaces,
				pendingInvites,
				pickerRequired,
				workspacesReady,
				remindedInviteIds,
				hasUnsavedCardEdits,
				setHasUnsavedCardEdits,
				switchConfirm,
				attemptSwitchWorkspace,
				confirmPendingSwitch,
				cancelPendingSwitch,
				switchWorkspace,
				reloadWorkspaces,
				acceptWorkspaceInvite,
				declineWorkspaceInvite,
				remindInviteLater,
				openCreateWorkspace,
				closeCreateWorkspace,
				createWorkspaceOpen,
				submitCreateWorkspace,
				columns,
				setColumns,
				metrics,
				activity,
				presence,
				loadError,
				refreshTick,
				refresh,
				cancelScheduledRefresh,
				saveCard,
				deleteCard,
				toast,
				showToast,
				logout,
				settings,
				settingsVersion,
				refreshSettings,
				agentEvents,
				clearAgentEvents,
				clearFollowUpAgentEvents,
				ticketIntakeEvents,
				ticketIntakeEnabled,
				focusModeEnabled,
				boardViewMode,
				setBoardViewMode,
				subscribeTrackerEvents,
				subscribeFocusEvents,
				subscribeCardEvents,
				subscribeMembershipEvents,
				hasActiveFocusSession,
				setHasActiveFocusSession,
				focusSessionHydrated,
				setFocusSessionHydrated,
				refreshTrackerList,
				registerRefreshTrackerList,
			}}
		>
			{children}
		</BoardContext.Provider>
	);
}
