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
import { getRemovalRedirect } from "../lib/workspaceSelection";
import type {
	ActivityEvent,
	AgentEvent,
	Column,
	FlowMetrics,
	User,
} from "../types";
import { useShowToast } from "./ToastContext";
import { useWorkspace } from "./WorkspaceContext";

/** Trailing debounce for SSE-triggered refreshes. Chosen to coalesce burst
 *  events (e.g. own mutation + its echo) without noticeable UI lag. */
const REFRESH_DEBOUNCE_MS = 150;

/** Outcome of a save, so callers (e.g. the context panel) can react to a 409. */
export type SaveCardResult = "saved" | "conflict" | "error";

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
	columns: Column[] | null;
	setColumns: Dispatch<SetStateAction<Column[] | null>>;
	metrics: FlowMetrics | null;
	activity: ActivityEvent[];
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
	agentEvents: AgentEvent[];
	clearAgentEvents: () => void;
	clearFollowUpAgentEvents: () => void;
	ticketIntakeEvents: TicketIntakeResultEvent[];
	subscribeTrackerEvents: (handler: TrackerEventHandler) => () => void;
	subscribeFocusEvents: (handler: FocusEventHandler) => () => void;
	subscribeCardEvents: (handler: CardEventHandler) => () => void;
	subscribeMembershipEvents: (handler: MembershipEventHandler) => () => void;
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

export function BoardProvider({ children }: { children: ReactNode }) {
	const showToast = useShowToast();
	const {
		user,
		activeWorkspaceId,
		workspaces,
		switchWorkspace,
		reloadWorkspaces,
		refreshSettings,
		signOutLocally,
	} = useWorkspace();

	const [columns, setColumns] = useState<Column[] | null>(null);
	const [metrics, setMetrics] = useState<FlowMetrics | null>(null);
	const [activity, setActivity] = useState<ActivityEvent[]>([]);
	const [loadError, setLoadError] = useState(false);
	const [refreshTick, setRefreshTick] = useState(0);
	const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
	const [ticketIntakeEvents, setTicketIntakeEvents] = useState<
		TicketIntakeResultEvent[]
	>([]);
	const [boardWorkspaceId, setBoardWorkspaceId] = useState(activeWorkspaceId);
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
	const activeWorkspaceIdRef = useRef(activeWorkspaceId);
	activeWorkspaceIdRef.current = activeWorkspaceId;
	const workspacesRef = useRef(workspaces);
	workspacesRef.current = workspaces;

	// Render-phase reset: never paint new workspace id with stale board data.
	if (boardWorkspaceId !== activeWorkspaceId) {
		setBoardWorkspaceId(activeWorkspaceId);
		setColumns(null);
		setMetrics(null);
		setActivity([]);
		setLoadError(false);
	}

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
		const workspaceId = activeWorkspaceId;
		if (workspaceId === null) return;
		try {
			const [board, m, a] = await Promise.all([
				api.getBoard(workspaceId),
				api.getMetrics(workspaceId),
				api.getActivity(workspaceId),
			]);
			// Drop responses that belong to a workspace we already left.
			if (activeWorkspaceIdRef.current !== workspaceId) return;
			setColumns(board.columns);
			setMetrics(m);
			setActivity(a.events);
			setLoadError(false);
			setRefreshTick((t) => t + 1);
		} catch (err) {
			if (activeWorkspaceIdRef.current !== workspaceId) return;
			if (err instanceof ApiError && err.status === 401) {
				signOutLocally();
				return;
			}
			setLoadError(true);
		}
	}, [activeWorkspaceId, signOutLocally]);

	const refreshRef = useRef(refresh);
	refreshRef.current = refresh;

	const scheduleRefresh = useCallback(() => {
		if (refreshTimer.current) clearTimeout(refreshTimer.current);
		refreshTimer.current = setTimeout(() => {
			refreshTimer.current = null;
			void refreshRef.current();
		}, REFRESH_DEBOUNCE_MS);
	}, []);

	const cancelScheduledRefresh = useCallback(() => {
		if (refreshTimer.current) {
			clearTimeout(refreshTimer.current);
			refreshTimer.current = null;
		}
	}, []);

	// Board realtime wiring scoped to the active workspace (EventSource + membership redirect).
	useEffect(() => {
		if (activeWorkspaceId === null) return;

		void refresh();

		const stream = new EventSource(
			`/api/workspaces/${activeWorkspaceId}/events/stream`,
		);
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
						void reloadWorkspaces()
							.then(() => {
								switchWorkspace(redirect.nextWorkspaceId);
							})
							.catch((err) => {
								console.debug("membership reload failed", err);
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
				if (
					typeof data.type === "string" &&
					(data.type.startsWith("card.") || data.type.startsWith("attachment."))
				) {
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
			scheduleRefresh();
		};

		return () => {
			if (refreshTimer.current) {
				clearTimeout(refreshTimer.current);
				refreshTimer.current = null;
			}
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

	return (
		<BoardContext.Provider
			value={{
				columns,
				setColumns,
				metrics,
				activity,
				loadError,
				refreshTick,
				refresh,
				cancelScheduledRefresh,
				saveCard,
				deleteCard,
				agentEvents,
				clearAgentEvents,
				clearFollowUpAgentEvents,
				ticketIntakeEvents,
				subscribeTrackerEvents,
				subscribeFocusEvents,
				subscribeCardEvents,
				subscribeMembershipEvents,
				refreshTrackerList,
				registerRefreshTrackerList,
			}}
		>
			{children}
		</BoardContext.Provider>
	);
}
