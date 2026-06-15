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
