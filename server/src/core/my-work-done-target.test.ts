import { describe, expect, it } from "vitest";
import {
	resolveMyWorkDoneTarget,
	type MyWorkDoneTargetInputs,
} from "./my-work-done-target.js";

const boardColumns = [
	{ id: 11, workspaceId: 7, boardId: null, position: 1, is_done: false },
	{ id: 12, workspaceId: 7, boardId: null, position: 2, is_done: true },
	{ id: 21, workspaceId: 7, boardId: 99, position: 1, is_done: false },
	{ id: 22, workspaceId: 7, boardId: 99, position: 2, is_done: true },
];

const statusVocabularies = [
	{
		id: 101,
		workspaceId: 7,
		kind: "status",
		slot: "in_progress" as const,
		position: 1,
	},
	{
		id: 102,
		workspaceId: 7,
		kind: "status",
		slot: "done" as const,
		position: 2,
	},
];

function inputs(
	overrides: Partial<MyWorkDoneTargetInputs> = {},
): MyWorkDoneTargetInputs {
	return {
		boardColumns,
		statusVocabularies,
		...overrides,
	};
}

describe("resolveMyWorkDoneTarget", () => {
	it("resolves a Board done column and status in the current board geometry", () => {
		expect(
			resolveMyWorkDoneTarget(
				{ source: "board", workspaceId: 7, columnId: 11 },
				inputs(),
			),
		).toEqual({
			available: true,
			source: "board",
			columnId: 12,
			statusId: 102,
			slot: "done",
		});
	});

	it("does not use a done column from another board", () => {
		expect(
			resolveMyWorkDoneTarget(
				{ source: "board", workspaceId: 7, columnId: 11 },
				inputs({
					boardColumns: [
						{
							id: 11,
							workspaceId: 7,
							boardId: null,
							position: 1,
							is_done: false,
						},
						{ id: 21, workspaceId: 7, boardId: 99, position: 1, is_done: true },
					],
				}),
			),
		).toEqual({ available: false, reason: "missing_done_mapping" });
	});

	it("reports an unavailable Board target when the done column or vocabulary is missing", () => {
		const noDoneColumn = inputs({
			boardColumns: [
				{ id: 11, workspaceId: 7, boardId: null, position: 1, is_done: false },
			],
		});
		const noDoneStatus = inputs({
			statusVocabularies: [
				{
					id: 101,
					workspaceId: 7,
					kind: "status",
					slot: "in_progress",
					position: 1,
				},
			],
		});

		expect(
			resolveMyWorkDoneTarget(
				{ source: "board", workspaceId: 7, columnId: 11 },
				noDoneColumn,
			),
		).toEqual({ available: false, reason: "missing_done_mapping" });
		expect(
			resolveMyWorkDoneTarget(
				{ source: "board", workspaceId: 7, columnId: 11 },
				noDoneStatus,
			),
		).toEqual({ available: false, reason: "missing_done_mapping" });
	});

	it("selects the Tracker done vocabulary deterministically by position then id", () => {
		expect(
			resolveMyWorkDoneTarget(
				{ source: "tracker", workspaceId: 7 },
				inputs({
					statusVocabularies: [
						{
							id: 203,
							workspaceId: 7,
							kind: "status",
							slot: "done",
							position: 2,
						},
						{
							id: 201,
							workspaceId: 7,
							kind: "status",
							slot: "done",
							position: 1,
						},
						{
							id: 202,
							workspaceId: 7,
							kind: "priority",
							slot: "done",
							position: 0,
						},
					],
				}),
			),
		).toEqual({
			available: true,
			source: "tracker",
			statusId: 201,
			slot: "done",
		});
	});

	it("reports an unavailable Tracker target without a done status", () => {
		expect(
			resolveMyWorkDoneTarget(
				{ source: "tracker", workspaceId: 7 },
				inputs({
					statusVocabularies: [
						{
							id: 101,
							workspaceId: 7,
							kind: "status",
							slot: "in_progress",
							position: 1,
						},
					],
				}),
			),
		).toEqual({ available: false, reason: "missing_done_mapping" });
	});

	it("isolates mapping inputs by workspace", () => {
		expect(
			resolveMyWorkDoneTarget(
				{ source: "tracker", workspaceId: 12 },
				inputs({
					statusVocabularies: [
						{
							id: 301,
							workspaceId: 7,
							kind: "status",
							slot: "done",
							position: 1,
						},
					],
				}),
			),
		).toEqual({ available: false, reason: "missing_done_mapping" });
	});
});
