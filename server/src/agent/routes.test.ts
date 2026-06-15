import { describe, it, expect, vi } from "vitest";
import { getToolTrace, runInsertColumns } from "./routes.js";

describe("getToolTrace (read-only replay)", () => {
	it("returns the flat trace ordered by created_at, scoped to the board", async () => {
		const rows = [
			{
				column_slug: "research-specialist",
				tool_name: "web_search",
				input: { query: "fintech" },
				result: "…",
				error_code: null,
				attempt: 1,
				created_at: "2026-06-15T10:00:00Z",
			},
		];
		const fakeDb = { query: vi.fn(async () => ({ rows })) };

		const trace = await getToolTrace(fakeDb as any, 42);

		// scoped to the board id
		expect(fakeDb.query).toHaveBeenCalledWith(expect.any(String), [42]);
		const sql = fakeDb.query.mock.calls[0][0] as string;
		expect(sql).toMatch(/agent_tool_calls/i);
		expect(sql).toMatch(/board_id\s*=\s*\$1/i);
		expect(sql).toMatch(/order by\s+created_at/i);

		// flat shape the client expects (groups by columnSlug itself)
		expect(trace).toEqual([
			expect.objectContaining({
				columnSlug: "research-specialist",
				toolName: "web_search",
				query: "fintech",
				attempt: 1,
				createdAt: "2026-06-15T10:00:00Z",
			}),
		]);
	});

	it("is read-only — issues exactly one SELECT and executes no tool", async () => {
		const fakeDb = { query: vi.fn(async () => ({ rows: [] })) };
		const trace = await getToolTrace(fakeDb as any, 1);

		expect(trace).toEqual([]);
		expect(fakeDb.query).toHaveBeenCalledTimes(1);
		expect(
			(fakeDb.query.mock.calls[0][0] as string).toLowerCase(),
		).not.toContain("insert");
	});
});

describe("insertColumns tools serialization", () => {
	it("passes a raw array for TEXT[] tools column, not a JSON string", async () => {
		const mockDb = { query: vi.fn(async () => ({})) };

		await runInsertColumns(mockDb as any, {
			boardId: 1,
			workspaceId: 1,
			columns: [
				{
					name: "Research",
					position: 1,
					slug: "research-specialist",
					reasoning: false,
					system_prompt: "Do research",
					tools: ["web_search"],
					tool_budget: 3,
				},
			],
		});

		expect(mockDb.query).toHaveBeenCalledTimes(1);
		const params = mockDb.query.mock.calls[0][1] as unknown[];
		const toolsArg = params[7]; // $8 is the tools parameter

		// Must be a raw array, NOT a JSON string
		expect(Array.isArray(toolsArg)).toBe(true);
		expect(toolsArg).toEqual(["web_search"]);
		expect(typeof toolsArg).not.toBe("string");
	});

	it("passes an empty array when tools is undefined", async () => {
		const mockDb = { query: vi.fn(async () => ({})) };

		await runInsertColumns(mockDb as any, {
			boardId: 1,
			workspaceId: 1,
			columns: [
				{
					name: "Analysis",
					position: 2,
					slug: "analysis",
					reasoning: false,
					system_prompt: "Analyse",
					tools: undefined,
					tool_budget: undefined,
				},
			],
		});

		const params = mockDb.query.mock.calls[0][1] as unknown[];
		const toolsArg = params[7];

		expect(Array.isArray(toolsArg)).toBe(true);
		expect(toolsArg).toEqual([]);
	});
});
