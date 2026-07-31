// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatMessage } from "./ChatMessage";

describe("ChatMessage", () => {
	it("renders markdown content", () => {
		render(
			<ChatMessage
				role="assistant"
				content="# Title\nBody"
				thinking={null}
				toolTrace={[]}
				attachments={[]}
			/>,
		);
		expect(screen.getByText("Title")).toBeTruthy();
		expect(screen.getByText("Body")).toBeTruthy();
	});

	it("shows ToolTrace with error badge on tool failure", () => {
		const { container } = render(
			<ChatMessage
				role="assistant"
				content="Done"
				thinking={null}
				toolTrace={[
					{ toolName: "web_search", query: "x", errorCode: "RATE_LIMIT" },
				]}
				attachments={[]}
			/>,
		);
		expect(container.textContent).toContain("error");
		fireEvent.click(container.querySelector("button")!);
		expect(container.textContent).toContain("RATE_LIMIT");
	});

	it("rehydrates thinking blocks from stored data", () => {
		render(
			<ChatMessage
				role="assistant"
				content="Answer"
				thinking="I considered options"
				toolTrace={[]}
				attachments={[]}
			/>,
		);
		expect(screen.getByText(/considered options/i)).toBeTruthy();
	});

	it("renders download link for create_file attachment", () => {
		render(
			<ChatMessage
				role="assistant"
				content="Created your file."
				thinking={null}
				toolTrace={[]}
				attachments={[
					{
						id: 42,
						messageId: 99,
						filename: "notes.md",
						format: "md",
					},
				]}
			/>,
		);
		const link = screen.getByRole("button", { name: /notes\.md/i });
		expect(link).toBeTruthy();
	});
});
