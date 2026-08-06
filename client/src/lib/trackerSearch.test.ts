import { describe, expect, it } from "vitest";
import type { TrackerItem, TrackerProject } from "../types";
import { partitionTrackerSearch } from "./trackerSearch";

let nextId = 1;

function trackerItem(overrides: Partial<TrackerItem> = {}): TrackerItem {
	const id = nextId++;
	return {
		id,
		key: `CA-${id}`,
		title: "Task",
		description: "",
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

function trackerProject(overrides: Partial<TrackerProject> = {}): TrackerProject {
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
	it("returns all projects and unassigned items when search is empty", () => {
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
		expect(result.filteredUnassigned).toEqual([unassigned]);
		expect(result.filteredInProject).toEqual([]);
		expect(result.visibleProjects).toEqual(projects);
		expect(result.noSearchResults).toBe(false);
		expect(result.toolbarCount).toBe(1);
	});

	it("reports noSearchResults when nothing matches unassigned, in-project, or project name", () => {
		const result = partitionTrackerSearch(
			[
				trackerItem({ key: "CA-1", title: "Alpha", projectId: null }),
				trackerItem({ key: "CA-2", title: "Beta", projectId: 1 }),
			],
			[trackerProject({ id: 1, name: "Release" })],
			"zzzz",
		);

		expect(result.searchActive).toBe(true);
		expect(result.noSearchResults).toBe(true);
		expect(result.filteredUnassigned).toEqual([]);
		expect(result.filteredInProject).toEqual([]);
		expect(result.visibleProjects).toEqual([]);
		expect(result.toolbarCount).toBe(0);
	});

	it("finds unassigned items and clears noSearchResults", () => {
		const match = trackerItem({
			key: "CA-1",
			title: "Fix login",
			projectId: null,
		});
		const other = trackerItem({
			key: "CA-2",
			title: "Other",
			projectId: null,
		});

		const result = partitionTrackerSearch([match, other], [], "login");

		expect(result.noSearchResults).toBe(false);
		expect(result.filteredUnassigned).toEqual([match]);
		expect(result.filteredInProject).toEqual([]);
		expect(result.toolbarCount).toBe(1);
	});

	it("finds in-project items and clears noSearchResults", () => {
		const match = trackerItem({
			key: "CA-1",
			title: "Deploy",
			projectId: 1,
		});
		const other = trackerItem({
			key: "CA-2",
			title: "Unrelated",
			projectId: null,
		});
		const projects = [trackerProject({ id: 1, name: "Release" })];

		const result = partitionTrackerSearch(
			[match, other],
			projects,
			"deploy",
		);

		expect(result.noSearchResults).toBe(false);
		expect(result.filteredUnassigned).toEqual([]);
		expect(result.filteredInProject).toEqual([match]);
		expect(result.visibleProjects).toEqual([projects[0]]);
		expect(result.toolbarCount).toBe(1);
	});

	it("finds projects by name and clears noSearchResults", () => {
		const inProject = trackerItem({
			key: "CA-1",
			title: "Unrelated task",
			projectId: 1,
		});
		const projects = [
			trackerProject({ id: 1, name: "Rilis v2" }),
			trackerProject({ id: 2, name: "Other" }),
		];

		const result = partitionTrackerSearch(
			[inProject],
			projects,
			"rilis",
		);

		expect(result.noSearchResults).toBe(false);
		expect(result.filteredUnassigned).toEqual([]);
		expect(result.filteredInProject).toEqual([]);
		expect(result.visibleProjects).toEqual([projects[0]]);
		expect(result.toolbarCount).toBe(0);
	});
});
