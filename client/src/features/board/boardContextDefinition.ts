import {
	createContext,
	type Dispatch,
	type SetStateAction,
	useContext,
} from "react";
import type { TicketIntakeResultEvent } from "../../shared/useTicketIntakeChat";
import type {
	ActivityEvent,
	AgentEvent,
	Column,
	FlowMetrics,
	User,
} from "../../types";

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

export type SubscriberRegistry<T> = {
	subscribe(handler: T): () => void;
	dispatch(handler: (subscriber: T) => void): void;
};

export function createSubscriberRegistry<T>(): SubscriberRegistry<T> {
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

export const BoardContext = createContext<BoardContextValue | null>(null);

export function useBoard(): BoardContextValue {
	const ctx = useContext(BoardContext);
	if (!ctx) throw new Error("useBoard must be used within BoardProvider");
	return ctx;
}
