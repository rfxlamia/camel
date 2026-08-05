import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	TrackerItem,
	TrackerPhase,
	TrackerProject,
	TrackerStatusCategory,
} from "../types";
import {
	isPhaseOverdue,
	isProjectOverdue,
	isTaskOverdue,
	phaseBounds,
	rollup,
} from "./trackerRollup";

let nextId = 1;

function taskItem(
	category: TrackerStatusCategory,
	overrides: Partial<TrackerItem> = {},
): TrackerItem {
	const id = nextId++;
	return {
		id,
		key: `CA-${id}`,
		title: "Task",
		description: "",
		status: {
			id: 1,
			kind: "status",
			name: "Status",
			position: 1024,
			colour: "#ccc",
			category,
		},
		priority: null,
		labels: [],
		assignees: [],
		version: 1,
		createdAt: "2026-08-01T00:00:00.000Z",
		updatedAt: "2026-08-01T00:00:00.000Z",
		projectId: null,
		phaseId: null,
		startDate: null,
		endDate: null,
		completedAt: null,
		position: 1024,
		...overrides,
	};
}

function phase(overrides: Partial<TrackerPhase> = {}): TrackerPhase {
	return {
		id: 9,
		projectId: 1,
		name: "Phase",
		subtitle: "",
		startDate: null,
		endDate: null,
		position: 1024,
		version: 1,
		createdAt: "2026-08-01T00:00:00.000Z",
		updatedAt: "2026-08-01T00:00:00.000Z",
		...overrides,
	};
}

function project(overrides: Partial<TrackerProject> = {}): TrackerProject {
	return {
		id: 1,
		name: "Project",
		startDate: null,
		endDate: null,
		position: 1024,
		version: 1,
		phases: [],
		createdAt: "2026-08-01T00:00:00.000Z",
		updatedAt: "2026-08-01T00:00:00.000Z",
		...overrides,
	};
}

describe("rollup", () => {
	it("reports 63% for 5 completed, 2 canceled and 3 started", () => {
		const items = [
			...Array.from({ length: 5 }, () => taskItem("completed")),
			...Array.from({ length: 2 }, () => taskItem("canceled")),
			...Array.from({ length: 3 }, () => taskItem("started")),
		];
		const result = rollup(items);
		expect(result).toMatchObject({ kind: "percent", completed: 5, total: 8 });
		if (result.kind === "percent") {
			expect(Math.round(result.ratio * 100)).toBe(63);
		}
	});

	it("returns no-active-work when every task is canceled", () => {
		const items = [taskItem("canceled"), taskItem("canceled")];
		expect(rollup(items)).toEqual({ kind: "no-active-work" });
	});

	it("returns no-tasks for an empty list", () => {
		expect(rollup([])).toEqual({ kind: "no-tasks" });
	});

	it("reports 100% when every non-canceled task is completed", () => {
		const items = [
			...Array.from({ length: 8 }, () => taskItem("completed")),
			...Array.from({ length: 2 }, () => taskItem("canceled")),
		];
		const result = rollup(items);
		expect(result).toMatchObject({ kind: "percent", completed: 8, total: 8 });
	});

	it("counts phase-less tasks when the caller scopes items to a project", () => {
		const proj = project({ id: 5 });
		const allItems = [
			taskItem("completed", { projectId: 5, phaseId: null }),
			taskItem("started", { projectId: 5, phaseId: 9 }),
			taskItem("started", { projectId: 99, phaseId: null }),
		];
		const scoped = allItems.filter((i) => i.projectId === proj.id);
		const result = rollup(scoped);
		expect(result).toMatchObject({ kind: "percent", completed: 1, total: 2 });
	});
});

describe("isTaskOverdue", () => {
	afterEach(() => vi.useRealTimers());

	it("is true for a past end date with a live status", () => {
		vi.setSystemTime(new Date("2026-10-05T12:00:00"));
		expect(isTaskOverdue(taskItem("started", { endDate: "2026-09-20" }))).toBe(
			true,
		);
	});

	it("is false for completed", () => {
		vi.setSystemTime(new Date("2026-10-05T12:00:00"));
		expect(
			isTaskOverdue(taskItem("completed", { endDate: "2026-09-20" })),
		).toBe(false);
	});

	it("is false for canceled", () => {
		vi.setSystemTime(new Date("2026-10-05T12:00:00"));
		expect(
			isTaskOverdue(taskItem("canceled", { endDate: "2026-09-20" })),
		).toBe(false);
	});

	it("is false with no end date", () => {
		vi.setSystemTime(new Date("2026-10-05T12:00:00"));
		expect(isTaskOverdue(taskItem("started", { endDate: null }))).toBe(false);
	});

	it("is false when end equals today", () => {
		vi.setSystemTime(new Date("2026-09-20T12:00:00"));
		expect(isTaskOverdue(taskItem("started", { endDate: "2026-09-20" }))).toBe(
			false,
		);
	});
});

describe("phaseBounds", () => {
	it("returns derived MIN/MAX when no explicit date is set", () => {
		const ph = phase({ startDate: null, endDate: null });
		const items = [
			taskItem("started", { startDate: "2026-09-05", endDate: "2026-09-15" }),
			taskItem("started", { startDate: "2026-09-01", endDate: "2026-09-25" }),
		];
		expect(phaseBounds(ph, items)).toEqual({
			startDate: "2026-09-01",
			endDate: "2026-09-25",
		});
	});

	it("honours an explicit start with a derived end (per-field fallback)", () => {
		const ph = phase({ startDate: "2026-09-01", endDate: null });
		const items = [
			taskItem("started", { startDate: "2026-09-10", endDate: "2026-09-25" }),
		];
		expect(phaseBounds(ph, items)).toEqual({
			startDate: "2026-09-01",
			endDate: "2026-09-25",
		});
	});
});

describe("isPhaseOverdue", () => {
	afterEach(() => vi.useRealTimers());

	it("is false when a past explicit end has every task completed or canceled", () => {
		vi.setSystemTime(new Date("2026-10-05T12:00:00"));
		const ph = phase({ id: 9, endDate: "2026-09-20" });
		const items = [
			taskItem("completed", { phaseId: 9 }),
			taskItem("canceled", { phaseId: 9 }),
		];
		expect(isPhaseOverdue(ph, items)).toBe(false);
	});

	it("is true for a past explicit end with zero tasks", () => {
		vi.setSystemTime(new Date("2026-10-05T12:00:00"));
		const ph = phase({ id: 9, endDate: "2026-09-20" });
		expect(isPhaseOverdue(ph, [])).toBe(true);
	});
});

describe("isProjectOverdue", () => {
	afterEach(() => vi.useRealTimers());

	it("inherits overdue from a date-only overdue phase", () => {
		vi.setSystemTime(new Date("2026-10-05T12:00:00"));
		const overduePhase = phase({ id: 9, projectId: 1, endDate: "2026-09-20" });
		const proj = project({ id: 1, phases: [overduePhase] });
		const items = [
			taskItem("started", { projectId: 1, phaseId: 9, endDate: null }),
			taskItem("started", { projectId: 1, phaseId: null, endDate: null }),
		];
		expect(isProjectOverdue(proj, items)).toBe(true);
	});
});
