// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FocusSession, TrackerVocabulary } from "../types";

const cardEventHandlers: Array<(event: unknown) => void> = [];
const trackerEventHandlers: Array<(event: unknown) => void> = [];

const {
	mockGetCard,
	mockGetWorkItem,
	mockNavigate,
	mockUseFocusSession,
	mockUseBoard,
} = vi.hoisted(() => ({
	mockGetCard: vi.fn(),
	mockGetWorkItem: vi.fn(),
	mockNavigate: vi.fn(),
	mockUseFocusSession: vi.fn(),
	mockUseBoard: vi.fn(),
}));

vi.mock("../api", () => ({
	api: {
		getCard: (...a: unknown[]) => mockGetCard(...a),
		getWorkItem: (...a: unknown[]) => mockGetWorkItem(...a),
	},
}));

vi.mock("../context/FocusSessionContext", () => ({
	useFocusSession: () => mockUseFocusSession(),
}));

vi.mock("../context/BoardContext", () => ({
	useBoard: () => mockUseBoard(),
}));

vi.mock("react-router", () => ({
	useNavigate: () => mockNavigate,
}));

import FocusPage from "./FocusPage";

const WORKSPACE_ID = 7;

function makeSession(overrides: Partial<FocusSession> = {}): FocusSession {
	return {
		id: 1,
		state: "ready",
		accumulatedSeconds: 0,
		runningSince: null,
		version: 1,
		source: "board",
		taskId: 481,
		taskKey: "CAM-42",
		returnPath: "/board/card/481",
		finishedAt: null,
		...overrides,
	};
}

const backlog: TrackerVocabulary = {
	id: 1,
	kind: "status",
	name: "Backlog",
	position: 1000,
	colour: "oklch(0.7 0.1 200)",
};
const highPriority: TrackerVocabulary = {
	id: 2,
	kind: "priority",
	name: "High",
	position: 1000,
	colour: "oklch(0.7 0.1 15)",
};
const bugLabel: TrackerVocabulary = {
	id: 3,
	kind: "label",
	name: "Bug",
	position: 1000,
	colour: "oklch(0.7 0.1 280)",
};

function makePopulatedCard() {
	return {
		id: 481,
		columnId: 1,
		title: "Focus task title",
		description: "Focus task description",
		position: 1024,
		version: 1,
		createdAt: "2026-09-01T00:00:00Z",
		updatedAt: "2026-09-01T00:00:00Z",
		startedAt: null,
		doneAt: null,
		dueDate: "2026-12-01",
		status: backlog,
		priority: highPriority,
		labels: [bugLabel],
		assignees: [{ id: 2, username: "bob", displayName: "Bob" }],
	};
}

function setupBoardMocks() {
	mockUseBoard.mockReturnValue({
		activeWorkspaceId: WORKSPACE_ID,
		subscribeCardEvents: (handler: (event: unknown) => void) => {
			cardEventHandlers.push(handler);
			return () => {
				const index = cardEventHandlers.indexOf(handler);
				if (index >= 0) cardEventHandlers.splice(index, 1);
			};
		},
		subscribeTrackerEvents: (handler: (event: unknown) => void) => {
			trackerEventHandlers.push(handler);
			return () => {
				const index = trackerEventHandlers.indexOf(handler);
				if (index >= 0) trackerEventHandlers.splice(index, 1);
			};
		},
	});
}

function setupSessionMocks(
	overrides: Partial<ReturnType<typeof mockUseFocusSession>> = {},
) {
	mockUseFocusSession.mockReturnValue({
		session: makeSession(),
		loading: false,
		actionError: null,
		start: vi.fn().mockResolvedValue(undefined),
		pause: vi.fn().mockResolvedValue(undefined),
		resume: vi.fn().mockResolvedValue(undefined),
		finish: vi.fn(),
		focus: vi.fn(),
		switchTo: vi.fn(),
		...overrides,
	});
}

beforeEach(() => {
	cardEventHandlers.length = 0;
	trackerEventHandlers.length = 0;
	mockNavigate.mockReset();
	mockGetCard.mockReset();
	mockGetWorkItem.mockReset();
	setupBoardMocks();
	setupSessionMocks();
	mockGetCard.mockResolvedValue({
		id: 481,
		title: "Old title",
		description: "Card description",
	});
	mockGetWorkItem.mockResolvedValue({
		id: 77,
		key: "CAM-42",
		title: "Old title",
		description: "Tracker description",
		source: "tracker",
	});
});

afterEach(() => {
	cleanup();
});

describe("FocusPage", () => {
	it("Given no active session and hydration complete, When /focus is opened directly, Then redirect to /board", async () => {
		setupSessionMocks({ session: null, loading: false });

		render(<FocusPage />);

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith("/board", { replace: true });
		});
		expect(screen.queryByText(/Couldn't/i)).toBeNull();
	});

	it("Given session is still loading, When the page renders, Then no redirect while hydrating", () => {
		setupSessionMocks({ session: null, loading: true });

		render(<FocusPage />);

		expect(mockNavigate).not.toHaveBeenCalled();
	});

	it("Given a board-sourced focus session, When the surface loads, Then the card title and description are visible", async () => {
		mockGetCard.mockResolvedValue({
			id: 481,
			title: "Board card title",
			description: "Board card description",
		});

		render(<FocusPage />);

		await waitFor(() => {
			expect(mockGetCard).toHaveBeenCalledWith(WORKSPACE_ID, 481);
		});
		expect(mockGetWorkItem).not.toHaveBeenCalled();
		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
			"Board card title",
		);
		expect(screen.getByText("Board card description")).toBeTruthy();
	});

	it("Given a tracker-sourced focus session, When the surface loads, Then the tracker title and description are visible", async () => {
		setupSessionMocks({
			session: makeSession({
				source: "tracker",
				taskId: 77,
				taskKey: "CAM-42",
			}),
		});
		mockGetWorkItem.mockResolvedValue({
			id: 77,
			key: "CAM-42",
			title: "Tracker item title",
			description: "Tracker item description",
			source: "tracker",
		});

		render(<FocusPage />);

		await waitFor(() => {
			expect(mockGetWorkItem).toHaveBeenCalledWith(WORKSPACE_ID, "CAM-42");
		});
		expect(mockGetCard).not.toHaveBeenCalled();
		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
			"Tracker item title",
		);
		expect(screen.getByText("Tracker item description")).toBeTruthy();
	});

	it("Given a tracker session with null taskKey, When the surface loads, Then a calm task-load error is shown", async () => {
		setupSessionMocks({
			session: makeSession({
				source: "tracker",
				taskId: 77,
				taskKey: null,
			}),
		});

		render(<FocusPage />);

		await waitFor(() => {
			expect(
				screen.getByText(
					"Couldn't load this task. Check your connection and try again.",
				),
			).toBeTruthy();
		});
		expect(mockGetWorkItem).not.toHaveBeenCalled();
		expect(mockGetCard).not.toHaveBeenCalled();
	});

	it("Given a board task request rejects, When the surface renders, Then a calm error and route back are available", async () => {
		mockGetCard.mockRejectedValue(new Error("network"));

		render(<FocusPage />);

		await waitFor(() => {
			expect(
				screen.getByText(
					"Couldn't load this task. Check your connection and try again.",
				),
			).toBeTruthy();
		});
		fireEvent.click(screen.getByRole("button", { name: "Back to board" }));
		expect(mockNavigate).toHaveBeenCalledWith("/board");
	});

	it("Given a tracker task request rejects, When the surface renders, Then a calm error and route back are available", async () => {
		setupSessionMocks({
			session: makeSession({
				source: "tracker",
				taskId: 77,
				taskKey: "CAM-42",
			}),
		});
		mockGetWorkItem.mockRejectedValue(new Error("network"));

		render(<FocusPage />);

		await waitFor(() => {
			expect(
				screen.getByText(
					"Couldn't load this task. Check your connection and try again.",
				),
			).toBeTruthy();
		});
		fireEvent.click(screen.getByRole("button", { name: "Back to board" }));
		expect(mockNavigate).toHaveBeenCalledWith("/board");
	});

	it("Given a fully populated task, When the page renders, Then only title description and timer controls are present", async () => {
		mockGetCard.mockResolvedValue(makePopulatedCard());

		render(<FocusPage />);

		await waitFor(() => {
			expect(screen.getByText("Focus task title")).toBeTruthy();
		});
		expect(screen.getByText("Focus task description")).toBeTruthy();
		expect(screen.getByTestId("focus-duration")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();

		expect(screen.queryByText("Backlog")).toBeNull();
		expect(screen.queryByText("High")).toBeNull();
		expect(screen.queryByText("Bug")).toBeNull();
		expect(screen.queryByText("Bob")).toBeNull();
		expect(screen.queryByText("2026-12-01")).toBeNull();
		expect(screen.queryByText(/activity/i)).toBeNull();
		expect(screen.queryByText(/changelog/i)).toBeNull();
	});

	it("Given a board-sourced page showing task T with title Old title, When card.updated arrives, Then card.updated refreshes title", async () => {
		mockGetCard
			.mockResolvedValueOnce({
				id: 481,
				title: "Old title",
				description: "Card description",
			})
			.mockResolvedValueOnce({
				id: 481,
				title: "New title",
				description: "Card description",
			});

		render(<FocusPage />);

		await waitFor(() => {
			expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
				"Old title",
			);
		});

		const timerBefore = screen.getByTestId("focus-duration");

		await act(async () => {
			for (const handler of cardEventHandlers) {
				handler({
					type: "card.updated",
					actor: { id: 1, username: "alice", displayName: "Alice" },
					cardId: 481,
					payload: { key: "CAM-42" },
				});
			}
		});

		await waitFor(() => {
			expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
				"New title",
			);
		});
		expect(mockNavigate).not.toHaveBeenCalled();
		expect(screen.getByTestId("focus-duration")).toBe(timerBefore);
	});

	it("Given a tracker-sourced page showing task T with title Old title, When tracker.updated arrives, Then tracker.updated refreshes title", async () => {
		setupSessionMocks({
			session: makeSession({
				source: "tracker",
				taskId: 77,
				taskKey: "CAM-42",
			}),
		});
		mockGetWorkItem
			.mockResolvedValueOnce({
				id: 77,
				key: "CAM-42",
				title: "Old title",
				description: "Tracker description",
				source: "tracker",
			})
			.mockResolvedValueOnce({
				id: 77,
				key: "CAM-42",
				title: "New title",
				description: "Tracker description",
				source: "tracker",
			});

		render(<FocusPage />);

		await waitFor(() => {
			expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
				"Old title",
			);
		});

		const timerBefore = screen.getByTestId("focus-duration");

		await act(async () => {
			for (const handler of trackerEventHandlers) {
				handler({
					type: "tracker.updated",
					trackerItemId: 77,
				});
			}
		});

		await waitFor(() => {
			expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
				"New title",
			);
		});
		expect(mockNavigate).not.toHaveBeenCalled();
		expect(screen.getByTestId("focus-duration")).toBe(timerBefore);
	});

	it("Given Ready, When Start fails 5xx, Then the page surfaces a retryable error without inventing timer state", async () => {
		setupSessionMocks({
			session: makeSession({ state: "ready" }),
			actionError:
				"Couldn't save your changes. Check your connection and try again.",
		});

		render(<FocusPage />);

		await waitFor(() => {
			expect(screen.getByText("Old title")).toBeTruthy();
		});
		expect(
			screen.getByText(
				"Couldn't save your changes. Check your connection and try again.",
			),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
	});

	it("Given returnPath /board/card/481, When Finish resolves, Then the user returns to that exact surface", async () => {
		const finish = vi.fn().mockResolvedValue(
			makeSession({
				state: "finished",
				returnPath: "/board/card/481",
			}),
		);
		setupSessionMocks({
			session: makeSession({ state: "running", returnPath: "/board/card/481" }),
			finish,
		});

		render(<FocusPage />);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Finish focus" })).toBeTruthy();
		});

		fireEvent.click(screen.getByRole("button", { name: "Finish focus" }));

		await waitFor(() => {
			expect(finish).toHaveBeenCalled();
			expect(mockNavigate).toHaveBeenCalledWith("/board/card/481");
		});
		expect(mockNavigate).not.toHaveBeenCalledWith("/board", { replace: true });
	});

	it("Given an empty return path, When Finish resolves, Then /board is the fallback", async () => {
		const finish = vi.fn().mockResolvedValue(
			makeSession({
				state: "finished",
				returnPath: "",
			}),
		);
		setupSessionMocks({
			session: makeSession({ state: "running", returnPath: "" }),
			finish,
		});

		render(<FocusPage />);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Finish focus" })).toBeTruthy();
		});

		fireEvent.click(screen.getByRole("button", { name: "Finish focus" }));

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith("/board");
		});
	});

	it("Given Finish fails, When the session is later cleared, Then failed.finish does not suppress redirect", async () => {
		const finish = vi.fn().mockRejectedValue(new Error("Finish failed"));
		mockUseFocusSession.mockReturnValue({
			session: makeSession({ state: "running" }),
			loading: false,
			actionError: null,
			start: vi.fn(),
			pause: vi.fn(),
			resume: vi.fn(),
			finish,
			focus: vi.fn(),
			switchTo: vi.fn(),
		});

		const { rerender } = render(<FocusPage />);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Finish focus" })).toBeTruthy();
		});

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Finish focus" }));
		});

		await waitFor(() => {
			expect(finish).toHaveBeenCalled();
		});
		expect(mockNavigate).not.toHaveBeenCalled();

		mockUseFocusSession.mockReturnValue({
			session: null,
			loading: false,
			actionError: null,
			start: vi.fn(),
			pause: vi.fn(),
			resume: vi.fn(),
			finish,
			focus: vi.fn(),
			switchTo: vi.fn(),
		});

		rerender(<FocusPage />);

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith("/board", { replace: true });
		});
	});
});
