// server/src/lib/tracker-item-parsers.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type DBExecutor, db } from "../db/kysely.js";

const { mockExecuteTakeFirst } = vi.hoisted(() => ({
	mockExecuteTakeFirst: vi.fn(),
}));

vi.mock("../db/kysely.js", () => ({
	db: {
		selectFrom: vi.fn(() => {
			const chain: any = {};
			chain.select = vi.fn(() => chain);
			chain.innerJoin = vi.fn(() => chain);
			chain.where = vi.fn(() => chain);
			chain.executeTakeFirst = mockExecuteTakeFirst;
			return chain;
		}),
	},
}));

import {
	parseAssigneeIds,
	parseDateRange,
	parseLabelIds,
	parsePriorityId,
	parseProjectPhase,
} from "./tracker-item-parsers.js";

describe("parseProjectPhase", () => {
	beforeEach(() => mockExecuteTakeFirst.mockReset());

	it("derives project_id from phaseId when only a phase is given", async () => {
		mockExecuteTakeFirst
			.mockResolvedValueOnce({ id: 5, project_id: 2 }) // phase lookup
			.mockResolvedValueOnce({ id: 2 }); // project lookup (workspace-scoped, not deleted)

		const result = await parseProjectPhase({ phaseId: 5 }, 7);
		expect(result).toEqual({ projectId: 2, phaseId: 5 });
	});

	it("nulls phase_id when projectId alone is supplied", async () => {
		mockExecuteTakeFirst.mockResolvedValueOnce({ id: 2 }); // project lookup
		const result = await parseProjectPhase({ projectId: 2 }, 7);
		expect(result).toEqual({ projectId: 2, phaseId: null });
	});

	it("clears both ids when {projectId: null} is supplied with no phaseId", async () => {
		const result = await parseProjectPhase({ projectId: null }, 7);
		expect(result).toEqual({ projectId: null, phaseId: null });
		expect(mockExecuteTakeFirst).not.toHaveBeenCalled();
	});

	it("returns an error for {projectId: null, phaseId: X}", async () => {
		const result = await parseProjectPhase({ projectId: null, phaseId: 5 }, 7);
		expect(result).toEqual({ error: expect.any(String) });
	});

	it("returns an error when the phase belongs to another project", async () => {
		mockExecuteTakeFirst.mockResolvedValueOnce({ id: 5, project_id: 2 }); // phase lookup
		const result = await parseProjectPhase({ projectId: 9, phaseId: 5 }, 7);
		expect(result).toEqual({ error: expect.any(String) });
	});

	it("returns an error for a cross-workspace, soft-deleted or nonexistent project id", async () => {
		mockExecuteTakeFirst.mockResolvedValueOnce(undefined); // project lookup misses
		const result = await parseProjectPhase({ projectId: 999 }, 7);
		expect(result).toEqual({ error: expect.any(String) });
	});

	it("returns an error for a cross-workspace, soft-deleted or nonexistent phase id", async () => {
		mockExecuteTakeFirst.mockResolvedValueOnce(undefined); // phase lookup misses
		const result = await parseProjectPhase({ phaseId: 999 }, 7);
		expect(result).toEqual({ error: expect.any(String) });
	});

	it("clears both ids when {projectId: null, phaseId: null} is supplied", async () => {
		const result = await parseProjectPhase(
			{ projectId: null, phaseId: null },
			7,
		);
		expect(result).toEqual({ projectId: null, phaseId: null });
		expect(mockExecuteTakeFirst).not.toHaveBeenCalled();
	});

	it("clears phase only when {phaseId: null} is supplied alone", async () => {
		const result = await parseProjectPhase({ phaseId: null }, 7);
		expect(result).toEqual({ phaseId: null });
		expect(mockExecuteTakeFirst).not.toHaveBeenCalled();
	});

	it("returns an error when neither projectId nor phaseId is present", async () => {
		const result = await parseProjectPhase({}, 7);
		expect(result).toEqual({ error: expect.any(String) });
		expect(mockExecuteTakeFirst).not.toHaveBeenCalled();
	});
});

describe("parsePriorityId", () => {
	beforeEach(() => mockExecuteTakeFirst.mockReset());

	it("accepts a valid workspace priority id", async () => {
		mockExecuteTakeFirst.mockResolvedValueOnce({ id: 11 });
		const result = await parsePriorityId({ priorityId: 11 }, 7);
		expect(result).toBe(11);
	});

	it("accepts null to clear priority", async () => {
		const result = await parsePriorityId({ priorityId: null }, 7);
		expect(result).toBeNull();
		expect(mockExecuteTakeFirst).not.toHaveBeenCalled();
	});

	it("rejects a non-integer priorityId", async () => {
		const result = await parsePriorityId({ priorityId: "high" }, 7);
		expect(result).toEqual({ error: expect.any(String) });
	});

	it("rejects a cross-workspace or wrong-kind priority", async () => {
		mockExecuteTakeFirst.mockResolvedValueOnce(undefined);
		const result = await parsePriorityId({ priorityId: 999 }, 7);
		expect(result).toEqual({ error: expect.any(String) });
	});
});

describe("parseLabelIds", () => {
	beforeEach(() => mockExecuteTakeFirst.mockReset());

	it("accepts valid workspace label ids", async () => {
		mockExecuteTakeFirst
			.mockResolvedValueOnce({ id: 1 })
			.mockResolvedValueOnce({ id: 2 });
		const result = await parseLabelIds({ labelIds: [1, 2] }, 7);
		expect(result).toEqual([1, 2]);
	});

	it("rejects non-array labelIds", async () => {
		const result = await parseLabelIds({ labelIds: 1 }, 7);
		expect(result).toEqual({ error: expect.any(String) });
	});

	it("rejects a cross-workspace or wrong-kind label", async () => {
		mockExecuteTakeFirst.mockResolvedValueOnce(undefined);
		const result = await parseLabelIds({ labelIds: [999] }, 7);
		expect(result).toEqual({ error: expect.any(String) });
	});
});

describe("parseDateRange", () => {
	it("accepts a valid YYYY-MM-DD pair", () => {
		const result = parseDateRange({
			startDate: "2026-09-21",
			endDate: "2026-09-30",
		});
		expect(result).toEqual({ startDate: "2026-09-21", endDate: "2026-09-30" });
	});

	it("accepts start-only", () => {
		const result = parseDateRange({ startDate: "2026-09-21" });
		expect(result).toEqual({ startDate: "2026-09-21", endDate: null });
	});

	it("accepts both null", () => {
		const result = parseDateRange({ startDate: null, endDate: null });
		expect(result).toEqual({ startDate: null, endDate: null });
	});

	it("returns an error when end precedes start", () => {
		const result = parseDateRange({
			startDate: "2026-09-30",
			endDate: "2026-09-21",
		});
		expect(result).toMatchObject({ error: expect.any(String) });
		expect(result).toHaveProperty("fieldErrors.endDate");
	});

	it("returns an error when a string is not a calendar date", () => {
		const result = parseDateRange({ startDate: "not-a-date" });
		expect(result).toMatchObject({ error: expect.any(String) });
		expect(result).toHaveProperty("fieldErrors.startDate");
	});

	it("rejects malformed and reversed date-only inputs", () => {
		const malformed = parseDateRange({
			startDate: "2026-02-30",
			endDate: "not-a-date",
		});
		expect(malformed).toMatchObject({
			fieldErrors: {
				startDate: expect.any(String),
				endDate: expect.any(String),
			},
		});
		expect(malformed).not.toHaveProperty("startDate");

		const reversed = parseDateRange({
			startDate: "2026-09-30",
			endDate: "2026-09-21",
		});
		expect(reversed).toMatchObject({
			error: "end date must not precede start date",
			fieldErrors: {
				startDate: "end date must not precede start date",
				endDate: "end date must not precede start date",
			},
		});
	});
});

describe("reference parser characterization", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExecuteTakeFirst.mockReset();
	});

	it("preserves the full runtime barrel API", async () => {
		const exports = await import("./tracker-item-parsers.js");
		const names = [
			"parsePriorityId",
			"parseLabelIds",
			"parseAssigneeIds",
			"parseProjectPhase",
			"parseCardProjectPhase",
			"parseDateRange",
		];
		expect(Object.keys(exports).sort()).toEqual(names.sort());
		for (const value of Object.values(exports)) {
			expect(value).toBeTypeOf("function");
		}
	});

	for (const [field, parser, row, missMessage] of [
		[
			"labelIds",
			parseLabelIds,
			{ id: 1 },
			"label must belong to this workspace",
		],
		[
			"assigneeIds",
			parseAssigneeIds,
			{ role: "member" },
			"assignee must be a member of this workspace",
		],
	] as const) {
		describe(field, () => {
			it.each([
				null,
				"1,2",
				[1, "x"],
				[1, 1.5],
				[1, NaN],
				[1, Infinity],
			])("rejects invalid input %j before any DB lookup", async (input) => {
				expect(await parser({ [field]: input }, 1)).toEqual({
					error: `${field} must be an array of integers`,
				});
				expect(db.selectFrom).not.toHaveBeenCalled();
			});

			it("rejects an absent field before any DB lookup", async () => {
				expect(await parser({}, 1)).toEqual({
					error: `${field} must be an array of integers`,
				});
				expect(db.selectFrom).not.toHaveBeenCalled();
			});

			it("accepts an empty array without DB lookups", async () => {
				expect(await parser({ [field]: [] }, 1)).toEqual([]);
				expect(db.selectFrom).not.toHaveBeenCalled();
			});

			it("preserves duplicate output and looks up only unique ids", async () => {
				mockExecuteTakeFirst.mockResolvedValue(row);
				expect(await parser({ [field]: [2, 1, 2, 1] }, 7)).toEqual([
					2, 1, 2, 1,
				]);
				expect(db.selectFrom).toHaveBeenCalledTimes(2);
				expect(mockExecuteTakeFirst).toHaveBeenCalledTimes(2);
			});

			it("accepts integers outside the safe-integer range", async () => {
				const id = Number.MAX_SAFE_INTEGER + 1;
				mockExecuteTakeFirst.mockResolvedValue(row);
				expect(await parser({ [field]: [id] }, 7)).toEqual([id]);
				expect(mockExecuteTakeFirst).toHaveBeenCalledTimes(1);
			});

			it("keeps the workspace lookup miss message", async () => {
				mockExecuteTakeFirst.mockResolvedValueOnce(undefined);
				expect(await parser({ [field]: [999] }, 7)).toEqual({
					error: missMessage,
				});
			});
		});
	}

	it("uses the supplied executor for all three reference parsers", async () => {
		const executeTakeFirst = vi
			.fn()
			.mockResolvedValue({ id: 1, role: "member" });
		const chain = {
			select: vi.fn(() => chain),
			where: vi.fn(() => chain),
			executeTakeFirst,
		};
		const executor = { selectFrom: vi.fn(() => chain) };
		const dbExec = executor as unknown as DBExecutor;
		expect(await parsePriorityId({ priorityId: 1 }, 7, dbExec)).toBe(1);
		expect(await parseLabelIds({ labelIds: [1] }, 7, dbExec)).toEqual([1]);
		expect(await parseAssigneeIds({ assigneeIds: [1] }, 7, dbExec)).toEqual([
			1,
		]);
		expect(executor.selectFrom.mock.calls).toEqual([
			["tracker_vocabularies"],
			["tracker_vocabularies"],
			["workspace_members"],
		]);
		expect(chain.where).toHaveBeenCalledWith("workspace_id", "=", 7);
		expect(executeTakeFirst).toHaveBeenCalledTimes(3);
		expect(db.selectFrom).not.toHaveBeenCalled();
	});
});
