import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToolTrace } from "./ToolTrace";

describe("ToolTrace", () => {
	it("renders collapsed by default with a one-line summary", () => {
		const { container } = render(
			<ToolTrace
				steps={[
					{
						toolName: "web_search",
						query: "X",
						resultCount: 10,
						columnSlug: "test",
					},
				]}
			/>,
		);
		expect(container.textContent).toContain("web_search");
		expect(container.textContent).toContain("X");
		expect(container.textContent).toContain("10 results");
	});

	it("expands to show step detail on click", () => {
		const { container } = render(
			<ToolTrace
				steps={[
					{
						toolName: "web_search",
						query: "X",
						resultCount: 10,
						columnSlug: "test",
					},
				]}
			/>,
		);
		expect(screen.queryByTestId("tool-trace-detail")).toBeNull();
		const button = container.querySelector("button");
		expect(button).toBeTruthy();
		fireEvent.click(button!);
		expect(screen.getByTestId("tool-trace-detail")).toBeTruthy();
	});

	it("shows a failed state when a step carries an errorCode", () => {
		const { container } = render(
			<ToolTrace
				steps={[
					{
						toolName: "web_search",
						query: "X",
						errorCode: "RATE_LIMIT",
						columnSlug: "test",
					},
				]}
			/>,
		);
		// Summary shows "error" badge
		expect(container.textContent).toContain("error");
		// Expand to see errorCode detail
		const button = container.querySelector("button");
		fireEvent.click(button!);
		expect(container.textContent).toContain("RATE_LIMIT");
	});

	it("renders nothing when there are no steps", () => {
		const { container } = render(<ToolTrace steps={[]} />);
		expect(container.textContent).toBe("");
	});
});

describe("toolTrace derivation from agentEvents", () => {
	it("maps agent.tool.* events to ToolTraceItem[] and filters out non-tool events", () => {
		// Simulate the mapping logic from BoardContext
		const agentEvents = [
			{ type: "agent.card.started", columnSlug: "research" },
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
			{ type: "agent.card.done", columnSlug: "research" },
		];

		const toolItems = agentEvents
			.filter(
				(e) =>
					e.type === "agent.tool.started" ||
					e.type === "agent.tool.result" ||
					e.type === "agent.tool.failed",
			)
			.map((e) => ({
				columnSlug: e.columnSlug ?? "",
				toolName: (e as { toolName?: string }).toolName ?? "",
				query: (e as { query?: string }).query,
				resultCount: (e as { resultCount?: number }).resultCount,
				errorCode: (e as { errorCode?: string }).errorCode,
				attempt: (e as { attempt?: number }).attempt,
			}));

		expect(toolItems).toHaveLength(2);
		expect(toolItems[0]).toMatchObject({
			columnSlug: "research-specialist",
			toolName: "web_search",
			query: "fintech trends",
		});
		expect(toolItems[1]).toMatchObject({
			columnSlug: "research-specialist",
			toolName: "web_search",
			resultCount: 5,
		});
	});
});
