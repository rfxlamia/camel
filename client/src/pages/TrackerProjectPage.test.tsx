// @vitest-environment jsdom
// client/src/pages/TrackerProjectPage.test.tsx
import {
	act,
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
	mockUpdateTrackerProject,
	mockDeleteTrackerProject,
	mockCreateTrackerPhase,
	mockUpdateTrackerPhase,
	mockDeleteTrackerPhase,
	mockReorderTrackerItem,
	mockNavigate,
	mockUseParams,
	mockUseBoard,
	mockShowToast,
} = vi.hoisted(() => ({
	mockListTrackerProjects: vi.fn(),
	mockListTrackerItems: vi.fn(),
	mockUpdateTrackerProject: vi.fn(),
	mockDeleteTrackerProject: vi.fn(),
	mockCreateTrackerPhase: vi.fn(),
	mockUpdateTrackerPhase: vi.fn(),
	mockDeleteTrackerPhase: vi.fn(),
	mockReorderTrackerItem: vi.fn(),
	mockNavigate: vi.fn(),
	mockUseParams: vi.fn(),
	mockUseBoard: vi.fn(),
	mockShowToast: vi.fn(),
}));

vi.mock("../api", () => ({
	api: {
		listTrackerProjects: (...a: unknown[]) => mockListTrackerProjects(...a),
		listTrackerItems: (...a: unknown[]) => mockListTrackerItems(...a),
		updateTrackerProject: (...a: unknown[]) => mockUpdateTrackerProject(...a),
		deleteTrackerProject: (...a: unknown[]) => mockDeleteTrackerProject(...a),
		createTrackerPhase: (...a: unknown[]) => mockCreateTrackerPhase(...a),
		updateTrackerPhase: (...a: unknown[]) => mockUpdateTrackerPhase(...a),
		deleteTrackerPhase: (...a: unknown[]) => mockDeleteTrackerPhase(...a),
		reorderTrackerItem: (...a: unknown[]) => mockReorderTrackerItem(...a),
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

import { ApiError } from "../api";
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

describe("TrackerProjectPage project and phase management", () => {
	it("renames the project with the current version and updates the header", async () => {
		mockUpdateTrackerProject.mockResolvedValue({
			...project,
			name: "Rilis v2.1",
			version: 2,
		});
		render(<TrackerProjectPage />);
		await waitFor(() => screen.getByText("Rilis v2"));
		fireEvent.click(screen.getByRole("button", { name: /rename project/i }));
		fireEvent.change(screen.getByLabelText(/project name/i), {
			target: { value: "Rilis v2.1" },
		});
		fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
		await waitFor(() =>
			expect(mockUpdateTrackerProject).toHaveBeenCalledWith(7, 1, {
				name: "Rilis v2.1",
				version: 1,
			}),
		);
		expect(await screen.findByText("Rilis v2.1")).toBeTruthy();
	});

	it("shows the card-mirror conflict UX when a project rename is stale", async () => {
		mockUpdateTrackerProject.mockRejectedValueOnce(
			new ApiError("conflict", 409, "version_conflict"),
		);
		render(<TrackerProjectPage />);
		await waitFor(() => screen.getByText("Rilis v2"));
		fireEvent.click(screen.getByRole("button", { name: /rename project/i }));
		fireEvent.change(screen.getByLabelText(/project name/i), {
			target: { value: "Rilis v2.1" },
		});
		fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
		await waitFor(() =>
			expect(mockShowToast).toHaveBeenCalledWith(
				expect.stringMatching(/someone else updated this project/i),
				"warning",
			),
		);
		expect(mockListTrackerProjects).toHaveBeenCalledTimes(2);
	});

	it("states the released task count in the delete confirmation", async () => {
		mockListTrackerItems.mockResolvedValueOnce(
			Array.from({ length: 18 }, (_, i) =>
				projectItem({ id: i + 1, key: `CA-${i + 1}`, phaseId: 9 }),
			),
		);
		render(<TrackerProjectPage />);
		await waitFor(() => screen.getByText("Rilis v2"));
		fireEvent.click(screen.getByRole("button", { name: /project menu/i }));
		fireEvent.click(screen.getByRole("menuitem", { name: /delete project/i }));
		expect(
			await screen.findByText(/18 tasks will be released to the unassigned list/i),
		).toBeTruthy();
	});

	it("deletes the project on confirmation and returns to /tracker", async () => {
		mockDeleteTrackerProject.mockResolvedValue(undefined);
		render(<TrackerProjectPage />);
		await waitFor(() => screen.getByText("Rilis v2"));
		fireEvent.click(screen.getByRole("button", { name: /project menu/i }));
		fireEvent.click(screen.getByRole("menuitem", { name: /delete project/i }));
		await screen.findByText(/will be released to the unassigned list/i);
		fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
		await waitFor(() => expect(mockDeleteTrackerProject).toHaveBeenCalledWith(7, 1));
		expect(mockNavigate).toHaveBeenCalledWith("/tracker");
	});

	it("creates the first phase from the empty project's CTA", async () => {
		mockListTrackerProjects.mockResolvedValueOnce([
			{ ...project, id: 5, name: "Rilis v3", phases: [] },
		]);
		mockListTrackerItems.mockResolvedValueOnce([]);
		mockUseParams.mockReturnValue({ projectId: "5" });
		mockCreateTrackerPhase.mockResolvedValue(persiapan);
		render(<TrackerProjectPage />);
		fireEvent.click(await screen.findByRole("button", { name: /create.*phase/i }));
		fireEvent.change(screen.getByLabelText(/phase name/i), {
			target: { value: "Persiapan" },
		});
		fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
		await waitFor(() =>
			expect(mockCreateTrackerPhase).toHaveBeenCalledWith(7, 5, {
				name: "Persiapan",
			}),
		);
	});

	it("appends a new phase after the existing last phase", async () => {
		mockCreateTrackerPhase.mockResolvedValue({
			...pengembangan,
			id: 11,
			name: "Peluncuran",
			position: 3072,
		});
		render(<TrackerProjectPage />);
		await waitFor(() => screen.getByText("Pengembangan"));
		fireEvent.click(screen.getByRole("button", { name: /add phase/i }));
		fireEvent.change(screen.getByLabelText(/phase name/i), {
			target: { value: "Peluncuran" },
		});
		fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
		await waitFor(() => expect(mockCreateTrackerPhase).toHaveBeenCalled());
		const order = screen
			.getAllByTestId(/^phase-/)
			.map((section) => section.dataset.testid);
		expect(order).toEqual(["phase-Persiapan", "phase-Pengembangan", "phase-Peluncuran"]);
	});

	it("renames a phase and shows the same 409 conflict UX on a stale version", async () => {
		mockUpdateTrackerPhase.mockResolvedValueOnce({
			...persiapan,
			name: "Persiapan awal",
			version: 2,
		});
		render(<TrackerProjectPage />);
		await waitFor(() => screen.getByText("Persiapan"));
		fireEvent.click(screen.getByRole("button", { name: /rename phase persiapan/i }));
		fireEvent.change(screen.getByLabelText(/phase name/i), {
			target: { value: "Persiapan awal" },
		});
		fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
		await waitFor(() =>
			expect(mockUpdateTrackerPhase).toHaveBeenCalledWith(7, 9, {
				name: "Persiapan awal",
				version: 1,
			}),
		);
		expect(await screen.findByText("Persiapan awal")).toBeTruthy();

		mockUpdateTrackerPhase.mockRejectedValueOnce(
			new ApiError("conflict", 409, "version_conflict"),
		);
		fireEvent.click(screen.getByRole("button", { name: /rename phase persiapan awal/i }));
		fireEvent.change(screen.getByLabelText(/phase name/i), {
			target: { value: "Persiapan lagi" },
		});
		fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
		await waitFor(() =>
			expect(mockShowToast).toHaveBeenCalledWith(
				expect.stringMatching(/someone else updated this phase/i),
				"warning",
			),
		);
	});

	it('deletes a phase on confirmation and moves its tasks into "No phase" without a manual refresh', async () => {
		mockDeleteTrackerPhase.mockResolvedValue(undefined);
		render(<TrackerProjectPage />);
		await waitFor(() => screen.getByText("Persiapan"));

		mockListTrackerProjects.mockResolvedValueOnce([
			{ ...project, phases: [pengembangan] },
		]);
		mockListTrackerItems.mockResolvedValueOnce([
			projectItem({ id: 1, key: "CA-1", phaseId: null }),
			projectItem({ id: 2, key: "CA-2", phaseId: null }),
		]);
		fireEvent.click(screen.getByRole("button", { name: /delete phase persiapan/i }));
		fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
		await waitFor(() => expect(mockDeleteTrackerPhase).toHaveBeenCalledWith(7, 9));
		await waitFor(() => expect(screen.getByText("No phase")).toBeTruthy());
		expect(screen.getByTestId("tracker-row-CA-1")).toBeTruthy();
	});

	it("sets explicit phase dates and surfaces the server's 400 for an inverted range inline", async () => {
		render(<TrackerProjectPage />);
		await waitFor(() => screen.getByText("Persiapan"));
		fireEvent.click(screen.getByRole("button", { name: /rename phase persiapan/i }));
		fireEvent.change(screen.getByLabelText(/start date/i), {
			target: { value: "2026-09-01" },
		});
		fireEvent.change(screen.getByLabelText(/end date/i), {
			target: { value: "2026-09-20" },
		});
		fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
		await waitFor(() =>
			expect(mockUpdateTrackerPhase).toHaveBeenCalledWith(7, 9, {
				name: "Persiapan",
				startDate: "2026-09-01",
				endDate: "2026-09-20",
				version: 1,
			}),
		);

		mockUpdateTrackerPhase.mockRejectedValueOnce(
			new ApiError("End date must be on or after the start date.", 400),
		);
		fireEvent.click(screen.getByRole("button", { name: /rename phase persiapan/i }));
		fireEvent.change(screen.getByLabelText(/start date/i), {
			target: { value: "2026-09-30" },
		});
		fireEvent.change(screen.getByLabelText(/end date/i), {
			target: { value: "2026-09-01" },
		});
		fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
		expect(
			await screen.findByText("End date must be on or after the start date."),
		).toBeTruthy();
	});
});

async function pressReorder(
	handleName: RegExp,
	direction: "ArrowDown" | "ArrowUp",
) {
	const handle = screen.getByRole("button", { name: handleName });
	act(() => {
		handle.focus();
		fireEvent.keyDown(handle, { key: " ", code: "Space" });
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	act(() => {
		fireEvent.keyDown(document, { key: direction, code: direction });
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	act(() => {
		fireEvent.keyDown(document, { key: " ", code: "Space" });
	});
}

describe("TrackerProjectPage drag reorder", () => {
	beforeEach(() => {
		mockListTrackerItems.mockResolvedValue([
			projectItem({ id: 1, key: "CA-1", phaseId: 9, position: 1024 }),
			projectItem({ id: 2, key: "CA-2", phaseId: 9, position: 2048 }),
			projectItem({ id: 3, key: "CB-1", phaseId: 10, position: 1024 }),
			projectItem({ id: 4, key: "CB-2", phaseId: 10, position: 2048 }),
		]);
		vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
			function (this: Element) {
				const rows = Array.from(
					document.querySelectorAll("[data-sortable-key]"),
				);
				const row =
					this instanceof Element && this.hasAttribute("data-sortable-key")
						? this
						: this.closest("[data-sortable-key]");
				const index =
					row instanceof Element
						? rows.findIndex((candidate) => candidate === row)
						: -1;
				const height = 36;
				const top = index >= 0 ? index * height : 0;
				return {
					width: 400,
					height,
					top,
					left: 0,
					bottom: top + height,
					right: 400,
					x: 0,
					y: top,
					toJSON: () => ({}),
				} as DOMRect;
			},
		);
	});

	it("calls reorderTrackerItem with the drop target when a task moves within its phase", async () => {
		mockReorderTrackerItem.mockResolvedValue(
			projectItem({ id: 1, key: "CA-1", phaseId: 9, position: 3072 }),
		);
		render(<TrackerProjectPage />);
		await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
		await pressReorder(/reorder ca-1/i, "ArrowDown");
		await waitFor(() =>
			expect(mockReorderTrackerItem).toHaveBeenCalledWith(
				7,
				"CA-1",
				expect.any(Object),
			),
		);
	});

	it("shows the new order optimistically before the request resolves", async () => {
		let resolveReorder: (value: TrackerItem) => void = () => {};
		mockReorderTrackerItem.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveReorder = resolve;
				}),
		);
		render(<TrackerProjectPage />);
		await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
		await pressReorder(/reorder ca-1/i, "ArrowDown");
		await waitFor(() => expect(mockReorderTrackerItem).toHaveBeenCalled());
		const order = screen
			.getAllByTestId(/^tracker-row-CA-/)
			.map((row) => row.dataset.testid);
		expect(order).toEqual(["tracker-row-CA-2", "tracker-row-CA-1"]);
		resolveReorder(projectItem({ id: 1, key: "CA-1", phaseId: 9 }));
	});

	it("restores the previous order and shows an error toast when the reorder fails", async () => {
		mockReorderTrackerItem.mockRejectedValue(new Error("network down"));
		render(<TrackerProjectPage />);
		await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
		await pressReorder(/reorder ca-1/i, "ArrowDown");
		await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
		expect(mockShowToast.mock.calls[0]?.[1]).toBe("error");
		const order = screen
			.getAllByTestId(/^tracker-row-CA-/)
			.map((row) => row.dataset.testid);
		expect(order).toEqual(["tracker-row-CA-1", "tracker-row-CA-2"]);
	});

	it("never lets a drag inside one phase touch another phase's order or items", async () => {
		render(<TrackerProjectPage />);
		await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
		const phaseBBefore = screen
			.getAllByTestId(/^tracker-row-CB-/)
			.map((row) => row.dataset.testid);

		await pressReorder(/reorder ca-1/i, "ArrowDown");
		await waitFor(() => expect(mockReorderTrackerItem).toHaveBeenCalled());

		expect(mockReorderTrackerItem).toHaveBeenCalledTimes(1);
		expect(mockReorderTrackerItem.mock.calls[0]?.[1]).toBe("CA-1");
		const phaseBAfter = screen
			.getAllByTestId(/^tracker-row-CB-/)
			.map((row) => row.dataset.testid);
		expect(phaseBAfter).toEqual(phaseBBefore);
	});
});
