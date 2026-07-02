// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishAutoError } from "../../lib/ticketIntakeBus";

const mockUseBoard = vi.fn();
const mockOpen = vi.fn();
const mockConfirm = vi.fn();

vi.mock("../../context/BoardContext", () => ({
	useBoard: () => mockUseBoard(),
}));

vi.mock("../../hooks/useTicketIntakeChat", () => ({
	useTicketIntakeChat: () => ({
		open: mockOpen,
		confirm: mockConfirm,
		close: vi.fn(),
		panelOpen: false,
		activeVariant: "global",
		messages: [],
		sendMessage: vi.fn(),
		previewReady: false,
		draft: null,
		editDraft: vi.fn(),
		submitState: "idle",
		resubmit: vi.fn(),
	}),
}));

import { AutoErrorListener } from "./AutoErrorListener";

describe("AutoErrorListener", () => {
	beforeEach(() => {
		mockOpen.mockReset();
		mockConfirm.mockReset();
		mockUseBoard.mockReturnValue({
			activeWorkspaceId: 1,
			ticketIntakeEvents: [],
		});
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("opens autoError chat with error prefill when the bus publishes an auto-error", async () => {
		render(<AutoErrorListener />);

		publishAutoError({
			endpoint: "/api/workspaces/1/cards/5",
			status: 500,
			message: "Internal Server Error",
			timestamp: "2026-07-02T12:00:00.000Z",
			userAction: "Save",
		});

		await waitFor(() => {
			expect(mockOpen).toHaveBeenCalledTimes(1);
		});
		expect(mockOpen).toHaveBeenCalledWith({
			variant: "autoError",
			prefill: {
				endpoint: "/api/workspaces/1/cards/5",
				status: 500,
				errorMessage: "Internal Server Error",
				timestamp: "2026-07-02T12:00:00.000Z",
				userAction: "Save",
			},
		});
		expect(mockConfirm).not.toHaveBeenCalled();
	});

	it("ignores bus events when activeWorkspaceId is null", async () => {
		mockUseBoard.mockReturnValue({
			activeWorkspaceId: null,
			ticketIntakeEvents: [],
		});
		render(<AutoErrorListener />);

		publishAutoError({
			endpoint: "/api/workspaces/1/cards/5",
			status: 500,
			message: "Internal Server Error",
			timestamp: "2026-07-02T12:00:00.000Z",
			userAction: "Save",
		});

		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(mockOpen).not.toHaveBeenCalled();
	});
});
