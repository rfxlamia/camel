import {
	type Dispatch,
	type MutableRefObject,
	type SetStateAction,
	useEffect,
} from "react";
import type { useShowToast } from "../../shared/ToastContext";
import type { TicketIntakeResultEvent } from "../../shared/useTicketIntakeChat";
import type { useWorkspace } from "../../shared/WorkspaceContext";
import { getRemovalRedirect } from "../../shared/workspaceSelection";
import type { AgentEvent } from "../../types";
import type {
	CardEventHandler,
	FocusEventHandler,
	MembershipEventHandler,
	SubscriberRegistry,
	TrackerEventHandler,
} from "./boardContextDefinition";

export function useBoardEventStream({
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
	userId,
	workspacesRef,
}: {
	activeWorkspaceId: number | null;
	cardEventRegistry: MutableRefObject<SubscriberRegistry<CardEventHandler>>;
	focusEventRegistry: MutableRefObject<SubscriberRegistry<FocusEventHandler>>;
	membershipEventRegistry: MutableRefObject<
		SubscriberRegistry<MembershipEventHandler>
	>;
	refresh: () => Promise<void>;
	refreshSettings: ReturnType<typeof useWorkspace>["refreshSettings"];
	refreshTimer: MutableRefObject<ReturnType<typeof setTimeout> | null>;
	reloadWorkspaces: ReturnType<typeof useWorkspace>["reloadWorkspaces"];
	scheduleRefresh: () => void;
	setAgentEvents: Dispatch<SetStateAction<AgentEvent[]>>;
	setTicketIntakeEvents: Dispatch<SetStateAction<TicketIntakeResultEvent[]>>;
	showToast: ReturnType<typeof useShowToast>;
	switchWorkspace: ReturnType<typeof useWorkspace>["switchWorkspace"];
	trackerEventRegistry: MutableRefObject<
		SubscriberRegistry<TrackerEventHandler>
	>;
	userId: number;
	workspacesRef: MutableRefObject<
		ReturnType<typeof useWorkspace>["workspaces"]
	>;
}) {
	// Board realtime wiring scoped to the active workspace (EventSource + membership redirect).
	// biome-ignore lint/correctness/useExhaustiveDependencies: registries and refs are stable for the provider lifetime.
	useEffect(() => {
		if (activeWorkspaceId === null) return;

		void refresh();

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
					data.userId === userId &&
					data.workspaceId === activeWorkspaceId
				) {
					void reloadWorkspaces();
					return;
				}
				if (
					data.type === "membership.removed" &&
					data.userId === userId &&
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
			// Cancel pending debounced refresh — the new effect will call refresh()
			// on mount, so no event is truly lost.
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
		userId,
	]);
}
