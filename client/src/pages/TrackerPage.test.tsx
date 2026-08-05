// @vitest-environment jsdom
// client/src/pages/TrackerPage.test.tsx
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackerItem, TrackerVocabulary } from "../types";

const {
	mockListTrackerItems,
	mockCreateTrackerItem,
	mockListTrackerProjects,
	mockCreateTrackerProject,
	mockListTrackerVocabularies,
	mockGetWorkspaceMembers,
	mockUpdateTrackerItem,
	mockShowToast,
	mockUseBoard,
	mockNavigate,
	mockLocation,
} = vi.hoisted(() => ({
	mockListTrackerItems: vi.fn(),
	mockCreateTrackerItem: vi.fn(),
	mockListTrackerProjects: vi.fn(),
	mockCreateTrackerProject: vi.fn(),
	mockUpdateTrackerItem: vi.fn(),
	mockShowToast: vi.fn(),
	mockListTrackerVocabularies: vi.fn(),
	mockGetWorkspaceMembers: vi.fn(),
	mockUseBoard: vi.fn(),
	mockNavigate: vi.fn(),
	mockLocation: { pathname: "/tracker", key: "tracker-1" },
}));

vi.mock("../api", () => ({
	api: {
		listTrackerItems: (...a: unknown[]) => mockListTrackerItems(...a),
		createTrackerItem: (...a: unknown[]) => mockCreateTrackerItem(...a),
		listTrackerProjects: (...a: unknown[]) => mockListTrackerProjects(...a),
		createTrackerProject: (...a: unknown[]) => mockCreateTrackerProject(...a),
		updateTrackerItem: (...a: unknown[]) => mockUpdateTrackerItem(...a),
		listTrackerVocabularies: (...a: unknown[]) =>
			mockListTrackerVocabularies(...a),
		getWorkspaceMembers: (...a: unknown[]) => mockGetWorkspaceMembers(...a),
	},
	ApiError: class ApiError extends Error {
		status: number;
		constructor(message: string, status: number) {
			super(message);
			this.status = status;
		}
	},
}));

vi.mock("../context/BoardContext", () => ({
	useBoard: () => mockUseBoard(),
}));

vi.mock("react-router", () => ({
	useNavigate: () => mockNavigate,
	useLocation: () => mockLocation,
}));

import { ApiError } from "../api";
import TrackerPage from "./TrackerPage";
import { KANBAN_NAV } from "../layout/sidebar/navItems";
import type { TrackerPhase, TrackerProject } from "../types";

const statuses: TrackerVocabulary[] = [
	{
		id: 1,
		kind: "status",
		name: "Backlog",
		position: 1000,
		colour: "oklch(0.7 0.1 200)",
		category: "backlog",
	},
	{
		id: 2,
		kind: "status",
		name: "In Progress",
		position: 3000,
		colour: "oklch(0.7 0.1 150)",
		category: "started",
	},
	{
		id: 5,
		kind: "status",
		name: "Done",
		position: 5000,
		colour: "oklch(0.7 0.1 140)",
		category: "completed",
	},
];

const priorities: TrackerVocabulary[] = [
	{
		id: 10,
		kind: "priority",
		name: "High",
		position: 1000,
		colour: "oklch(0.7 0.1 30)",
	},
];

const labels: TrackerVocabulary[] = [
	{
		id: 3,
		kind: "label",
		name: "Feature",
		position: 1000,
		colour: "oklch(0.7 0.1 260)",
	},
	{
		id: 4,
		kind: "label",
		name: "Bug",
		position: 2000,
		colour: "oklch(0.7 0.1 15)",
	},
];

function makeItem(
	overrides: Partial<TrackerItem> & { id: number },
): TrackerItem {
	return {
		key: "CA-1",
		title: "Workspace Rename",
		description: "",
		status: statuses[0]!,
		priority: null,
		labels: [
			{
				id: 3,
				kind: "label",
				name: "Feature",
				position: 1000,
				colour: "oklch(0.7 0.1 260)",
			},
		],
		assignees: [{ id: 7, displayName: "Alice", username: "alice" }],
		version: 1,
		createdAt: "2026-07-04T00:00:00Z",
		updatedAt: "2026-07-04T00:00:00Z",
		...overrides,
	};
}

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

const releaseProject: TrackerProject = {
	id: 1,
	name: "Rilis v2",
	startDate: null,
	endDate: null,
	position: 1024,
	version: 1,
	phases: [persiapan],
	createdAt: "2026-08-01T00:00:00Z",
	updatedAt: "2026-08-01T00:00:00Z",
};

function inProjectItem(
	overrides: Partial<TrackerItem> & { id: number },
): TrackerItem {
	return makeItem({
		projectId: 1,
		phaseId: 9,
		startDate: null,
		endDate: null,
		completedAt: null,
		position: 1024,
		...overrides,
	});
}

beforeEach(() => {
	mockListTrackerProjects.mockResolvedValue([]);
	mockListTrackerVocabularies.mockImplementation(
		(_wsId: number, kind?: string) => {
			if (kind === "priority") return Promise.resolve(priorities);
			if (kind === "label") return Promise.resolve(labels);
			return Promise.resolve(statuses);
		},
	);
	mockGetWorkspaceMembers.mockResolvedValue({
		members: [
			{
				userId: 7,
				username: "alice",
				displayName: "Alice",
				role: "member",
			},
			{
				userId: 8,
				username: "bob",
				displayName: "Bob",
				role: "member",
			},
		],
	});
	mockListTrackerItems.mockResolvedValue([
		makeItem({ id: 1, key: "CA-1", title: "Workspace Rename" }),
		makeItem({
			id: 2,
			key: "CA-2",
			title: "Done task",
			status: statuses[2]!,
			labels: [],
		}),
	]);
	mockCreateTrackerItem.mockResolvedValue(
		makeItem({ id: 3, key: "CA-3", title: "New" }),
	);
	mockUseBoard.mockReturnValue({
		activeWorkspaceId: 7,
		subscribeTrackerEvents: vi.fn(() => () => {}),
		registerRefreshTrackerList: vi.fn(),
		refreshTrackerList: vi.fn(),
		showToast: mockShowToast,
	});
	mockLocation.key = "tracker-1";
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("TrackerPage", () => {
	it("renders sections ordered by vocab position with row metadata", async () => {
		render(<TrackerPage />);
		await waitFor(() => expect(screen.getByText("Backlog")).toBeTruthy());
		expect(screen.getByText("CA-1")).toBeTruthy();
		expect(screen.getByText("Workspace Rename")).toBeTruthy();
		expect(screen.getByText("Feature")).toBeTruthy();
		expect(screen.getByTestId("tracker-row-CA-1")).toBeTruthy();
	});

	it("hides empty sections when search is active", async () => {
		mockListTrackerItems.mockResolvedValueOnce([
			makeItem({ id: 1, key: "CA-1", title: "Workspace Rename" }),
		]);
		render(<TrackerPage />);
		fireEvent.change(screen.getByPlaceholderText(/search/i), {
			target: { value: "rename" },
		});
		await waitFor(() => expect(screen.queryByText("Done")).toBeNull());
		expect(screen.getByText("Backlog")).toBeTruthy();
	});

	it("matches search against description text", async () => {
		mockListTrackerItems.mockResolvedValueOnce([
			makeItem({
				id: 1,
				key: "CA-9",
				title: "Opaque title",
				description: "hidden billing details",
			}),
		]);
		render(<TrackerPage />);
		fireEvent.change(screen.getByPlaceholderText(/search/i), {
			target: { value: "billing" },
		});
		await waitFor(() => expect(screen.getByText("CA-9")).toBeTruthy());
	});

	it("renders status icon on tracker rows", async () => {
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
		expect(screen.getByLabelText("Backlog, CA-1")).toBeTruthy();
	});

	it("changes status inline from the row glyph without navigating", async () => {
		mockUpdateTrackerItem.mockResolvedValue(
			makeItem({ id: 1, key: "CA-1", status: statuses[1]! }),
		);
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
		fireEvent.click(screen.getByLabelText("Backlog, CA-1"));
		fireEvent.click(screen.getByRole("option", { name: /In Progress/ }));

		await waitFor(() =>
			expect(mockUpdateTrackerItem).toHaveBeenCalledWith(7, "CA-1", {
				statusId: 2,
				version: 1,
			}),
		);
		expect(mockNavigate).not.toHaveBeenCalled();
		// The row now lives under the In Progress section.
		await waitFor(() =>
			expect(screen.getByLabelText("In Progress, CA-1")).toBeTruthy(),
		);
	});

	it("restores the previous status when the update fails", async () => {
		mockUpdateTrackerItem.mockRejectedValue(new Error("network down"));
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
		fireEvent.click(screen.getByLabelText("Backlog, CA-1"));
		fireEvent.click(screen.getByRole("option", { name: /In Progress/ }));

		await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
		expect(mockShowToast.mock.calls[0]?.[1]).toBe("error");
		expect(screen.getByLabelText("Backlog, CA-1")).toBeTruthy();
	});

	it("defers a second status pick until the first request settles", async () => {
		let rejectFirst: ((err: Error) => void) | undefined;
		mockUpdateTrackerItem
			.mockImplementationOnce(
				() =>
					new Promise((_resolve, reject) => {
						rejectFirst = reject;
					}),
			)
			.mockResolvedValueOnce(
				makeItem({ id: 1, key: "CA-1", status: statuses[2]!, version: 2 }),
			);
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-CA-1"));

		fireEvent.click(screen.getByLabelText("Backlog, CA-1"));
		fireEvent.click(screen.getByRole("option", { name: /In Progress/ }));
		await waitFor(() => screen.getByLabelText("In Progress, CA-1"));

		fireEvent.click(screen.getByLabelText("In Progress, CA-1"));
		fireEvent.click(screen.getByRole("option", { name: /Done/ }));
		// The second pick waits instead of racing the first request.
		expect(mockUpdateTrackerItem).toHaveBeenCalledTimes(1);

		rejectFirst?.(new Error("network down"));
		await waitFor(() => expect(mockUpdateTrackerItem).toHaveBeenCalledTimes(2));
		// Runs against the rolled-back item, so the version is still the fresh one.
		expect(mockUpdateTrackerItem).toHaveBeenLastCalledWith(7, "CA-1", {
			statusId: 5,
			version: 1,
		});
		// The failed request's rollback did not resurrect the old status.
		await waitFor(() =>
			expect(screen.getByLabelText("Done, CA-1")).toBeTruthy(),
		);
	});

	it("keeps rows on screen while an SSE-triggered refresh is in flight", async () => {
		let sseHandler: ((e: { type: string }) => void) | undefined;
		mockUseBoard.mockReturnValue({
			activeWorkspaceId: 7,
			subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
				sseHandler = cb;
				return () => {};
			},
			registerRefreshTrackerList: vi.fn(),
			refreshTrackerList: vi.fn(),
			showToast: mockShowToast,
		});
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-CA-1"));

		let releaseItems: ((items: TrackerItem[]) => void) | undefined;
		mockListTrackerItems.mockReturnValueOnce(
			new Promise<TrackerItem[]>((resolve) => {
				releaseItems = resolve;
			}),
		);
		sseHandler?.({ type: "tracker.updated" });
		await waitFor(() => expect(mockListTrackerItems).toHaveBeenCalledTimes(2));
		expect(screen.getByTestId("tracker-row-CA-1")).toBeTruthy();
		releaseItems?.([makeItem({ id: 1, key: "CA-1" })]);
	});

	it("resets collapsed sections when re-navigating to /tracker", async () => {
		const { rerender } = render(<TrackerPage />);
		await waitFor(() => screen.getByText("Done"));
		fireEvent.click(screen.getByTestId("toggle-section-Done"));
		expect(screen.queryByText("CA-2")).toBeNull();

		mockLocation.key = "tracker-2";
		rerender(<TrackerPage />);
		await waitFor(() => expect(screen.getByText("CA-2")).toBeTruthy());
	});

	it("opens create modal from global + and submits the default status", async () => {
		render(<TrackerPage />);
		await waitFor(() => screen.getByText("Backlog"));
		fireEvent.click(
			screen.getByRole("button", { name: /create tracker item/i }),
		);
		const modal = within(screen.getByRole("dialog"));
		await waitFor(() => modal.getByRole("button", { name: /Backlog/ }));
		fireEvent.change(screen.getByLabelText(/item title/i), {
			target: { value: "Fix realtime" },
		});
		fireEvent.click(screen.getByRole("button", { name: /create item/i }));
		await waitFor(() =>
			expect(mockCreateTrackerItem).toHaveBeenCalledWith(7, {
				title: "Fix realtime",
				statusId: 1,
				priorityId: null,
			}),
		);
	});

	it("submits picker values on create", async () => {
		render(<TrackerPage />);
		await waitFor(() => screen.getByText("Backlog"));
		fireEvent.click(
			screen.getByRole("button", { name: /create tracker item/i }),
		);
		const modal = within(screen.getByRole("dialog"));
		fireEvent.change(screen.getByLabelText(/item title/i), {
			target: { value: "Full" },
		});
		fireEvent.click(modal.getByRole("button", { name: /Backlog/ }));
		fireEvent.click(screen.getByRole("option", { name: /In Progress/ }));
		fireEvent.click(modal.getByRole("button", { name: /Priority/ }));
		fireEvent.click(screen.getByRole("option", { name: /High/ }));
		fireEvent.click(screen.getByRole("button", { name: /create item/i }));
		await waitFor(() =>
			expect(mockCreateTrackerItem).toHaveBeenCalledWith(
				7,
				expect.objectContaining({
					title: "Full",
					statusId: 2,
					priorityId: 10,
				}),
			),
		);
	});

	it("submits label and assignee pickers on create", async () => {
		render(<TrackerPage />);
		await waitFor(() => screen.getByText("Backlog"));
		fireEvent.click(
			screen.getByRole("button", { name: /create tracker item/i }),
		);
		const modal = within(screen.getByRole("dialog"));
		await waitFor(() => modal.getByRole("button", { name: /Labels/ }));
		fireEvent.change(screen.getByLabelText(/item title/i), {
			target: { value: "Tagged task" },
		});
		fireEvent.change(screen.getByLabelText(/description/i), {
			target: { value: "Needs review" },
		});
		fireEvent.click(modal.getByRole("button", { name: /Labels/ }));
		fireEvent.click(screen.getByRole("option", { name: /Feature/ }));
		fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
		fireEvent.click(modal.getByRole("button", { name: /Assignee/ }));
		fireEvent.click(screen.getByRole("option", { name: /Alice/ }));
		fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
		fireEvent.click(screen.getByRole("button", { name: /create item/i }));
		await waitFor(() =>
			expect(mockCreateTrackerItem).toHaveBeenCalledWith(
				7,
				expect.objectContaining({
					title: "Tagged task",
					description: "Needs review",
					labelIds: [3],
					assigneeIds: [7],
				}),
			),
		);
	});

	it("removes row on tracker.deleted SSE by trackerItemId", async () => {
		let sseHandler:
			| ((e: {
					type: string;
					payload?: unknown;
					trackerItemId?: number;
			  }) => void)
			| undefined;
		mockUseBoard.mockReturnValue({
			activeWorkspaceId: 7,
			subscribeTrackerEvents: (cb: typeof sseHandler) => {
				sseHandler = cb;
				return () => {};
			},
			registerRefreshTrackerList: vi.fn(),
			refreshTrackerList: vi.fn(),
		});
		render(<TrackerPage />);
		await waitFor(() => screen.getByText("CA-2"));
		sseHandler?.({ type: "tracker.deleted", trackerItemId: 2 });
		await waitFor(() => expect(screen.queryByText("CA-2")).toBeNull());
		expect(screen.getByText("CA-1")).toBeTruthy();
	});

	it("shows new vocab section on tracker.vocabulary.created SSE without refresh", async () => {
		let sseHandler:
			| ((e: { type: string; payload?: unknown }) => void)
			| undefined;
		mockUseBoard.mockReturnValue({
			activeWorkspaceId: 7,
			subscribeTrackerEvents: (
				cb: (e: { type: string; payload?: unknown }) => void,
			) => {
				sseHandler = cb;
				return () => {};
			},
			registerRefreshTrackerList: vi.fn(),
			refreshTrackerList: vi.fn(),
		});
		render(<TrackerPage />);
		await waitFor(() => screen.getByText("Backlog"));
		sseHandler?.({
			type: "tracker.vocabulary.created",
			payload: {
				id: 99,
				kind: "status",
				name: "Blocked",
				position: 2000,
				colour: "oklch(0.7 0.1 180)",
			},
		});
		await waitFor(() => expect(screen.getByText("Blocked")).toBeTruthy());
	});

	it("includes Tracker nav between Board and Inbox", () => {
		const paths = KANBAN_NAV.map((i) => i.to);
		expect(paths).toEqual(["/board", "/tracker", "/inbox", "/dashboard"]);
	});
});

describe("TrackerPage projects", () => {
	it("renders unassigned items unchanged, plus a New project affordance, when no projects exist", async () => {
		render(<TrackerPage />);
		await waitFor(() => expect(screen.getByText("Backlog")).toBeTruthy());
		expect(screen.getByText("CA-1")).toBeTruthy();
		expect(screen.getByRole("button", { name: /new project/i })).toBeTruthy();
		expect(screen.queryByText("In projects")).toBeNull();
	});

	it("opens the project modal, creates a project and shows the card without a manual refresh", async () => {
		mockListTrackerProjects
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([releaseProject]);
		mockCreateTrackerProject.mockResolvedValue(releaseProject);
		render(<TrackerPage />);
		await waitFor(() => screen.getByText("Backlog"));
		fireEvent.click(screen.getByRole("button", { name: /new project/i }));
		const modal = within(screen.getByRole("dialog"));
		fireEvent.change(modal.getByLabelText(/project name/i), {
			target: { value: "Rilis v2" },
		});
		fireEvent.click(modal.getByRole("button", { name: /create project/i }));
		await waitFor(() =>
			expect(mockCreateTrackerProject).toHaveBeenCalledWith(7, {
				name: "Rilis v2",
			}),
		);
		await waitFor(() => expect(screen.getByText("Rilis v2")).toBeTruthy());
	});

	it("surfaces the server's 400 inline for a blank project name", async () => {
		mockCreateTrackerProject.mockRejectedValueOnce(
			new ApiError("Name is required", 400),
		);
		render(<TrackerPage />);
		await waitFor(() => screen.getByText("Backlog"));
		fireEvent.click(screen.getByRole("button", { name: /new project/i }));
		const modal = within(screen.getByRole("dialog"));
		fireEvent.click(modal.getByRole("button", { name: /create project/i }));
		expect(await modal.findByText("Name is required")).toBeTruthy();
		expect(screen.getByRole("dialog")).toBeTruthy();
	});

	it("disables New project with a visible reason at the 10-project cap", async () => {
		mockListTrackerProjects.mockResolvedValueOnce(
			Array.from({ length: 10 }, (_, i) => ({
				...releaseProject,
				id: i + 1,
				name: `Project ${i + 1}`,
			})),
		);
		render(<TrackerPage />);
		await waitFor(() => screen.getByText("Project 1"));
		const button = screen.getByRole("button", { name: /new project/i });
		expect((button as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByText(/project limit \(10\)/i)).toBeTruthy();
	});

	it("shows name, percentage, task count and an overdue marker on a project card", async () => {
		vi.setSystemTime(new Date("2026-10-05T12:00:00"));
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
		mockListTrackerItems.mockResolvedValueOnce([
			inProjectItem({ id: 10, key: "CA-10", status: statuses[2]! }),
			inProjectItem({
				id: 11,
				key: "CA-11",
				status: statuses[1]!,
				endDate: "2026-09-20",
			}),
		]);
		render(<TrackerPage />);
		await waitFor(() => screen.getByText("Rilis v2"));
		expect(screen.getByText("50%")).toBeTruthy();
		expect(screen.getByText(/2 tasks/i)).toBeTruthy();
		expect(screen.getByLabelText(/overdue/i)).toBeTruthy();
		vi.useRealTimers();
	});

	it('shows an in-project-only match under "In projects" with its trail, and never fires the empty state', async () => {
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
		mockListTrackerItems.mockResolvedValueOnce([
			inProjectItem({ id: 10, key: "CA-10", title: "Ship realtime sync" }),
		]);
		render(<TrackerPage />);
		await waitFor(() => screen.getByText("Rilis v2"));
		fireEvent.change(screen.getByPlaceholderText(/search/i), {
			target: { value: "realtime" },
		});
		await waitFor(() => expect(screen.getByText("In projects")).toBeTruthy());
		expect(screen.getByText("CA-10")).toBeTruthy();
		expect(screen.getByText("Rilis v2 › Persiapan")).toBeTruthy();
		expect(screen.queryByText(/no items match/i)).toBeNull();
	});

	it("counts the in-project match in the toolbar total", async () => {
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
		mockListTrackerItems.mockResolvedValueOnce([
			inProjectItem({ id: 10, key: "CA-10", title: "Ship realtime sync" }),
		]);
		render(<TrackerPage />);
		await waitFor(() => screen.getByText("Rilis v2"));
		fireEvent.change(screen.getByPlaceholderText(/search/i), {
			target: { value: "realtime" },
		});
		await waitFor(() => expect(screen.getByText("1 item")).toBeTruthy());
	});

	it("still shows the empty state when neither a project name nor any item matches", async () => {
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
		render(<TrackerPage />);
		await waitFor(() => screen.getByText("Rilis v2"));
		fireEvent.change(screen.getByPlaceholderText(/search/i), {
			target: { value: "nonexistent-zzz" },
		});
		await waitFor(() =>
			expect(screen.getByText(/no items match/i)).toBeTruthy(),
		);
	});

	it("reloads and shows the card on tracker.project.created without a manual refresh", async () => {
		let sseHandler: ((e: { type: string }) => void) | undefined;
		mockUseBoard.mockReturnValue({
			activeWorkspaceId: 7,
			subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
				sseHandler = cb;
				return () => {};
			},
			registerRefreshTrackerList: vi.fn(),
			refreshTrackerList: vi.fn(),
			showToast: mockShowToast,
		});
		render(<TrackerPage />);
		await waitFor(() => screen.getByText("Backlog"));
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
		sseHandler?.({ type: "tracker.project.created" });
		await waitFor(() => expect(screen.getByText("Rilis v2")).toBeTruthy());
	});

	it("removes the card and surfaces the released tasks on tracker.project.deleted", async () => {
		let sseHandler: ((e: { type: string }) => void) | undefined;
		mockUseBoard.mockReturnValue({
			activeWorkspaceId: 7,
			subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
				sseHandler = cb;
				return () => {};
			},
			registerRefreshTrackerList: vi.fn(),
			refreshTrackerList: vi.fn(),
			showToast: mockShowToast,
		});
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
		mockListTrackerItems.mockResolvedValueOnce([
			inProjectItem({ id: 10, key: "CA-10", title: "Ship realtime sync" }),
		]);
		render(<TrackerPage />);
		await waitFor(() => screen.getByText("Rilis v2"));

		mockListTrackerProjects.mockResolvedValueOnce([]);
		mockListTrackerItems.mockResolvedValueOnce([
			makeItem({
				id: 10,
				key: "CA-10",
				title: "Ship realtime sync",
				projectId: null,
				phaseId: null,
			}),
		]);
		sseHandler?.({ type: "tracker.project.deleted" });
		await waitFor(() => expect(screen.queryByText("Rilis v2")).toBeNull());
		await waitFor(() => expect(screen.getByText("CA-10")).toBeTruthy());
	});
});
