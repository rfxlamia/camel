import type { TrackerEvent } from "../../types";
import { formatRelativeTime } from "../../types";

function describeTrackerEvent(event: TrackerEvent): string {
	const payload = event.payload;
	if (
		payload &&
		typeof payload.field === "string" &&
		"from" in payload &&
		"to" in payload
	) {
		const from = payload.from != null ? String(payload.from) : "—";
		const to = payload.to != null ? String(payload.to) : "—";
		return `${payload.field}: ${from} → ${to}`;
	}
	if (event.title) return event.title;
	return event.eventType.replace(/_/g, " ");
}

interface Props {
	events: TrackerEvent[];
}

export default function TrackerChangelog({ events }: Props) {
	if (events.length === 0) {
		return (
			<p className="text-sm text-neutral-500">No activity on this item yet.</p>
		);
	}

	return (
		<ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
			{events.map((event) => (
				<li key={event.id} className="px-4 py-3">
					<div className="flex items-start justify-between gap-3">
						<div className="min-w-0">
							<p className="text-sm font-medium text-neutral-900">
								{describeTrackerEvent(event)}
							</p>
							<p className="mt-0.5 text-xs text-neutral-500">
								{event.eventType}
								{event.actor ? ` · ${event.actor.displayName}` : ""}
							</p>
						</div>
						<time
							className="shrink-0 text-xs text-neutral-500 tabular-nums"
							dateTime={event.createdAt}
						>
							{formatRelativeTime(event.createdAt)}
						</time>
					</div>
				</li>
			))}
		</ul>
	);
}
