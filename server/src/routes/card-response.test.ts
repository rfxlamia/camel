import { describe, expect, it } from "vitest";
import { buildCardResponse } from "./card-response.js";

const row = {
	id: 11,
	column_id: 4,
	title: "Ship card response",
	description: "Details",
	position: 1.5,
	version: 2,
	created_at: "2026-08-29T00:00:00.000Z",
	started_at: null,
	done_at: null,
	due_date: null,
	workspace_name: "Camel Team",
	key_number: 42,
	status_id: 3,
	status_kind: "status",
	status_name: "In Progress",
	status_position: 2,
	status_colour: "green",
	status_category: "started",
	status_slot: "in_progress",
	priority_id: 8,
	priority_kind: "priority",
	priority_name: "High",
	priority_position: 1,
	priority_colour: "red",
	project_id: 5,
	project_name: "Project A",
	phase_id: 9,
	phase_name: "Phase A",
};

describe("buildCardResponse", () => {
	it("formats a keyed card and emits the complete shared card contract", () => {
		const result = buildCardResponse(row, {
			assignees: [{ id: 20, username: "alice", displayName: "Alice" }],
			labels: [
				{
					id: 30,
					kind: "label",
					name: "Bug",
					position: 1,
					colour: "orange",
				},
			],
		});

		expect(result.key).toBe("CT-42");
		expect(result.status).toEqual({
			id: 3,
			kind: "status",
			name: "In Progress",
			position: 2,
			colour: "green",
			category: "started",
			slot: "in_progress",
		});
		expect(result.priority).toEqual({
			id: 8,
			kind: "priority",
			name: "High",
			position: 1,
			colour: "red",
		});
		expect(result.labels).toHaveLength(1);
		expect(result.projectId).toBe(5);
		expect(result.projectName).toBe("Project A");
		expect(result.phaseId).toBe(9);
		expect(result.phaseName).toBe("Phase A");
		expect(result.assignees[0].username).toBe("alice");
	});

	it("keeps null key and taxonomy values explicit", () => {
		const result = buildCardResponse(
			{
				...row,
				key_number: null,
				status_id: null,
				priority_id: null,
				project_id: null,
				project_name: null,
				phase_id: null,
				phase_name: null,
			},
			{ assignees: [], labels: [] },
		);
		expect(result).toHaveProperty("key", null);
		expect(result).toHaveProperty("status", null);
		expect(result).toHaveProperty("priority", null);
		expect(result).toHaveProperty("labels", []);
		expect(result).toHaveProperty("projectId", null);
		expect(result).toHaveProperty("projectName", null);
		expect(result).toHaveProperty("phaseId", null);
		expect(result).toHaveProperty("phaseName", null);
	});
});
