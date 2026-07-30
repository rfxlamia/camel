// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockListThreads = vi.fn();
const mockCreateThread = vi.fn();
const mockDeleteThread = vi.fn();
const mockNavigate = vi.fn();

vi.mock("react-router", () => ({
	useNavigate: () => mockNavigate,
	useParams: () => ({ threadId: undefined }),
	Navigate: ({ to }: { to: string }) => <div data-testid="redirect">{to}</div>,
}));

vi.mock("../api", () => ({
	api: {
		chat: {
			listThreads: (...a: unknown[]) => mockListThreads(...a),
			createThread: (...a: unknown[]) => mockCreateThread(...a),
			deleteThread: (...a: unknown[]) => mockDeleteThread(...a),
			getMessages: vi.fn().mockResolvedValue([]),
		},
	},
}));

vi.mock("@assistant-ui/react", () => ({
	Thread: () => <div data-testid="chat-thread" />,
	Composer: () => <div data-testid="chat-composer" />,
}));

describe("ChatPage", () => {
	beforeEach(() => {
		mockListThreads.mockResolvedValue([{ id: 1, title: "Untitled", messageCount: 0 }]);
		mockCreateThread.mockResolvedValue({ id: 2, title: "Untitled" });
		mockDeleteThread.mockResolvedValue(undefined);
	});
	afterEach(() => cleanup());

	it("renders thread list and message area", async () => {
		const { default: ChatPage } = await import("./ChatPage");
		render(<ChatPage />);
		await waitFor(() => {
			expect(screen.getByTestId("chat-thread")).toBeTruthy();
			expect(screen.getByTestId("chat-composer")).toBeTruthy();
		});
	});

	it("redirects /chat to a thread", async () => {
		const { default: ChatPage } = await import("./ChatPage");
		render(<ChatPage />);
		await waitFor(() => {
			expect(screen.getByTestId("redirect").textContent).toMatch(/\/chat\//);
		});
	});

	it("shows confirm dialog before deleting non-empty thread", async () => {
		mockListThreads.mockResolvedValue([{ id: 5, title: "Budget", messageCount: 3 }]);
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
		const { default: ChatPage } = await import("./ChatPage");
		render(<ChatPage />);
		const deleteBtn = await screen.findByRole("button", { name: /delete/i });
		fireEvent.click(deleteBtn);
		expect(confirmSpy).toHaveBeenCalled();
		expect(mockDeleteThread).not.toHaveBeenCalled();
		confirmSpy.mockRestore();
	});
});
