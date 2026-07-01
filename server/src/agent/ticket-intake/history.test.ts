import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { recordActivity } from "../../routes/helpers.js";
import type { Queryable } from "../../routes/helpers.js";
import { getTicketHistory } from "./history.js";

function mockDb(
	rows: Array<{ payload: Record<string, unknown>; created_at: Date }>,
): Queryable {
	return {
		query: vi.fn().mockResolvedValue({ rows }),
	};
}

describe("getTicketHistory", () => {
	it("returns 2 entries most-recent first for 2 events", async () => {
		const older = new Date("2026-01-01T10:00:00Z");
		const newer = new Date("2026-01-02T10:00:00Z");
		const db = mockDb([
			{
				payload: {
					title: "New ticket",
					issueUrl: "https://linear.app/issue/new",
				},
				created_at: newer,
			},
			{
				payload: {
					title: "Old ticket",
					issueUrl: "https://linear.app/issue/old",
				},
				created_at: older,
			},
		]);

		const result = await getTicketHistory(db, 1, 42);

		expect(result).toEqual([
			{
				title: "New ticket",
				issueUrl: "https://linear.app/issue/new",
				createdAt: newer,
			},
			{
				title: "Old ticket",
				issueUrl: "https://linear.app/issue/old",
				createdAt: older,
			},
		]);
		expect(db.query).toHaveBeenCalledWith(
			expect.stringContaining("event_type = 'linear_ticket_created'"),
			[1, 42],
		);
	});

	it("returns empty array when no events exist", async () => {
		const db = mockDb([]);

		const result = await getTicketHistory(db, 1, 42);

		expect(result).toEqual([]);
	});
});

describe("recordActivity eventType", () => {
	it("accepts linear_ticket_created", () => {
		expectTypeOf<"linear_ticket_created">().toMatchTypeOf<
			Parameters<typeof recordActivity>[3]
		>();
	});
});
