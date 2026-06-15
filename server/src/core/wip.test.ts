import { describe, expect, it } from "vitest";
import { checkWipLimit, wipStatus } from "./wip.js";

describe("checkWipLimit", () => {
	it("allows a move into a column under its limit", () => {
		expect(
			checkWipLimit({ currentCount: 2, wipLimit: 3, isSameColumn: false }),
		).toEqual({ allowed: true, reason: "ok" });
	});

	it("rejects a move into a column at its limit", () => {
		expect(
			checkWipLimit({ currentCount: 3, wipLimit: 3, isSameColumn: false }),
		).toEqual({ allowed: false, reason: "wip_limit_reached" });
	});

	it("rejects a move into a column already over its limit", () => {
		expect(
			checkWipLimit({ currentCount: 5, wipLimit: 3, isSameColumn: false }),
		).toEqual({ allowed: false, reason: "wip_limit_reached" });
	});

	it("always allows reordering within the same column", () => {
		expect(
			checkWipLimit({ currentCount: 3, wipLimit: 3, isSameColumn: true }),
		).toEqual({ allowed: true, reason: "ok" });
	});

	it("always allows moves into an unlimited column", () => {
		expect(
			checkWipLimit({ currentCount: 100, wipLimit: null, isSameColumn: false }),
		).toEqual({ allowed: true, reason: "ok" });
	});

	it("allows the move that exactly fills the column", () => {
		expect(
			checkWipLimit({ currentCount: 2, wipLimit: 3, isSameColumn: false })
				.allowed,
		).toBe(true);
		expect(
			checkWipLimit({ currentCount: 3, wipLimit: 3, isSameColumn: false })
				.allowed,
		).toBe(false);
	});
});

describe("wipStatus", () => {
	it("reports unlimited when no limit is set", () => {
		expect(wipStatus(7, null)).toBe("unlimited");
	});

	it("reports under, at, and over", () => {
		expect(wipStatus(1, 3)).toBe("under");
		expect(wipStatus(3, 3)).toBe("at");
		expect(wipStatus(4, 3)).toBe("over");
	});
});
