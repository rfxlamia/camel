import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { ApiError, api } from "../../api";
import { useShowToast } from "../../shared/ToastContext";
import type { TicketIntakeResultEvent } from "../../shared/useTicketIntakeChat";
import { useWorkspace } from "../../shared/WorkspaceContext";
import { shouldClearOnWorkspaceChange } from "../../shared/workspaceReset";
import type {
	ActivityEvent,
	AgentEvent,
	Column,
	FlowMetrics,
} from "../../types";
import {
	BoardContext,
	type CardEventHandler,
	createSubscriberRegistry,
	type FocusEventHandler,
	type MembershipEventHandler,
	type SaveCardResult,
	type TrackerEventHandler,
} from "./boardContextDefinition";
import { useBoardEventStream } from "./useBoardEventStream";

const REFRESH_DEBOUNCE_MS = 150;

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

	const registerRefreshTrackerList = useCallback((fn: (() => void) | null) => {
		trackerListRefreshRef.current = fn;
	}, []);

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

	// Stable ref so the debounced callback always calls the latest refresh.
	const refreshRef = useRef(refresh);
	refreshRef.current = refresh;

	/** Trailing debounce: coalesces burst SSE events into a single refresh.
	 *  Uses a stable empty-deps callback + ref pattern. */
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

	useBoardEventStream({
		activeWorkspaceId,
		cardEventRegistry,
		focusEventRegistry,
		membershipEventRegistry,
		refresh,
		refreshSettings,
		refreshTimer,
		reloadWorkspaces,
		scheduleRefresh,
		setAgentEvents,
		setTicketIntakeEvents,
		showToast,
		switchWorkspace,
		trackerEventRegistry,
		userId: user.id,
		workspacesRef,
	});

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
