// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockUseBoard = vi.fn();
vi.mock("../../context/BoardContext", () => ({
	useBoard: () => mockUseBoard(),
}));
vi.mock("../../hooks/useTicketIntakeChat", () => ({
	useTicketIntakeChat: () => ({
		messages: [],
		sendMessage: vi.fn(),
		previewReady: false,
		draft: null,
		confirm: vi.fn(),
		editDraft: vi.fn(),
		submitState: "idle",
		resubmit: vi.fn(),
	}),
}));

import { FloatingChatButton } from "./FloatingChatButton";

describe("FloatingChatButton", () => {
	afterEach(cleanup);

	it("renders nothing when activeWorkspaceId is null", () => {
		mockUseBoard.mockReturnValue({
			activeWorkspaceId: null,
			ticketIntakeEvents: [],
		});
		const { container } = render(<FloatingChatButton />);
		expect(container.childElementCount).toBe(0);
	});

	it("renders a clickable Button Primary token button when a workspace is active", () => {
		mockUseBoard.mockReturnValue({
			activeWorkspaceId: 1,
			ticketIntakeEvents: [],
		});
		render(<FloatingChatButton />);
		const button = screen.getByRole("button", { name: /report issue/i });
		expect(button).toBeTruthy();
		expect(button.className).toMatch(/bg-primary-600/);
	});
});
