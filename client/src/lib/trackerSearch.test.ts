import { describe, expect, it } from "vitest";
import type { TrackerProject, WorkItem } from "../types";
import { partitionTrackerSearch } from "./trackerSearch";

let nextId = 1;

function trackerItem(overrides: Partial<WorkItem> = {}): WorkItem {
	const id = nextId++;
	return {
		id,
		key: `CA-${id}`,
		title: "Task",
		description: "",
		source: "tracker",
		status: {
			id: 1,
			kind: "status",
			name: "Backlog",
			position: 1024,
			colour: "#ccc",
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

function trackerProject(
	overrides: Partial<TrackerProject> = {},
): TrackerProject {
	return {
		id: 1,
		name: "Release",
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

describe("partitionTrackerSearch", () => {
	it("returns every item and project when search is empty", () => {
		const unassigned = trackerItem({ key: "CA-1", title: "Backlog task" });
		const inProject = trackerItem({
			key: "CA-2",
			title: "Project task",
			projectId: 1,
		});
		const projects = [trackerProject()];

		const result = partitionTrackerSearch(
			[unassigned, inProject],
			projects,
			"   ",
		);

		expect(result.searchActive).toBe(false);
		// Project membership never removes an item from the list.
		expect(result.filteredItems).toEqual([unassigned, inProject]);
		expect(result.visibleProjects).toEqual(projects);
	});

	it("returns nothing when neither an item nor a project name matches", () => {
		const result = partitionTrackerSearch(
			[
				trackerItem({ key: "CA-1", title: "Alpha", projectId: null }),
				trackerItem({ key: "CA-2", title: "Beta", projectId: 1 }),
			],
			[trackerProject({ id: 1, name: "Release" })],
			"zzzz",
		);

		expect(result.searchActive).toBe(true);
		expect(result.filteredItems).toEqual([]);
		expect(result.visibleProjects).toEqual([]);
	});

	it("matches unassigned and in-project items with one rule", () => {
		const unassigned = trackerItem({
			key: "CA-1",
			title: "Fix login",
			projectId: null,
		});
		const inProject = trackerItem({
			key: "CA-2",
			title: "Fix login redirect",
			projectId: 1,
		});
		const other = trackerItem({ key: "CA-3", title: "Other" });

		const result = partitionTrackerSearch(
			[unassigned, inProject, other],
			[trackerProject({ id: 1, name: "Release" })],
			"login",
		);

		expect(result.filteredItems).toEqual([unassigned, inProject]);
	});

	it("matches items by key and by description", () => {
		const byKey = trackerItem({ key: "CA-77", title: "Opaque" });
		const byDescription = trackerItem({
			key: "CA-78",
			title: "Opaque",
			description: "hidden billing details",
		});

		expect(
			partitionTrackerSearch([byKey, byDescription], [], "ca-77").filteredItems,
		).toEqual([byKey]);
		expect(
			partitionTrackerSearch([byKey, byDescription], [], "billing")
				.filteredItems,
		).toEqual([byDescription]);
	});

	it("keeps a project visible when its name matches but none of its items do", () => {
		const inProject = trackerItem({
			key: "CA-1",
			title: "Unrelated task",
			projectId: 1,
		});
		const projects = [
			trackerProject({ id: 1, name: "Rilis v2" }),
			trackerProject({ id: 2, name: "Other" }),
		];

		const result = partitionTrackerSearch([inProject], projects, "rilis");

		expect(result.filteredItems).toEqual([]);
		expect(result.visibleProjects).toEqual([projects[0]]);
	});

	it("keeps a project visible when one of its items matches", () => {
		const match = trackerItem({
			key: "CA-1",
			title: "Deploy",
			projectId: 1,
		});
		const projects = [
			trackerProject({ id: 1, name: "Release" }),
			trackerProject({ id: 2, name: "Other" }),
		];

		const result = partitionTrackerSearch([match], projects, "deploy");

		expect(result.filteredItems).toEqual([match]);
		expect(result.visibleProjects).toEqual([projects[0]]);
	});
});
