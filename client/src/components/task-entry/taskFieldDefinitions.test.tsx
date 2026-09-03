import { describe, expect, it } from "vitest";
import type { TrackerProject, TrackerVocabulary, WorkspaceMember } from "../../types";
import {
	getBoardTaskFieldDefinitions,
	getTrackerTaskFieldDefinitions,
	type TaskMetadataCatalogs,
} from "./taskFieldDefinitions";

const members: WorkspaceMember[] = [
	{ userId: 1, username: "rafi", displayName: "Rafi", role: "member" },
];
const priorities: TrackerVocabulary[] = [
	{
		id: 10,
		kind: "priority",
		name: "High",
		position: 1,
		colour: "#f00",
	},
];
const labels: TrackerVocabulary[] = [
	{
		id: 20,
		kind: "label",
		name: "Bug",
		position: 1,
		colour: "#00f",
	},
];
const statuses: TrackerVocabulary[] = [
	{
		id: 30,
		kind: "status",
		name: "Todo",
		position: 1,
		colour: "#0f0",
	},
];
const projects: TrackerProject[] = [
	{
		id: 1,
		name: "Alpha",
		startDate: null,
		endDate: null,
		position: 1,
		version: 1,
		phases: [
			{
				id: 9,
				name: "Build",
				projectId: 1,
				position: 1,
				version: 1,
				subtitle: "",
				startDate: null,
				endDate: null,
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		],
	},
];

function readyCatalogs(): TaskMetadataCatalogs {
	return {
		assignee: { status: "ready", items: members },
		priority: { status: "ready", items: priorities },
		label: { status: "ready", items: labels },
		status: { status: "ready", items: statuses },
		project: { status: "ready", items: projects },
		retry: () => {},
	};
}

describe("taskFieldDefinitions", () => {
	it("defines the exact Board command field set", () => {
		const labels = getBoardTaskFieldDefinitions(readyCatalogs()).map(
			(field) => field.label,
		);

		expect(labels).toEqual([
			"Assignee",
			"Priority",
			"Labels",
			"Project",
			"Phase",
			"Due date",
		]);
		expect(labels).not.toContain("Status");
		expect(labels).not.toContain("Column");
	});

	it("defines the exact Tracker command field set", () => {
		const labels = getTrackerTaskFieldDefinitions(readyCatalogs()).map(
			(field) => field.label,
		);

		expect(labels).toEqual([
			"Status",
			"Priority",
			"Assignee",
			"Labels",
			"Project",
			"Phase",
			"Start date",
			"End date",
		]);
	});

	it("filters valid locked Tracker fields", () => {
		const unlocked = getTrackerTaskFieldDefinitions(readyCatalogs()).map(
			(field) => field.label,
		);
		const locked = getTrackerTaskFieldDefinitions(readyCatalogs(), {
			lockedProjectId: 1,
			lockedPhaseId: 9,
			projects,
		}).map((field) => field.label);

		expect(unlocked).toContain("Project");
		expect(unlocked).toContain("Phase");
		expect(locked).not.toContain("Project");
		expect(locked).not.toContain("Phase");
		expect(locked).toEqual([
			"Status",
			"Priority",
			"Assignee",
			"Labels",
			"Start date",
			"End date",
		]);
	});
});
