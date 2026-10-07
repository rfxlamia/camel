import { resolveEventTitle } from "./event-title.js";
import type { WorkItemEvent } from "./work-item-events.js";

export function toTrackerEvent(e: {
	id: number;
	event_type: string;
	payload: unknown;
	created_at: Date;
	tracker_item_id: number | null;
	username: string | null;
	display_name: string | null;
	current_item_title: string | null;
}): WorkItemEvent {
	const payload = e.payload as
		| { title?: string }
		| Record<string, unknown>
		| null;
	const titleFromPayload =
		typeof payload?.title === "string" ? payload.title : null;
	return {
		id: e.id,
		eventType: e.event_type,
		trackerItemId: e.tracker_item_id,
		title: e.current_item_title ?? titleFromPayload,
		payload: payload ?? null,
		actor: e.username
			? { username: e.username, displayName: e.display_name }
			: null,
		createdAt: e.created_at.toISOString(),
	};
}

export function toCardTrackerEvent(e: {
	id: number;
	event_type: string;
	payload: unknown;
	created_at: Date;
	card_id: number | null;
	username: string | null;
	display_name: string | null;
	current_card_title: string | null;
	from_column_title: string | null;
	to_column_title: string | null;
}): WorkItemEvent {
	const payload = e.payload as Record<string, unknown> | null;
	const titleFromPayload = resolveEventTitle(payload);
	const eventType = e.event_type.startsWith("tracker_")
		? e.event_type
		: e.event_type === "create"
			? "tracker_item_created"
			: e.event_type === "delete"
				? "tracker_item_deleted"
				: "tracker_item_updated";
	return {
		id: e.id,
		eventType,
		trackerItemId: null,
		title: e.current_card_title ?? titleFromPayload,
		payload:
			e.event_type === "move"
				? {
						field: "status",
						from: e.from_column_title,
						to: e.to_column_title,
					}
				: (payload ?? null),
		actor: e.username
			? { username: e.username, displayName: e.display_name }
			: null,
		createdAt: e.created_at.toISOString(),
	};
}
