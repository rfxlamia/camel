import type { AuthUser } from "../auth.js";
import type { DBExecutor } from "../db/kysely.js";
import { recordActivity } from "./helpers.js";

export type TrackerItemEventType =
	| "tracker_item_created"
	| "tracker_item_updated"
	| "tracker_item_deleted";

/**
 * Tracker-style activity for a column-less `cards` row. Delegates to
 * `recordActivity`, the only writer of `card_events`; `card_events.event_type`
 * is plain TEXT, and the union in helpers.ts is not widened here because
 * helpers.ts is over the 300-line budget (300-on-touch).
 */
export async function recordTrackerItemActivity(
	dbExec: DBExecutor,
	actor: AuthUser,
	workspaceId: number,
	eventType: TrackerItemEventType,
	opts: { cardId: number; payload?: Record<string, unknown> },
): Promise<void> {
	await recordActivity(
		dbExec,
		actor,
		workspaceId,
		eventType as Parameters<typeof recordActivity>[3],
		opts,
	);
}
