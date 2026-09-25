import { describe, expect, it } from "vitest";
import { buildMonthGrid } from "./calendarGrid";

describe("buildMonthGrid", () => {
	it("returns 42 cells for August 2026 with Sunday-start weeks", () => {
		const cells = buildMonthGrid(new Date(2026, 7, 1)); // Aug 1 2026 is Saturday
		expect(cells).toHaveLength(42);
		expect(cells[0]!.iso).toBe("2026-07-26"); // prior Sunday pads the first row
		expect(cells.find((c) => c.iso === "2026-08-15")).toBeTruthy();
	});

	it("marks spillover cells outside the viewed month", () => {
		const cells = buildMonthGrid(new Date(2026, 7, 1));
		const spill = cells.find((c) => c.iso === "2026-09-01");
		expect(spill?.inMonth).toBe(false);
	});
});
