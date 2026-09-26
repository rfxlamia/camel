import { useEffect, useRef, useState } from "react";
import { api, type TicketHistoryEntry } from "../../api";
import { useWorkspace } from "../../shared/WorkspaceContext";
import type { ActivityEvent } from "../../types";
import { formatRelativeTime } from "../../types";
import type { useBoard } from "./BoardContext";
import { describeCardEvent } from "./cardPanel";
import { issueIdentifierFromUrl } from "./contextPanelPrimitives";

/**
 * Destructive action, deliberately parked at the end of the panel so it is
 * nowhere near Save (§16.2 — irreversible actions earn friction).
 */
export function DangerZone({ onDelete }: { onDelete: () => Promise<void> }) {
	return (
		<section
			aria-label="Danger zone"
			className="border-t border-neutral-200 px-4 py-4"
		>
			<button
				type="button"
				onClick={() => void onDelete()}
				className="rounded-md px-3 py-1.5 text-sm font-medium text-error-500 hover:bg-error-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
			>
				Delete card
			</button>
		</section>
	);
}

export function TicketHistorySection({ cardId }: { cardId: number }) {
	const { activeWorkspaceId } = useWorkspace();
	const [tickets, setTickets] = useState<TicketHistoryEntry[] | null>(null);

	useEffect(() => {
		if (activeWorkspaceId === null) return;
		let active = true;
		api.ticketIntake
			.getHistory(activeWorkspaceId, cardId)
			.then(({ tickets: history }) => {
				if (active) setTickets(history);
			})
			.catch((err) => console.warn("ticket history fetch failed", err));
		return () => {
			active = false;
		};
	}, [activeWorkspaceId, cardId]);

	return (
		<section
			aria-label="Ticket history"
			className="border-t border-neutral-200 px-4 py-4"
		>
			<h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-neutral-500">
				Ticket history
			</h3>
			{tickets === null && (
				<p className="mt-3 text-sm text-neutral-500">
					Loading ticket history...
				</p>
			)}
			{tickets !== null && tickets.length === 0 && (
				<p className="mt-3 text-sm text-neutral-500">
					No tickets reported yet.
				</p>
			)}
			{tickets !== null && tickets.length > 0 && (
				<ol className="mt-3 divide-y divide-neutral-100">
					{tickets.map((ticket) => (
						<li
							key={ticket.issueUrl}
							className="flex items-baseline justify-between gap-4 py-2.5"
						>
							<span className="min-w-0 text-sm leading-snug text-neutral-700">
								<span className="font-medium text-neutral-900">
									{ticket.title}
								</span>{" "}
								<a
									href={ticket.issueUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="text-primary-600 hover:text-primary-700 hover:underline"
								>
									{issueIdentifierFromUrl(ticket.issueUrl)}
								</a>
							</span>
							<time
								dateTime={ticket.createdAt}
								className="shrink-0 tabular-nums text-xs text-neutral-400"
							>
								{formatRelativeTime(ticket.createdAt)}
							</time>
						</li>
					))}
				</ol>
			)}
		</section>
	);
}

export function ActivitySection({
	board,
	cardId,
}: {
	board: ReturnType<typeof useBoard>;
	cardId: number;
}) {
	const { activeWorkspaceId } = useWorkspace();
	const { refreshTick } = board;
	const [events, setEvents] = useState<ActivityEvent[] | null>(null);
	const latestRefreshTickRef = useRef(refreshTick);
	latestRefreshTickRef.current = refreshTick;

	// Fetched on open and after every board refresh, so teammate changes show
	// up through the existing SSE → refresh model.
	useEffect(() => {
		if (activeWorkspaceId === null) return;
		const requestRefreshTick = refreshTick;
		let active = true;
		api
			.getCardActivity(activeWorkspaceId, cardId)
			.then(({ events }) => {
				if (active && latestRefreshTickRef.current === requestRefreshTick) {
					setEvents(events);
				}
			})
			.catch((err) => console.warn("card activity fetch failed", err));
		return () => {
			active = false;
		};
	}, [activeWorkspaceId, cardId, refreshTick]);

	return (
		<section
			aria-label="Activity"
			className="border-t border-neutral-200 px-4 py-4"
		>
			<h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-neutral-500">
				Activity
			</h3>
			{events === null && (
				<p className="mt-3 text-sm text-neutral-500">Loading activity...</p>
			)}
			{events !== null && events.length === 0 && (
				<p className="mt-3 text-sm text-neutral-500">No activity yet.</p>
			)}
			{events !== null && events.length > 0 && (
				<ol className="mt-3 divide-y divide-neutral-100">
					{events.map((e) => (
						<li
							key={e.id}
							className="flex items-baseline justify-between gap-4 py-2.5"
						>
							<span className="min-w-0 text-sm leading-snug text-neutral-700">
								<span className="font-medium text-neutral-900">
									{e.actor?.displayName ?? "Someone"}
								</span>{" "}
								{describeCardEvent(e)}
							</span>
							<time
								dateTime={e.createdAt}
								className="shrink-0 tabular-nums text-xs text-neutral-400"
							>
								{formatRelativeTime(e.createdAt)}
							</time>
						</li>
					))}
				</ol>
			)}
		</section>
	);
}
