// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FocusSession } from "../types";

const { mockUseFocusSession, mockNavigate, mockUseBoard } = vi.hoisted(() => ({
	mockUseFocusSession: vi.fn(),
	mockNavigate: vi.fn(),
	mockUseBoard: vi.fn(),
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

import FocusIndicator from "./FocusIndicator";

function makeSession(overrides: Partial<FocusSession> = {}): FocusSession {
	return {
		id: 1,
		state: "running",
		accumulatedSeconds: 600,
		runningSince: "2026-09-04T10:00:00.000Z",
		version: 2,
		source: "board",
		taskId: 481,
		taskKey: "CA-42",
		returnPath: "/board/card/481",
		finishedAt: null,
		...overrides,
	};
}

function setupActiveSession(session: FocusSession = makeSession()) {
	mockUseFocusSession.mockReturnValue({
		session,
		loading: false,
		actionError: null,
		focus: vi.fn(),
		switchTo: vi.fn(),
		start: vi.fn(),
		pause: vi.fn(),
		resume: vi.fn(),
		finish: vi.fn(),
	});
	mockUseBoard.mockReturnValue({ focusModeEnabled: true });
}

describe("FocusIndicator", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it("navigates to /focus when Focus active is clicked", () => {
		setupActiveSession();
		render(<FocusIndicator />);

		fireEvent.click(screen.getByRole("button", { name: /focus active/i }));

		expect(mockNavigate).toHaveBeenCalledWith("/focus");
	});

	it.each([
		"ready",
		"running",
		"paused",
	] as const)("renders Focus active when session is %s", (state) => {
		setupActiveSession(makeSession({ state }));
		render(<FocusIndicator />);

		expect(screen.getByRole("button", { name: /focus active/i })).toBeTruthy();
	});

	it("renders nothing when session is null", () => {
		mockUseFocusSession.mockReturnValue({
			session: null,
			loading: false,
			actionError: null,
			focus: vi.fn(),
			switchTo: vi.fn(),
			start: vi.fn(),
			pause: vi.fn(),
			resume: vi.fn(),
			finish: vi.fn(),
		});
		mockUseBoard.mockReturnValue({ focusModeEnabled: true });
		render(<FocusIndicator />);

		expect(screen.queryByRole("button", { name: /focus active/i })).toBeNull();
	});

	it("renders Focus active when a session exists even if focusModeEnabled is false", () => {
		setupActiveSession();
		mockUseBoard.mockReturnValue({ focusModeEnabled: false });
		render(<FocusIndicator />);

		expect(screen.getByRole("button", { name: /focus active/i })).toBeTruthy();
	});

	it("renders nothing when focusModeEnabled is false and there is no session", () => {
		mockUseFocusSession.mockReturnValue({
			session: null,
			loading: false,
			actionError: null,
			focus: vi.fn(),
			switchTo: vi.fn(),
			start: vi.fn(),
			pause: vi.fn(),
			resume: vi.fn(),
			finish: vi.fn(),
		});
		mockUseBoard.mockReturnValue({ focusModeEnabled: false });
		render(<FocusIndicator />);

		expect(screen.queryByRole("button", { name: /focus active/i })).toBeNull();
	});

	it("renders nothing while session is loading", () => {
		mockUseFocusSession.mockReturnValue({
			session: makeSession(),
			loading: true,
			actionError: null,
			focus: vi.fn(),
			switchTo: vi.fn(),
			start: vi.fn(),
			pause: vi.fn(),
			resume: vi.fn(),
			finish: vi.fn(),
		});
		mockUseBoard.mockReturnValue({ focusModeEnabled: true });
		render(<FocusIndicator />);

		expect(screen.queryByRole("button", { name: /focus active/i })).toBeNull();
	});
});
