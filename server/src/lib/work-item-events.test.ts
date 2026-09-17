import { describe, expect, it } from "vitest";
import { toCardTrackerEvent } from "./work-item-events.js";

describe("toCardTrackerEvent", () => {
	it("maps card move events to tracker-style status change payloads", () => {
		const event = toCardTrackerEvent({
			id: 9,
			event_type: "move",
			payload: { cardTitle: "Ship it" },
			created_at: new Date("2026-08-01T10:00:00.000Z"),
			card_id: 3,
			username: "alice",
			display_name: "Alice",
			current_card_title: "Ship it",
			from_column_title: "Requested",
			to_column_title: "Finished",
		});

		expect(event).toMatchObject({
			eventType: "tracker_item_updated",
			title: "Ship it",
			payload: {
				field: "status",
				from: "Requested",
				to: "Finished",
			},
			actor: { username: "alice", displayName: "Alice" },
		});
	});

	it("maps card create events to tracker_item_created", () => {
		const event = toCardTrackerEvent({
			id: 10,
			event_type: "create",
			payload: { cardTitle: "New card" },
			created_at: new Date("2026-08-01T10:00:00.000Z"),
			card_id: 4,
			username: "bob",
			display_name: "Bob",
			current_card_title: "New card",
			from_column_title: null,
			to_column_title: null,
		});

		expect(event.eventType).toBe("tracker_item_created");
	});
});
