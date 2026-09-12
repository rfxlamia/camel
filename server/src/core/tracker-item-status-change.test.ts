import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveMyWorkDoneTarget } from "./my-work-done-target.js";
import { applyTrackerItemStatusChange } from "./tracker-item-status-change.js";

const actor = {
	id: 42,
	username: "alice",
	displayName: "Alice",
	email: "alice@example.com",
	emailVerified: true,
	needsUsername: false,
};

function chainable(result: unknown) {
	const builder: Record<string, ReturnType<typeof vi.fn>> = {};
	for (const method of [
		"where",
		"select",
		"orderBy",
		"forUpdate",
		"returning",
		"innerJoin",
		"leftJoin",
	]) {
		builder[method] = vi.fn(() => builder);
	}
	builder.execute = vi
		.fn()
		.mockResolvedValue(
			Array.isArray(result) ? result : result == null ? [] : [result],
		);
	builder.executeTakeFirst = vi
		.fn()
		.mockResolvedValue(Array.isArray(result) ? result[0] : result);
	return builder;
}

function makeTrackerTrx(options: { targetCategory?: string | null } = {}) {
	const updateCalls: Array<Record<string, unknown>> = [];
	const tableQueries: string[] = [];
	let vocabularyReads = 0;
	const trx = {
		selectFrom: vi.fn((table: string) => {
			tableQueries.push(table);
			if (table === "tracker_items" || table === "tracker_items as ti") {
				return chainable({
					id: 100,
					title: "Retry image upload",
					status_id: 11,
					version: 3,
					completed_at: null,
				});
			}
			if (table === "tracker_vocabularies") {
				vocabularyReads += 1;
				return chainable(
					vocabularyReads === 1
						? {
								id: 22,
								slot: "done",
								category: options.targetCategory ?? "completed",
							}
						: [],
				);
			}
			return chainable([]);
		}),
		updateTable: vi.fn(() => ({
			set: vi.fn((values: Record<string, unknown>) => ({
				where: vi.fn(() => {
					updateCalls.push(values);
					return chainable({
						id: 100,
						title: "Retry image upload",
						version: 4,
					});
				}),
			})),
		})),
	};
	return {
		trx: trx as Parameters<typeof applyTrackerItemStatusChange>[0],
		updateCalls,
		tableQueries,
	};
}

const targetInputs = {
	boardColumns: [],
	statusVocabularies: [
		{
			id: 22,
			workspaceId: 7,
			kind: "status",
			slot: "done" as const,
			position: 4,
		},
	],
};

const mockRecordTrackerActivity = vi.fn();
vi.mock("../routes/tracker-activity.js", () => ({
	recordTrackerActivity: (...args: unknown[]) =>
		mockRecordTrackerActivity(...args),
}));

beforeEach(() => {
	mockRecordTrackerActivity.mockReset();
});

describe("applyTrackerItemStatusChange", () => {
	it("uses the resolved done target and records one status update/activity", async () => {
		const target = resolveMyWorkDoneTarget(
			{ source: "tracker", workspaceId: 7 },
			targetInputs,
		);
		expect(target).toEqual({
			available: true,
			source: "tracker",
			statusId: 22,
			slot: "done",
		});

		const { trx, updateCalls } = makeTrackerTrx();
		const result = await applyTrackerItemStatusChange(trx, {
			workspaceId: 7,
			actor,
			trackerItemId: 100,
			targetStatusId: target.statusId,
			version: 3,
		});

		expect(result).toMatchObject({ kind: "ok", itemId: 100 });
		expect(updateCalls).toHaveLength(1);
		expect(updateCalls[0]).toEqual(
			expect.objectContaining({
				status_id: 22,
				completed_at: expect.anything(),
				version: expect.anything(),
				updated_at: expect.anything(),
			}),
		);
		expect(mockRecordTrackerActivity).toHaveBeenCalledOnce();
		expect(mockRecordTrackerActivity).toHaveBeenCalledWith(
			trx,
			actor,
			7,
			"tracker_item_updated",
			expect.objectContaining({ trackerItemId: 100 }),
		);
	});

	it("clears completed_at when the target status is not in the completed category", async () => {
		const { trx, updateCalls } = makeTrackerTrx({ targetCategory: "started" });
		const result = await applyTrackerItemStatusChange(trx, {
			workspaceId: 7,
			actor,
			trackerItemId: 100,
			targetStatusId: 22,
		});

		expect(result).toMatchObject({ kind: "ok" });
		expect(updateCalls[0]?.completed_at).toBeNull();
	});
});
