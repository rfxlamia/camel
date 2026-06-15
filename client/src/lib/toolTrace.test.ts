import { describe, expect, it } from "vitest";
import type { AgentEvent, ToolTraceItem } from "../types";
import { deriveToolTrace, pickToolTraceForColumn } from "./toolTrace";

describe("deriveToolTrace", () => {
	it("merges started + result into one logical step", () => {
		const agentEvents = [
			{
				type: "agent.tool.started",
				columnSlug: "research-specialist",
				toolName: "web_search",
				query: "fintech trends",
			},
			{
				type: "agent.tool.result",
				columnSlug: "research-specialist",
				toolName: "web_search",
				resultCount: 5,
			},
		] as AgentEvent[];

		const toolItems = deriveToolTrace(agentEvents);

		expect(toolItems).toHaveLength(1);
		expect(toolItems[0]).toMatchObject({
			columnSlug: "research-specialist",
			toolName: "web_search",
			query: "fintech trends",
			resultCount: 5,
		});
	});

	it("includes agent.tool.failed on merged or standalone steps", () => {
		const agentEvents = [
			{
				type: "agent.tool.failed",
				columnSlug: "col-a",
				toolName: "web_search",
				errorCode: "RATE_LIMIT",
			},
		] as AgentEvent[];

		expect(deriveToolTrace(agentEvents)[0]).toMatchObject({
			errorCode: "RATE_LIMIT",
		});
	});
});

describe("pickToolTraceForColumn", () => {
	const stored: ToolTraceItem[] = [
		{ columnSlug: "research-specialist", toolName: "web_search", query: "a" },
		{ columnSlug: "writer", toolName: "web_search", query: "b" },
	];

	it("scopes to the requested column", () => {
		const live = deriveToolTrace([
			{
				type: "agent.tool.started",
				columnSlug: "research-specialist",
				toolName: "web_search",
				query: "live",
			},
			{
				type: "agent.tool.result",
				columnSlug: "research-specialist",
				toolName: "web_search",
				resultCount: 2,
			},
		] as AgentEvent[]);

		const picked = pickToolTraceForColumn(stored, live, "research-specialist");
		expect(picked).toHaveLength(1);
		expect(picked[0].query).toBe("live");
		expect(picked[0].resultCount).toBe(2);
	});
});
