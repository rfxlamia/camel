import { describe, expect, it } from "vitest";
import { toActivityItem } from "./factory.js";

const at = new Date("2026-08-01T10:00:00.000Z");

describe("chat toActivityItem", () => {
	it("prefers the live card title, then payload cardTitle", () => {
		expect(
			toActivityItem({
				event_type: "move",
				payload: { cardTitle: "Old" },
				created_at: at,
				current_card_title: "Live",
			}),
		).toEqual({ type: "move", cardTitle: "Live", at: at.toISOString() });
		expect(
			toActivityItem({
				event_type: "delete",
				payload: { cardTitle: "Old" },
				created_at: at,
				current_card_title: null,
			}).cardTitle,
		).toBe("Old");
	});

	it("falls back to payload.title for merged tracker events with no card", () => {
		const item = toActivityItem({
			event_type: "tracker_item_created",
			payload: { title: "Roadmap item" },
			created_at: at,
			current_card_title: null,
		});
		expect(item.cardTitle).toBe("Roadmap item");
	});

	it("never prints undefined or a non-string title when titles are missing", () => {
		for (const payload of [null, {}, { cardTitle: 5 }, { title: {} }, "x"]) {
			const item = toActivityItem({
				event_type: "tracker_item_updated",
				payload,
				created_at: at,
				current_card_title: null,
			});
			expect(item.cardTitle).toBeNull();
			expect(JSON.stringify(item)).not.toContain("undefined");
		}
	});
});
