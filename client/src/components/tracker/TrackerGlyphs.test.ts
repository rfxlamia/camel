import { describe, expect, it } from "vitest";
import type { TrackerVocabulary } from "../../types";
import { priorityBars, statusGlyphSpec } from "./TrackerGlyphs";

function statusVocab(
	id: number,
	name: string,
	position: number,
	category: TrackerVocabulary["category"] = null,
): TrackerVocabulary {
	return { id, kind: "status", name, position, colour: "#ccc", category };
}

function priorityVocab(
	id: number,
	name: string,
	position: number,
): TrackerVocabulary {
	return { id, kind: "priority", name, position, colour: "#ccc" };
}

const statuses = [
	statusVocab(1, "Backlog", 1024, "backlog"),
	statusVocab(2, "Todo", 2048, "backlog"),
	statusVocab(3, "In Progress", 3072, "started"),
	statusVocab(4, "Done", 4096, "completed"),
	statusVocab(5, "Canceled", 5120, "canceled"),
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

	it("does not divide by zero for a lone started status among non-canceled ones", () => {
		const single = [statusVocab(9, "Only", 1024, "started")];
		const spec = statusGlyphSpec(single, 9);
		expect(spec.shape).toBe("progress");
		expect(Number.isFinite(spec.fraction)).toBe(true);
	});

	it("falls back to pending for an unknown status", () => {
		expect(statusGlyphSpec(statuses, 404).shape).toBe("pending");
	});

	it("renders the cancelled shape for a status named 'Batal' with category canceled", () => {
		const custom = [statusVocab(1, "Batal", 1024, "canceled")];
		expect(statusGlyphSpec(custom, 1).shape).toBe("cancelled");
	});

	it("renders the done shape for a status named 'Selesai' with category completed", () => {
		const custom = [statusVocab(1, "Selesai", 1024, "completed")];
		expect(statusGlyphSpec(custom, 1).shape).toBe("done");
	});

	it("renders pending for category backlog", () => {
		const custom = [statusVocab(1, "Antrian", 1024, "backlog")];
		expect(statusGlyphSpec(custom, 1).shape).toBe("pending");
	});

	it("renders progress for category started, fraction from position rank among non-canceled statuses", () => {
		const custom = [
			statusVocab(1, "Mulai", 1024, "started"),
			statusVocab(2, "Lanjut", 2048, "started"),
			statusVocab(3, "Selesai", 3072, "completed"),
		];
		const spec = statusGlyphSpec(custom, 2);
		expect(spec.shape).toBe("progress");
		expect(spec.fraction).toBeCloseTo(1 / 2);
	});

	it("falls back to pending without throwing when category is null", () => {
		const custom = [statusVocab(1, "Legacy", 1024, null)];
		expect(() => statusGlyphSpec(custom, 1)).not.toThrow();
		expect(statusGlyphSpec(custom, 1).shape).toBe("pending");
	});

	it("ignores a name containing 'cancel' when its category is not canceled", () => {
		const custom = [
			statusVocab(1, "Cancel My Subscription Reminder", 1024, "started"),
			statusVocab(2, "Done", 2048, "completed"),
		];
		const spec = statusGlyphSpec(custom, 1);
		expect(spec.shape).not.toBe("cancelled");
		expect(spec.shape).toBe("progress");
	});
});

describe("priorityBars", () => {
	const priorities = [
		priorityVocab(10, "High", 1024),
		priorityVocab(11, "Medium", 2048),
		priorityVocab(12, "Low", 3072),
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
