// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockUseTicketIntakeChat = vi.fn();
vi.mock("./useTicketIntakeChat", () => ({
	useTicketIntakeChat: () => mockUseTicketIntakeChat(),
}));
vi.mock("../features/board", () => ({
	useBoard: () => ({
		ticketIntakeEvents: [],
	}),
}));
vi.mock("./WorkspaceContext", () => ({
	useWorkspace: () => ({
		activeWorkspaceId: 1,
	}),
}));
vi.mock("./PreviewScreen", () => ({
	PreviewScreen: () => <div data-testid="preview-screen" />,
}));

import { ChatPanel } from "./TicketIntakeChatPanel";

describe("ChatPanel", () => {
	afterEach(cleanup);

	it("shows the classifier question and a reply input while previewReady is false", () => {
		mockUseTicketIntakeChat.mockReturnValue({
			messages: [{ role: "assistant", content: "bug or feature?" }],
			previewReady: false,
			sendMessage: vi.fn(),
			draft: null,
			confirm: vi.fn(),
			editDraft: vi.fn(),
			submitState: "idle",
			resubmit: vi.fn(),
		});
		render(<ChatPanel onClose={vi.fn()} />);
		expect(screen.getByText("bug or feature?")).toBeTruthy();
		expect(screen.getByRole("textbox")).toBeTruthy();
	});

	it("renders PreviewScreen instead of the message input once previewReady is true", () => {
		mockUseTicketIntakeChat.mockReturnValue({
			messages: [],
			previewReady: true,
			sendMessage: vi.fn(),
			draft: { title: "t", description: "d", type: "Bug" },
			confirm: vi.fn(),
			editDraft: vi.fn(),
			submitState: "idle",
			resubmit: vi.fn(),
		});
		render(<ChatPanel onClose={vi.fn()} />);
		expect(screen.getByTestId("preview-screen")).toBeTruthy();
		expect(screen.queryByRole("textbox")).toBeNull();
	});
});
