import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { deriveToolTrace } from "../lib/toolTrace";
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

	it("shows success badge when all steps succeed", () => {
		const { container } = render(
			<ToolTrace
				steps={[
					{
						toolName: "web_search",
						query: "test",
						resultCount: 5,
						columnSlug: "test",
					},
				]}
			/>,
		);
		expect(container.textContent).toContain("success");
		expect(container.textContent).not.toContain("error");
	});

	it("hides query in summary when longer than 48 chars", () => {
		const longQuery = "a".repeat(49);
		const { container } = render(
			<ToolTrace
				steps={[
					{
						toolName: "web_search",
						query: longQuery,
						resultCount: 5,
						columnSlug: "test",
					},
				]}
			/>,
		);
		expect(container.textContent).not.toContain(longQuery);
		expect(container.textContent).toContain("web_search");
	});

	it("handles undefined query gracefully", () => {
		const { container } = render(
			<ToolTrace
				steps={[
					{
						toolName: "query_board_data",
						columnSlug: "test",
						resultCount: 5,
					},
				]}
			/>,
		);
		expect(container.textContent).toContain("query_board_data");
		expect(container.textContent).toContain("5 results");
		expect(container.textContent).toContain("success");
	});
});

describe("deriveToolTrace", () => {
	it("filters out non-tool agent events and maps tool events to ToolTraceItem[]", () => {
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
		] as any[];

		const toolItems = deriveToolTrace(agentEvents);

		expect(toolItems).toHaveLength(1);
		expect(toolItems[0]).toMatchObject({
			columnSlug: "research-specialist",
			toolName: "web_search",
			query: "fintech trends",
			resultCount: 5,
		});
	});

	it("includes agent.tool.failed events", () => {
		const agentEvents = [
			{
				type: "agent.tool.failed",
				columnSlug: "col-a",
				toolName: "db_query",
				errorCode: "TIMEOUT",
			},
		] as any[];

		const toolItems = deriveToolTrace(agentEvents);

		expect(toolItems).toHaveLength(1);
		expect(toolItems[0]).toMatchObject({
			columnSlug: "col-a",
			toolName: "db_query",
			errorCode: "TIMEOUT",
		});
	});

	it("returns an empty array when there are no agent.tool.* events", () => {
		const agentEvents = [
			{ type: "agent.card.started", columnSlug: "col-b" },
			{ type: "agent.card.done", columnSlug: "col-b" },
		] as any[];

		expect(deriveToolTrace(agentEvents)).toHaveLength(0);
	});

	it("returns an empty array for an empty input", () => {
		expect(deriveToolTrace([])).toHaveLength(0);
	});
});
