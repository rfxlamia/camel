// server/src/routes/tracker-item-parsers.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

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
