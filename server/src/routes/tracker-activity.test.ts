import { describe, expect, it, vi } from "vitest";
import { recordTrackerActivity } from "./tracker-activity.js";

function createMockExecutor() {
	const execute = vi.fn().mockResolvedValue(undefined);
	const values = vi.fn().mockReturnValue({ execute });
	const insertInto = vi.fn().mockReturnValue({ values });
	return { dbExec: { insertInto } as any, insertInto, values, execute };
}

const actor = { id: 7, username: "alice", displayName: "Alice" };

describe("recordTrackerActivity", () => {
	it("inserts tracker_events row with event_type and JSONB payload", async () => {
		const { dbExec, insertInto, values, execute } = createMockExecutor();

		await recordTrackerActivity(dbExec, actor, 42, "tracker_item_created", {
			trackerItemId: 99,
			payload: { title: "Fix realtime" },
		});

		expect(insertInto).toHaveBeenCalledWith("tracker_events");
		expect(values).toHaveBeenCalledWith({
			tracker_item_id: 99,
			actor_id: actor.id,
			event_type: "tracker_item_created",
			payload: JSON.stringify({ title: "Fix realtime" }),
			workspace_id: 42,
		});
		expect(execute).toHaveBeenCalledOnce();
	});

	it("never touches card_events", async () => {
		const { dbExec, insertInto } = createMockExecutor();
		await recordTrackerActivity(dbExec, actor, 1, "tracker_item_updated", {
			trackerItemId: 1,
		});
		expect(insertInto).not.toHaveBeenCalledWith("card_events");
	});
});
