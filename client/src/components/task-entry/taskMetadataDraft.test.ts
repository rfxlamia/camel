import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createInitialTaskMetadataDraft,
	selectTaskMetadataPayload,
	selectTaskMetadataValidation,
	taskMetadataReducer,
} from "./taskMetadataDraft";

describe("task metadata draft reducer", () => {
	it("Replace a single-value field", () => {
		const high = createInitialTaskMetadataDraft({ priorityId: 1 });
		const draft = taskMetadataReducer(high, {
			type: "setField",
			field: "priorityId",
			value: 2,
		});

		expect(draft.priorityId).toBe(2);
		expect(selectTaskMetadataPayload(draft).priorityId).toBe(2);
		expect(selectTaskMetadataPayload(draft).priorityId).not.toBe(1);
	});

	it("Prevent duplicate multi-value relations", () => {
		const selected = createInitialTaskMetadataDraft({ assigneeIds: [7] });
		const draft = taskMetadataReducer(selected, {
			type: "toggleAssignee",
			id: 7,
		});

		expect(draft.assigneeIds).toEqual([]);
		expect(selectTaskMetadataPayload(draft).assigneeIds).toBeUndefined();
	});

	it("Derive Project from Phase", () => {
		const projects = [
			{ id: 3, phases: [{ id: 11, projectId: 3 }] },
			{ id: 4, phases: [] },
		];
		const draft = taskMetadataReducer(
			createInitialTaskMetadataDraft(),
			{ type: "setPhase", phaseId: 11, projects },
		);

		expect(draft.projectId).toBe(3);
		expect(draft.phaseId).toBe(11);
		expect(selectTaskMetadataPayload(draft)).toMatchObject({
			projectId: 3,
			phaseId: 11,
		});
	});

	it("Clear an incompatible Phase", () => {
		const projects = [
			{ id: 3, phases: [{ id: 11, projectId: 3 }] },
			{ id: 4, phases: [{ id: 12, projectId: 4 }] },
		];
		const selected = createInitialTaskMetadataDraft({
			projectId: 3,
			phaseId: 11,
			projects,
		});
		const draft = taskMetadataReducer(selected, {
			type: "setProject",
			projectId: 4,
		});

		expect(draft.projectId).toBe(4);
		expect(draft.phaseId).toBeNull();
	});

	it("Clear Phase when Project is removed", () => {
		const draft = taskMetadataReducer(
			createInitialTaskMetadataDraft({ projectId: 3, phaseId: 11 }),
			{ type: "setProject", projectId: null },
		);

		expect(draft.projectId).toBeNull();
		expect(draft.phaseId).toBeNull();
		expect(selectTaskMetadataPayload(draft)).not.toHaveProperty("projectId");
		expect(selectTaskMetadataPayload(draft)).not.toHaveProperty("phaseId");
	});

	it("Resolve a Next week preset", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 8, 2, 12));
		const draft = taskMetadataReducer(createInitialTaskMetadataDraft(), {
			type: "setDatePreset",
			field: "dueDate",
			preset: "nextWeek",
		});

		expect(draft.dueDate).toBe("2026-09-09");
		expect(selectTaskMetadataPayload(draft).dueDate).toBe("2026-09-09");
	});

	it("Preserve calendar dates across time boundaries", () => {
		vi.useFakeTimers();
		const cases = [
			[new Date(2026, 2, 8, 12), "today", "2026-03-08"],
			[new Date(2026, 2, 8, 12), "tomorrow", "2026-03-09"],
			[new Date(2026, 0, 31, 12), "tomorrow", "2026-02-01"],
			[new Date(2026, 11, 31, 12), "tomorrow", "2027-01-01"],
			[new Date(2026, 11, 27, 12), "nextWeek", "2027-01-03"],
		] as const;

		for (const [now, preset, expected] of cases) {
			vi.setSystemTime(now);
			const draft = taskMetadataReducer(createInitialTaskMetadataDraft(), {
				type: "setDatePreset",
				field: "startDate",
				preset,
			});
			expect(draft.startDate).toBe(expected);
		}
	});

	it("Reject an invalid Tracker date range immediately", () => {
		const selected = createInitialTaskMetadataDraft({
			startDate: "2026-09-10",
			endDate: "2026-09-20",
		});
		const draft = taskMetadataReducer(selected, {
			type: "setDate",
			field: "endDate",
			value: "2026-09-09",
		});

		expect(draft.endDate).toBe("2026-09-20");
		expect(selectTaskMetadataValidation(draft).endDate).toBe(
			"End date cannot precede Start date.",
		);
	});

	afterEach(() => vi.useRealTimers());
});
