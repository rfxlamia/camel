import { describe, expect, it } from "vitest";
import {
	countSearchResults,
	mergeToolTraceRows,
	parseToolCallInput,
} from "./trace.js";

describe("countSearchResults", () => {
	it("counts numbered result lines", () => {
		const content = "1. A\n   url\n   snip\n\n2. B\n   url\n   snip";
		expect(countSearchResults(content)).toBe(2);
	});

	it("returns 0 for empty-results message", () => {
		expect(countSearchResults("no results found for x")).toBe(0);
	});
});

describe("parseToolCallInput", () => {
	it("reads query from object input", () => {
		expect(parseToolCallInput({ query: "fintech" })).toEqual({
			query: "fintech",
		});
	});

	it("reads query from legacy string input", () => {
		expect(parseToolCallInput("fintech")).toEqual({ query: "fintech" });
	});
});

describe("mergeToolTraceRows", () => {
	it("merges started + result rows into one step", () => {
		const merged = mergeToolTraceRows([
			{
				column_slug: "research-specialist",
				tool_name: "web_search",
				input: { query: "fintech" },
				result: "started",
				error_code: null,
				attempt: 1,
				created_at: "2026-06-15T10:00:00Z",
			},
			{
				column_slug: "research-specialist",
				tool_name: "web_search",
				input: { query: "fintech", resultCount: 5 },
				result: "5",
				error_code: null,
				attempt: 1,
				created_at: "2026-06-15T10:00:01Z",
			},
		]);

		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({
			columnSlug: "research-specialist",
			toolName: "web_search",
			query: "fintech",
			resultCount: 5,
		});
	});

	it("includes reasoning rows", () => {
		const merged = mergeToolTraceRows([
			{
				column_slug: "research-specialist",
				tool_name: "_reasoning",
				input: null,
				result: "let me search",
				error_code: null,
				attempt: 1,
				created_at: "2026-06-15T09:59:00Z",
			},
		]);
		expect(merged[0]).toMatchObject({
			toolName: "_reasoning",
			reasoningText: "let me search",
		});
	});
});
