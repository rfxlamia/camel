import type { AuthUser } from "../auth.js";
import type { DBExecutor } from "../db/kysely.js";

export async function recordTrackerActivity(
	dbExec: DBExecutor,
	actor: AuthUser,
	workspaceId: number,
	eventType:
		| "tracker_item_created"
		| "tracker_item_updated"
		| "tracker_item_deleted"
		| "tracker_vocabulary_created",
	opts: {
		trackerItemId?: number;
		payload?: Record<string, unknown>;
	},
): Promise<void> {
	await dbExec
		.insertInto("tracker_events")
		.values({
			tracker_item_id: opts.trackerItemId ?? null,
			actor_id: actor.id,
			event_type: eventType,
			payload: JSON.stringify(opts.payload ?? {}),
			workspace_id: workspaceId,
		})
		.execute();
}
