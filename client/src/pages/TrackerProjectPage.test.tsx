// @vitest-environment jsdom
// client/src/pages/TrackerProjectPage.test.tsx
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackerItem, TrackerPhase, TrackerProject } from "../types";

const {
	mockListTrackerProjects,
	mockListTrackerItems,
	mockNavigate,
	mockUseParams,
	mockUseBoard,
	mockShowToast,
} = vi.hoisted(() => ({
	mockListTrackerProjects: vi.fn(),
	mockListTrackerItems: vi.fn(),
	mockNavigate: vi.fn(),
	mockUseParams: vi.fn(),
	mockUseBoard: vi.fn(),
	mockShowToast: vi.fn(),
}));

vi.mock("../api", () => ({
	api: {
		listTrackerProjects: (...a: unknown[]) => mockListTrackerProjects(...a),
		listTrackerItems: (...a: unknown[]) => mockListTrackerItems(...a),
	},
	ApiError: class ApiError extends Error {
		status: number;
		code?: string;
		constructor(message: string, status: number, code?: string) {
			super(message);
			this.status = status;
			this.code = code;
		}
	},
}));

vi.mock("../context/BoardContext", () => ({
	useBoard: () => mockUseBoard(),
}));

vi.mock("react-router", () => ({
	useNavigate: () => mockNavigate,
	useParams: () => mockUseParams(),
}));

import TrackerProjectPage from "./TrackerProjectPage";

const persiapan: TrackerPhase = {
	id: 9,
	projectId: 1,
	name: "Persiapan",
	subtitle: "",
	startDate: null,
	endDate: null,
	position: 1024,
	version: 1,
	createdAt: "2026-08-01T00:00:00Z",
	updatedAt: "2026-08-01T00:00:00Z",
};

const pengembangan: TrackerPhase = {
	id: 10,
	projectId: 1,
	name: "Pengembangan",
	subtitle: "",
	startDate: null,
	endDate: null,
	position: 2048,
	version: 1,
	createdAt: "2026-08-01T00:00:00Z",
	updatedAt: "2026-08-01T00:00:00Z",
};

const project: TrackerProject = {
	id: 1,
	name: "Rilis v2",
	startDate: null,
	endDate: null,
	position: 1024,
	version: 1,
	phases: [persiapan, pengembangan],
	createdAt: "2026-08-01T00:00:00Z",
	updatedAt: "2026-08-01T00:00:00Z",
};

const backlog = {
	id: 1,
	kind: "status" as const,
	name: "Backlog",
	position: 1000,
	colour: "oklch(0.7 0.1 200)",
	category: "backlog" as const,
};
const inProgress = {
	id: 2,
	kind: "status" as const,
	name: "In Progress",
	position: 2000,
	colour: "oklch(0.7 0.1 90)",
	category: "started" as const,
};
const done = {
	id: 3,
	kind: "status" as const,
	name: "Done",
	position: 3000,
	colour: "oklch(0.7 0.1 140)",
	category: "completed" as const,
};

function projectItem(
	overrides: Partial<TrackerItem> & { id: number },
): TrackerItem {
	return {
		key: `CA-${overrides.id}`,
		title: "Task",
		description: "",
		status: backlog,
		priority: null,
		labels: [],
		assignees: [],
		version: 1,
		createdAt: "2026-08-01T00:00:00Z",
		updatedAt: "2026-08-01T00:00:00Z",
		projectId: 1,
		phaseId: 9,
		startDate: null,
		endDate: null,
		completedAt: null,
		position: 1024,
		...overrides,
	};
}

beforeEach(() => {
	mockUseParams.mockReturnValue({ projectId: "1" });
	mockListTrackerProjects.mockResolvedValue([project]);
	mockListTrackerItems.mockResolvedValue([
		projectItem({ id: 1, key: "CA-1", phaseId: 9, status: done }),
		projectItem({ id: 2, key: "CA-2", phaseId: 9, status: inProgress }),
	]);
	mockUseBoard.mockReturnValue({
		activeWorkspaceId: 7,
		subscribeTrackerEvents: vi.fn(() => () => {}),
		showToast: mockShowToast,
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	window.sessionStorage.clear();
});

describe("TrackerProjectPage", () => {
	it("renders phases with a rollup percentage and a derived date range", async () => {
		mockListTrackerItems.mockResolvedValueOnce([
			projectItem({
				id: 1,
				key: "CA-1",
				phaseId: 9,
				status: done,
				startDate: "2026-09-05",
				endDate: "2026-09-15",
			}),
			projectItem({
				id: 2,
				key: "CA-2",
				phaseId: 9,
				status: inProgress,
				startDate: "2026-09-10",
				endDate: "2026-09-25",
			}),
		]);
		render(<TrackerProjectPage />);
		await waitFor(() => screen.getByText("Persiapan"));
		expect(screen.getByText("50%")).toBeTruthy();
		expect(screen.getByText(/Sep 5.*Sep 25/)).toBeTruthy();
	});

	it('shows a "No phase" section when phase-less tasks exist for this project', async () => {
		mockListTrackerItems.mockResolvedValueOnce([
			projectItem({ id: 1, key: "CA-1", phaseId: null }),
		]);
		render(<TrackerProjectPage />);
		await waitFor(() => screen.getByText("No phase"));
		expect(screen.getByTestId("tracker-row-CA-1")).toBeTruthy();
	});

	it('omits the "No phase" section when every task has a phase', async () => {
		render(<TrackerProjectPage />);
		await waitFor(() => screen.getByText("Persiapan"));
		expect(screen.queryByText("No phase")).toBeNull();
	});

	it("shows a CTA empty state for a project with zero phases and zero tasks", async () => {
		mockListTrackerProjects.mockResolvedValueOnce([
			{ ...project, id: 5, name: "Rilis v3", phases: [] },
		]);
		mockListTrackerItems.mockResolvedValueOnce([]);
		mockUseParams.mockReturnValue({ projectId: "5" });
		render(<TrackerProjectPage />);
		expect(
			await screen.findByRole("button", { name: /create.*phase/i }),
		).toBeTruthy();
	});

	it("renders the 404 state for an unknown project id", async () => {
		mockUseParams.mockReturnValue({ projectId: "999" });
		render(<TrackerProjectPage />);
		expect(await screen.findByText(/not found/i)).toBeTruthy();
		expect(screen.queryByText("Persiapan")).toBeNull();
	});

	it("renders the 404 state for a project id belonging to another workspace", async () => {
		mockUseParams.mockReturnValue({ projectId: "42" });
		render(<TrackerProjectPage />);
		expect(await screen.findByText(/not found/i)).toBeTruthy();
	});

	it("persists a collapsed phase across a fresh mount within the same session", async () => {
		const { unmount } = render(<TrackerProjectPage />);
		await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
		fireEvent.click(screen.getByTestId("toggle-phase-Persiapan"));
		expect(screen.queryByTestId("tracker-row-CA-1")).toBeNull();
		unmount();

		render(<TrackerProjectPage />);
		await waitFor(() => screen.getByText("Persiapan"));
		expect(screen.queryByTestId("tracker-row-CA-1")).toBeNull();
	});

	it("keeps a collapsed phase collapsed through an SSE-triggered reload", async () => {
		let sseHandler: ((e: { type: string }) => void) | undefined;
		mockUseBoard.mockReturnValue({
			activeWorkspaceId: 7,
			subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
				sseHandler = cb;
				return () => {};
			},
			showToast: mockShowToast,
		});
		render(<TrackerProjectPage />);
		await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
		fireEvent.click(screen.getByTestId("toggle-phase-Persiapan"));
		expect(screen.queryByTestId("tracker-row-CA-1")).toBeNull();

		sseHandler?.({ type: "tracker.updated" });
		await waitFor(() => expect(mockListTrackerItems).toHaveBeenCalledTimes(2));
		expect(screen.queryByTestId("tracker-row-CA-1")).toBeNull();
	});

	it("shows the 404 state when tracker.project.deleted fires for the open project", async () => {
		let sseHandler: ((e: { type: string }) => void) | undefined;
		mockUseBoard.mockReturnValue({
			activeWorkspaceId: 7,
			subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
				sseHandler = cb;
				return () => {};
			},
			showToast: mockShowToast,
		});
		render(<TrackerProjectPage />);
		await waitFor(() => screen.getByText("Persiapan"));

		mockListTrackerProjects.mockResolvedValueOnce([]);
		sseHandler?.({ type: "tracker.project.deleted" });
		await waitFor(() => expect(screen.getByText(/not found/i)).toBeTruthy());
	});

	it("reloads on every project/phase event plus the three item events (eight of the nine)", async () => {
		let sseHandler: ((e: { type: string }) => void) | undefined;
		mockUseBoard.mockReturnValue({
			activeWorkspaceId: 7,
			subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
				sseHandler = cb;
				return () => {};
			},
			showToast: mockShowToast,
		});
		render(<TrackerProjectPage />);
		await waitFor(() => screen.getByText("Persiapan"));

		const eventTypes = [
			"tracker.project.created",
			"tracker.project.updated",
			"tracker.phase.created",
			"tracker.phase.updated",
			"tracker.phase.deleted",
			"tracker.created",
			"tracker.updated",
			"tracker.deleted",
		];
		for (const type of eventTypes) {
			mockListTrackerItems.mockClear();
			sseHandler?.({ type });
			await waitFor(() => expect(mockListTrackerItems).toHaveBeenCalled());
		}
	});

	it("refreshes the phase and project percentages after a tracker.updated event", async () => {
		let sseHandler: ((e: { type: string }) => void) | undefined;
		mockUseBoard.mockReturnValue({
			activeWorkspaceId: 7,
			subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
				sseHandler = cb;
				return () => {};
			},
			showToast: mockShowToast,
		});
		render(<TrackerProjectPage />);
		await waitFor(() => screen.getByText("50%"));

		mockListTrackerItems.mockResolvedValueOnce([
			projectItem({ id: 1, key: "CA-1", phaseId: 9, status: done }),
			projectItem({ id: 2, key: "CA-2", phaseId: 9, status: done }),
		]);
		sseHandler?.({ type: "tracker.updated" });
		await waitFor(() => expect(screen.getByText("100%")).toBeTruthy());
	});

	it("shows a new row from a tracker.created event without a manual refresh", async () => {
		let sseHandler: ((e: { type: string }) => void) | undefined;
		mockUseBoard.mockReturnValue({
			activeWorkspaceId: 7,
			subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
				sseHandler = cb;
				return () => {};
			},
			showToast: mockShowToast,
		});
		render(<TrackerProjectPage />);
		await waitFor(() => screen.getByTestId("tracker-row-CA-1"));

		mockListTrackerItems.mockResolvedValueOnce([
			projectItem({ id: 1, key: "CA-1", phaseId: 9, status: done }),
			projectItem({ id: 2, key: "CA-2", phaseId: 9, status: inProgress }),
			projectItem({ id: 3, key: "CA-3", phaseId: 9, title: "New task" }),
		]);
		sseHandler?.({ type: "tracker.created" });
		await waitFor(() =>
			expect(screen.getByTestId("tracker-row-CA-3")).toBeTruthy(),
		);
	});

	it("removes the row and updates the percentages on a tracker.deleted event", async () => {
		let sseHandler: ((e: { type: string }) => void) | undefined;
		mockUseBoard.mockReturnValue({
			activeWorkspaceId: 7,
			subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
				sseHandler = cb;
				return () => {};
			},
			showToast: mockShowToast,
		});
		render(<TrackerProjectPage />);
		await waitFor(() => screen.getByText("50%"));

		mockListTrackerItems.mockResolvedValueOnce([
			projectItem({ id: 1, key: "CA-1", phaseId: 9, status: done }),
		]);
		sseHandler?.({ type: "tracker.deleted" });
		await waitFor(() =>
			expect(screen.queryByTestId("tracker-row-CA-2")).toBeNull(),
		);
		expect(screen.getByText("100%")).toBeTruthy();
	});

	it('moves a deleted phase\'s tasks into "No phase" on tracker.phase.deleted', async () => {
		let sseHandler: ((e: { type: string }) => void) | undefined;
		mockUseBoard.mockReturnValue({
			activeWorkspaceId: 7,
			subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
				sseHandler = cb;
				return () => {};
			},
			showToast: mockShowToast,
		});
		render(<TrackerProjectPage />);
		await waitFor(() => screen.getByText("Persiapan"));

		mockListTrackerProjects.mockResolvedValueOnce([
			{ ...project, phases: [pengembangan] },
		]);
		mockListTrackerItems.mockResolvedValueOnce([
			projectItem({ id: 1, key: "CA-1", phaseId: null, status: done }),
			projectItem({ id: 2, key: "CA-2", phaseId: null, status: inProgress }),
		]);
		sseHandler?.({ type: "tracker.phase.deleted" });
		await waitFor(() => expect(screen.queryByText("Persiapan")).toBeNull());
		expect(screen.getByText("No phase")).toBeTruthy();
		expect(screen.getByTestId("tracker-row-CA-1")).toBeTruthy();
	});

	it("carries the overdue marker on a near-complete phase with one live task past its end date", async () => {
		vi.setSystemTime(new Date("2026-10-05T12:00:00"));
		mockListTrackerItems.mockResolvedValueOnce([
			projectItem({ id: 1, key: "CA-1", phaseId: 9, status: done }),
			projectItem({ id: 2, key: "CA-2", phaseId: 9, status: done }),
			projectItem({
				id: 3,
				key: "CA-3",
				phaseId: 9,
				status: inProgress,
				endDate: "2026-09-20",
			}),
		]);
		render(<TrackerProjectPage />);
		await waitFor(() => screen.getByText("Persiapan"));
		expect(screen.getByLabelText(/overdue/i)).toBeTruthy();
		vi.useRealTimers();
	});
});
