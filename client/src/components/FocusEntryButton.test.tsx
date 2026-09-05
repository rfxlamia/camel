// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FocusSession } from "../types";

const { mockUseFocusSession, mockNavigate, mockUseBoard, mockShowToast } =
	vi.hoisted(() => ({
		mockUseFocusSession: vi.fn(),
		mockNavigate: vi.fn(),
		mockUseBoard: vi.fn(),
		mockShowToast: vi.fn(),
	}));

vi.mock("../context/FocusSessionContext", () => ({
	useFocusSession: () => mockUseFocusSession(),
}));

vi.mock("react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-router")>();
	return {
		...actual,
		useNavigate: () => mockNavigate,
	};
});

vi.mock("../context/BoardContext", () => ({
	useBoard: () => mockUseBoard(),
}));

import { ApiError } from "../api";
import FocusEntryButton from "./FocusEntryButton";

function makeSession(overrides: Partial<FocusSession> = {}): FocusSession {
	return {
		id: 1,
		state: "ready",
		accumulatedSeconds: 0,
		runningSince: null,
		version: 2,
		source: "board",
		taskId: 481,
		taskKey: "CA-42",
		returnPath: "/board/card/481",
		finishedAt: null,
		...overrides,
	};
}

function setupNoSession() {
	const focus = vi.fn().mockResolvedValue(undefined);
	const switchTo = vi.fn().mockResolvedValue(undefined);
	mockUseFocusSession.mockReturnValue({
		session: null,
		loading: false,
		actionError: null,
		focus,
		switchTo,
		start: vi.fn(),
		pause: vi.fn(),
		resume: vi.fn(),
		finish: vi.fn(),
	});
	mockUseBoard.mockReturnValue({
		focusModeEnabled: true,
		showToast: mockShowToast,
	});
	return { focus, switchTo };
}

describe("FocusEntryButton", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it('Given board card C, When "Focus on this task", Then focus and navigate', async () => {
		const { focus } = setupNoSession();
		render(<FocusEntryButton source="board" taskId={481} taskKey="CA-42" />);

		fireEvent.click(
			screen.getByRole("button", { name: /focus on this task/i }),
		);

		await waitFor(() => {
			expect(focus).toHaveBeenCalledWith({ source: "board", taskId: 481 });
		});
		expect(mockNavigate).toHaveBeenCalledWith("/focus");
	});

	it('Given tracker item T, When "Focus on this task", Then tracker source is preserved', async () => {
		const { focus } = setupNoSession();
		render(<FocusEntryButton source="tracker" taskId={77} taskKey="CAM-42" />);

		fireEvent.click(
			screen.getByRole("button", { name: /focus on this task/i }),
		);

		await waitFor(() => {
			expect(focus).toHaveBeenCalledWith({ source: "tracker", taskId: 77 });
		});
		expect(mockNavigate).toHaveBeenCalledWith("/focus");
	});

	it("Given Ready session on task T, When focus on T again, Then navigate without dialog", () => {
		const focus = vi.fn();
		const switchTo = vi.fn();
		mockUseFocusSession.mockReturnValue({
			session: makeSession({ state: "ready", source: "board", taskId: 481 }),
			loading: false,
			actionError: null,
			focus,
			switchTo,
			start: vi.fn(),
			pause: vi.fn(),
			resume: vi.fn(),
			finish: vi.fn(),
		});
		mockUseBoard.mockReturnValue({
			focusModeEnabled: true,
			showToast: mockShowToast,
		});

		render(<FocusEntryButton source="board" taskId={481} taskKey="CA-42" />);

		fireEvent.click(
			screen.getByRole("button", { name: /focus on this task/i }),
		);

		expect(mockNavigate).toHaveBeenCalledWith("/focus");
		expect(focus).not.toHaveBeenCalled();
		expect(switchTo).not.toHaveBeenCalled();
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("Given Running on A, When focus on B and confirm, Then switchTo after dialog", async () => {
		const active = makeSession({
			state: "running",
			source: "board",
			taskId: 10,
			version: 5,
			accumulatedSeconds: 300,
			runningSince: "2026-09-04T10:00:00.000Z",
		});
		const focus = vi
			.fn()
			.mockRejectedValue(
				new ApiError(
					"Conflict",
					409,
					"session_active",
					undefined,
					undefined,
					active,
				),
			);
		const switchTo = vi.fn().mockResolvedValue(undefined);
		mockUseFocusSession.mockReturnValue({
			session: active,
			loading: false,
			actionError: null,
			focus,
			switchTo,
			start: vi.fn(),
			pause: vi.fn(),
			resume: vi.fn(),
			finish: vi.fn(),
		});
		mockUseBoard.mockReturnValue({
			focusModeEnabled: true,
			showToast: mockShowToast,
		});

		render(<FocusEntryButton source="board" taskId={481} taskKey="CA-99" />);

		fireEvent.click(
			screen.getByRole("button", { name: /focus on this task/i }),
		);

		await waitFor(() => {
			expect(screen.getByRole("dialog")).toBeTruthy();
		});
		expect(switchTo).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: /^switch focus$/i }));

		await waitFor(() => {
			expect(switchTo).toHaveBeenCalledWith({
				source: "board",
				taskId: 481,
				version: 5,
				sessionId: 1,
			});
		});
		expect(mockNavigate).toHaveBeenCalledWith("/focus");
	});

	it("Given Paused session on A, When focus on B is cancelled, Then A remains untouched", async () => {
		const active = makeSession({
			state: "paused",
			source: "board",
			taskId: 10,
			version: 3,
			accumulatedSeconds: 420,
		});
		const focus = vi
			.fn()
			.mockRejectedValue(
				new ApiError(
					"Conflict",
					409,
					"session_active",
					undefined,
					undefined,
					active,
				),
			);
		const switchTo = vi.fn();
		mockUseFocusSession.mockReturnValue({
			session: active,
			loading: false,
			actionError: null,
			focus,
			switchTo,
			start: vi.fn(),
			pause: vi.fn(),
			resume: vi.fn(),
			finish: vi.fn(),
		});
		mockUseBoard.mockReturnValue({
			focusModeEnabled: true,
			showToast: mockShowToast,
		});

		render(<FocusEntryButton source="board" taskId={481} taskKey="CA-99" />);

		fireEvent.click(
			screen.getByRole("button", { name: /focus on this task/i }),
		);

		await waitFor(() => {
			expect(screen.getByRole("dialog")).toBeTruthy();
		});

		fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

		expect(switchTo).not.toHaveBeenCalled();
		expect(mockNavigate).not.toHaveBeenCalled();
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("Given focus() rejects 409 session_active, When clicked, Then confirmation dialog appears", async () => {
		const active = makeSession({ taskId: 22, version: 4 });
		const focus = vi
			.fn()
			.mockRejectedValue(
				new ApiError(
					"Conflict",
					409,
					"session_active",
					undefined,
					undefined,
					active,
				),
			);
		const switchTo = vi.fn();
		mockUseFocusSession.mockReturnValue({
			session: null,
			loading: false,
			actionError: null,
			focus,
			switchTo,
			start: vi.fn(),
			pause: vi.fn(),
			resume: vi.fn(),
			finish: vi.fn(),
		});
		mockUseBoard.mockReturnValue({
			focusModeEnabled: true,
			showToast: mockShowToast,
		});

		render(<FocusEntryButton source="tracker" taskId={77} taskKey="CAM-42" />);

		fireEvent.click(
			screen.getByRole("button", { name: /focus on this task/i }),
		);

		await waitFor(() => {
			expect(screen.getByRole("dialog")).toBeTruthy();
		});
		expect(switchTo).not.toHaveBeenCalled();
		expect(mockShowToast).not.toHaveBeenCalled();
	});

	it("toasts when focus() rejects with a transport error", async () => {
		const { focus } = setupNoSession();
		focus.mockRejectedValue(new TypeError("Failed to fetch"));
		render(<FocusEntryButton source="board" taskId={481} taskKey="CA-42" />);

		fireEvent.click(
			screen.getByRole("button", { name: /focus on this task/i }),
		);

		await waitFor(() => {
			expect(mockShowToast).toHaveBeenCalledWith(
				"Couldn't start focus. Try again.",
				"error",
			);
		});
		expect(mockNavigate).not.toHaveBeenCalled();
	});

	it("toasts when switchTo rejects with a transport error", async () => {
		const active = makeSession({
			state: "running",
			source: "board",
			taskId: 10,
			version: 5,
		});
		const focus = vi
			.fn()
			.mockRejectedValue(
				new ApiError(
					"Conflict",
					409,
					"session_active",
					undefined,
					undefined,
					active,
				),
			);
		const switchTo = vi
			.fn()
			.mockRejectedValue(new TypeError("Failed to fetch"));
		mockUseFocusSession.mockReturnValue({
			session: active,
			loading: false,
			actionError: null,
			focus,
			switchTo,
			start: vi.fn(),
			pause: vi.fn(),
			resume: vi.fn(),
			finish: vi.fn(),
		});
		mockUseBoard.mockReturnValue({
			focusModeEnabled: true,
			showToast: mockShowToast,
		});

		render(<FocusEntryButton source="board" taskId={481} taskKey="CA-99" />);

		fireEvent.click(
			screen.getByRole("button", { name: /focus on this task/i }),
		);

		await waitFor(() => {
			expect(screen.getByRole("dialog")).toBeTruthy();
		});

		fireEvent.click(screen.getByRole("button", { name: /^switch focus$/i }));

		await waitFor(() => {
			expect(mockShowToast).toHaveBeenCalledWith(
				"Couldn't switch focus. Try again.",
				"error",
			);
		});
		expect(mockNavigate).not.toHaveBeenCalled();
	});

	it("renders nothing when focusModeEnabled is false", () => {
		setupNoSession();
		mockUseBoard.mockReturnValue({
			focusModeEnabled: false,
			showToast: mockShowToast,
		});

		render(<FocusEntryButton source="board" taskId={481} taskKey="CA-42" />);

		expect(
			screen.queryByRole("button", { name: /focus on this task/i }),
		).toBeNull();
	});
});
