import type { TrackerEvent } from "../../types";
import { formatRelativeTime } from "../../types";
import { Avatar } from "./TrackerGlyphs";

/**
 * Server-side field names as they arrive in `payload.changed`, phrased for a
 * sentence. Anything unmapped falls back to the raw name rather than hiding.
 */
const FIELD_LABELS: Record<string, string> = {
	title: "the title",
	description: "the description",
	status: "the status",
	priority: "the priority",
	assignees: "the assignees",
};

function listPhrase(parts: string[]): string {
	if (parts.length <= 1) return parts[0] ?? "";
	if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
	return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The sentence after the actor's name — "created this item", say. */
function describeTrackerEvent(event: TrackerEvent): string {
	const payload = event.payload;

	// A from/to shape is richer than the changed[] list, so it wins when present.
	if (
		payload &&
		typeof payload.field === "string" &&
		"from" in payload &&
		"to" in payload
	) {
		const field = FIELD_LABELS[payload.field] ?? payload.field;
		const from = payload.from != null ? String(payload.from) : "—";
		const to = payload.to != null ? String(payload.to) : "—";
		return `changed ${field} from ${from} to ${to}`;
	}

	switch (event.eventType) {
		case "tracker_item_created":
			return "created this item";
		case "tracker_item_deleted":
			return "deleted this item";
		case "tracker_item_updated": {
			const changed = Array.isArray(payload?.changed)
				? payload.changed
						.filter((f): f is string => typeof f === "string")
						.map((f) => FIELD_LABELS[f] ?? f)
				: [];
			return changed.length > 0
				? `changed ${listPhrase(changed)}`
				: "updated this item";
		}
		default:
			return event.eventType.replace(/_/g, " ");
	}
}

interface Props {
	events: TrackerEvent[];
}

/**
 * Activity feed. Deliberately low-contrast: it is history, not the item — the
 * eye should pass over it unless it is looking for something.
 */
export default function TrackerChangelog({ events }: Props) {
	if (events.length === 0) {
		return (
			<p className="text-neutral-500 text-sm">No activity on this item yet.</p>
		);
	}

	return (
		<ul className="space-y-0">
			{events.map((event, i) => {
				const actor = event.actor?.displayName ?? "Someone";
				return (
					<li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
						{/* Thread joining the entries, stopping at the last node. */}
						{i < events.length - 1 && (
							<span
								className="absolute top-6 bottom-0 left-[11px] w-px bg-neutral-200"
								aria-hidden
							/>
						)}
						<span className="relative mt-px shrink-0 rounded-full bg-white ring-4 ring-white">
							<Avatar name={actor} size={22} />
						</span>
						<p className="min-w-0 flex-1 text-sm leading-6">
							<span className="font-medium text-neutral-900">{actor}</span>{" "}
							<span className="text-neutral-600">
								{describeTrackerEvent(event)}
							</span>{" "}
							<time
								className="whitespace-nowrap text-neutral-400 text-xs tabular-nums"
								dateTime={event.createdAt}
							>
								· {formatRelativeTime(event.createdAt)}
							</time>
						</p>
					</li>
				);
			})}
		</ul>
	);
}
