import { describe, expect, it } from "vitest";
import type { TrackerVocabulary } from "../../types";
import { priorityBars, statusGlyphSpec } from "./TrackerGlyphs";

function vocab(
	id: number,
	name: string,
	position: number,
	kind: TrackerVocabulary["kind"] = "status",
): TrackerVocabulary {
	return { id, kind, name, position, colour: "#ccc" };
}

const statuses = [
	vocab(1, "Backlog", 1024),
	vocab(2, "Todo", 2048),
	vocab(3, "In Progress", 3072),
	vocab(4, "Done", 4096),
	vocab(5, "Canceled", 5120),
];

describe("statusGlyphSpec", () => {
	it("marks the first workflow status as pending", () => {
		expect(statusGlyphSpec(statuses, 1)).toEqual({
			shape: "pending",
			fraction: 0,
		});
	});

	it("fills partially for mid-workflow statuses", () => {
		const spec = statusGlyphSpec(statuses, 3);
		expect(spec.shape).toBe("progress");
		expect(spec.fraction).toBeCloseTo(2 / 3);
	});

	it("marks the last workflow status as done", () => {
		expect(statusGlyphSpec(statuses, 4).shape).toBe("done");
	});

	it("excludes cancelled statuses from the progress scale", () => {
		expect(statusGlyphSpec(statuses, 5).shape).toBe("cancelled");
	});

	it("does not divide by zero for a single-status workspace", () => {
		const spec = statusGlyphSpec([vocab(9, "Only", 1024)], 9);
		expect(spec).toEqual({ shape: "done", fraction: 1 });
	});

	it("falls back to pending for an unknown status", () => {
		expect(statusGlyphSpec(statuses, 404).shape).toBe("pending");
	});
});

describe("priorityBars", () => {
	const priorities = [
		vocab(10, "High", 1024, "priority"),
		vocab(11, "Medium", 2048, "priority"),
		vocab(12, "Low", 3072, "priority"),
	];

	it("lights every bar for the highest priority", () => {
		expect(priorityBars(priorities, 10)).toBe(3);
	});

	it("lights one bar for the lowest priority", () => {
		expect(priorityBars(priorities, 12)).toBe(1);
	});

	it("returns no bars for an unknown priority", () => {
		expect(priorityBars(priorities, 99)).toBe(0);
	});
});
