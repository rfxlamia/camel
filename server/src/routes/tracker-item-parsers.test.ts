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
			chain.where = vi.fn(() => chain);
			chain.executeTakeFirst = mockExecuteTakeFirst;
			return chain;
		}),
	},
}));

import { parseDateRange, parseProjectPhase } from "./tracker-item-parsers.js";

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
		const result = await parseProjectPhase(
			{ projectId: null, phaseId: 5 },
			7,
		);
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
		expect(result).toEqual({ error: expect.any(String) });
	});

	it("returns an error when a string is not a calendar date", () => {
		const result = parseDateRange({ startDate: "not-a-date" });
		expect(result).toEqual({ error: expect.any(String) });
	});
});
