// @vitest-environment jsdom
// client/src/pages/TrackerPage.test.tsx
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackerVocabulary, WorkItem } from "../types";

const {
	mockListWorkItems,
	mockListTrackerItems,
	mockCreateWorkItem,
	mockCreateTrackerItem,
	mockListTrackerProjects,
	mockCreateTrackerProject,
	mockListTrackerVocabularies,
	mockGetWorkspaceMembers,
	mockUpdateWorkItem,
	mockUpdateTrackerItem,
	mockShowToast,
	mockUseBoard,
	mockNavigate,
	mockLocation,
} = vi.hoisted(() => ({
	mockListWorkItems: vi.fn(),
	mockListTrackerItems: vi.fn(),
	mockCreateWorkItem: vi.fn(),
	mockCreateTrackerItem: vi.fn(),
	mockListTrackerProjects: vi.fn(),
	mockCreateTrackerProject: vi.fn(),
	mockListTrackerVocabularies: vi.fn(),
	mockGetWorkspaceMembers: vi.fn(),
	mockUpdateWorkItem: vi.fn(),
	mockUpdateTrackerItem: vi.fn(),
	mockShowToast: vi.fn(),
	mockUseBoard: vi.fn(),
	mockNavigate: vi.fn(),
	mockLocation: { pathname: "/tracker", key: "tracker-1" },
}));

let locationKeySeq = 0;

vi.mock("../api", () => ({
	api: {
		listWorkItems: (...a: unknown[]) => mockListWorkItems(...a),
		listTrackerItems: (...a: unknown[]) => mockListTrackerItems(...a),
		createWorkItem: (...a: unknown[]) => mockCreateWorkItem(...a),
		createTrackerItem: (...a: unknown[]) => mockCreateTrackerItem(...a),
		listTrackerProjects: (...a: unknown[]) => mockListTrackerProjects(...a),
		createTrackerProject: (...a: unknown[]) => mockCreateTrackerProject(...a),
		updateWorkItem: (...a: unknown[]) => mockUpdateWorkItem(...a),
		updateTrackerItem: (...a: unknown[]) => mockUpdateTrackerItem(...a),
		listTrackerVocabularies: (...a: unknown[]) =>
			mockListTrackerVocabularies(...a),
		getWorkspaceMembers: (...a: unknown[]) => mockGetWorkspaceMembers(...a),
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

// useSearchParams is stateful here: the page reads the active tab from the
// query string, so a stub returning a frozen value could never switch tabs.
// Writing the params also mints a new location key, because that is what the
// real router does — replace() is not key-preserving — and the page has to
// tell that apart from a genuine re-navigation.
vi.mock("react-router", async () => {
	const React = await vi.importActual<typeof import("react")>("react");
	return {
		useNavigate: () => mockNavigate,
		useLocation: () => mockLocation,
		useSearchParams: () => {
			const [params, setParams] = React.useState(() => new URLSearchParams());
			const update = (
				next: URLSearchParams | ((prev: URLSearchParams) => URLSearchParams),
			) => {
				mockLocation.key = `key-${++locationKeySeq}`;
				setParams((prev) => (typeof next === "function" ? next(prev) : next));
			};
			return [params, update];
		},
	};
});

import { ApiError } from "../api";
import { KANBAN_NAV } from "../layout/sidebar/navItems";
import type { TrackerPhase, TrackerProject } from "../types";
import TrackerPage from "./TrackerPage";

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
	{
		id: 6,
		kind: "status",
		name: "Todo",
		position: 2000,
		colour: "oklch(0.7 0.1 180)",
		category: "backlog",
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
	{
		id: 11,
		kind: "priority",
		name: "Low",
		position: 2000,
		colour: "oklch(0.7 0.1 220)",
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
	overrides: Partial<WorkItem> & { id: number },
): WorkItem {
	return {
		key: "CA-1",
		title: "Workspace Rename",
		description: "",
		source: "tracker",
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

const P1 = releaseProject.id;
const Ph1 = persiapan.id;

const projectB: TrackerProject = {
	id: 2,
	name: "Migrasi JSX",
	startDate: null,
	endDate: null,
	position: 2048,
	version: 1,
	phases: [
		{
			id: 12,
			projectId: 2,
			name: "Cutover",
			subtitle: "",
			startDate: null,
			endDate: null,
			position: 1024,
			version: 1,
			createdAt: "2026-08-01T00:00:00Z",
			updatedAt: "2026-08-01T00:00:00Z",
		},
	],
	createdAt: "2026-08-01T00:00:00Z",
	updatedAt: "2026-08-01T00:00:00Z",
};

const P2 = projectB.id;

const zeroPhaseProject: TrackerProject = {
	id: 3,
	name: "FASTRACK TRACTOR",
	startDate: null,
	endDate: null,
	position: 3072,
	version: 1,
	phases: [],
	createdAt: "2026-08-01T00:00:00Z",
	updatedAt: "2026-08-01T00:00:00Z",
};

function inProjectItem(
	overrides: Partial<WorkItem> & { id: number },
): WorkItem {
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
			{
				userId: 9,
				username: "carol",
				displayName: "Carol",
				role: "member",
			},
			{
				userId: 10,
				username: "dave",
				displayName: "Dave",
				role: "member",
			},
		],
	});
	mockListWorkItems.mockResolvedValue([
		makeItem({ id: 1, key: "CA-1", title: "Workspace Rename" }),
		makeItem({
			id: 2,
			key: "CA-2",
			title: "Done task",
			status: statuses[2]!,
			labels: [],
		}),
	]);
	mockCreateWorkItem.mockResolvedValue(
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
	vi.useRealTimers();
	// The grouping preference is persisted per workspace — otherwise one test's
	// pick leaks into the next.
	localStorage.clear();
});

describe("TrackerPage", () => {
	it("renders sections ordered by vocab position with row metadata", async () => {
		render(<TrackerPage />);
		await waitFor(() => expect(screen.getByText("Backlog")).toBeTruthy());
		expect(screen.getByText("CA-1")).toBeTruthy();
		expect(screen.getByText("Workspace Rename")).toBeTruthy();
		expect(screen.getByTitle("Feature")).toBeTruthy();
		expect(screen.getByTestId("tracker-row-CA-1")).toBeTruthy();
	});

	it("hides empty status sections outside of search", async () => {
		render(<TrackerPage />);
		await waitFor(() => expect(screen.getByText("Backlog")).toBeTruthy());
		// Default fixture only seeds Backlog and Done items — In Progress has
		// zero items and must not render an empty band.
		expect(screen.queryByTestId("toggle-section-In Progress")).toBeNull();
		expect(screen.getByTestId("toggle-section-Backlog")).toBeTruthy();
		expect(screen.getByTestId("toggle-section-Done")).toBeTruthy();
	});

	it("hides empty sections when search is active", async () => {
		mockListWorkItems.mockResolvedValueOnce([
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
		mockListWorkItems.mockResolvedValueOnce([
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

	it("sets both dates from the row date popover", async () => {
		mockListWorkItems.mockResolvedValueOnce([
			makeItem({
				id: 4,
				key: "TE-4",
				title: "Schedule me",
				startDate: null,
				endDate: null,
				version: 3,
			}),
		]);
		mockUpdateWorkItem.mockResolvedValue(
			makeItem({
				id: 4,
				key: "TE-4",
				title: "Schedule me",
				startDate: "2026-08-06",
				endDate: "2026-08-26",
				version: 4,
			}),
		);
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-TE-4"));

		fireEvent.click(screen.getByLabelText("Date: Set date"));
		fireEvent.change(screen.getByLabelText("Start date"), {
			target: { value: "2026-08-06" },
		});
		fireEvent.change(screen.getByLabelText("End date"), {
			target: { value: "2026-08-26" },
		});
		fireEvent.click(screen.getByLabelText("Close date picker"));

		await waitFor(() =>
			expect(mockUpdateWorkItem).toHaveBeenCalledWith(7, "TE-4", {
				startDate: "2026-08-06",
				endDate: "2026-08-26",
				version: 3,
			}),
		);
		await waitFor(() =>
			expect(screen.getByLabelText("Date: 6–26 Aug")).toBeTruthy(),
		);
	});

	it("does not PATCH when the date popover closes without edits", async () => {
		mockListWorkItems.mockResolvedValueOnce([
			makeItem({
				id: 4,
				key: "TE-4",
				title: "Schedule me",
				startDate: "2026-08-06",
				endDate: "2026-08-26",
				version: 3,
			}),
		]);
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-TE-4"));

		fireEvent.click(screen.getByLabelText("Date: 6–26 Aug"));
		fireEvent.click(screen.getByLabelText("Close date picker"));

		expect(mockUpdateWorkItem).not.toHaveBeenCalled();
	});

	it("reverts the date and refetches after a version conflict", async () => {
		mockListWorkItems.mockResolvedValueOnce([
			makeItem({
				id: 4,
				key: "TE-4",
				title: "Schedule me",
				startDate: null,
				endDate: null,
				version: 3,
			}),
		]);
		mockUpdateWorkItem.mockRejectedValueOnce(
			new ApiError("conflict", 409, "version_conflict"),
		);
		mockListWorkItems.mockResolvedValueOnce([
			makeItem({
				id: 4,
				key: "TE-4",
				title: "Schedule me",
				startDate: null,
				endDate: null,
				version: 4,
			}),
		]);
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-TE-4"));

		fireEvent.click(screen.getByLabelText("Date: Set date"));
		fireEvent.change(screen.getByLabelText("Start date"), {
			target: { value: "2026-08-06" },
		});
		fireEvent.change(screen.getByLabelText("End date"), {
			target: { value: "2026-08-26" },
		});
		fireEvent.click(screen.getByLabelText("Close date picker"));

		await waitFor(() =>
			expect(mockShowToast).toHaveBeenCalledWith(
				"Someone else updated this item first — refreshed.",
				"warning",
			),
		);
		await waitFor(() => expect(mockListWorkItems).toHaveBeenCalledTimes(2));
		expect(screen.getByLabelText("Date: Set date")).toBeTruthy();
	});

	it("commits an edited date draft before opening the status picker", async () => {
		mockListWorkItems.mockResolvedValueOnce([
			makeItem({
				id: 4,
				key: "TE-4",
				title: "Schedule me",
				startDate: null,
				endDate: null,
				version: 3,
			}),
		]);
		mockUpdateWorkItem.mockResolvedValue(
			makeItem({
				id: 4,
				key: "TE-4",
				title: "Schedule me",
				startDate: "2026-08-06",
				endDate: "2026-08-26",
				version: 4,
			}),
		);
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-TE-4"));

		fireEvent.click(screen.getByLabelText("Date: Set date"));
		fireEvent.change(screen.getByLabelText("Start date"), {
			target: { value: "2026-08-06" },
		});
		fireEvent.change(screen.getByLabelText("End date"), {
			target: { value: "2026-08-26" },
		});
		fireEvent.click(screen.getByLabelText("Backlog, TE-4"));

		await waitFor(() => expect(mockUpdateWorkItem).toHaveBeenCalledTimes(1));
		expect(mockUpdateWorkItem).toHaveBeenCalledWith(7, "TE-4", {
			startDate: "2026-08-06",
			endDate: "2026-08-26",
			version: 3,
		});
		expect(screen.getByRole("option", { name: /In Progress/ })).toBeTruthy();
	});

	it("changes status inline from the row glyph without navigating", async () => {
		mockUpdateWorkItem.mockResolvedValue(
			makeItem({ id: 1, key: "CA-1", status: statuses[1]! }),
		);
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
		fireEvent.click(screen.getByLabelText("Backlog, CA-1"));
		fireEvent.click(screen.getByRole("option", { name: /In Progress/ }));

		await waitFor(() =>
			expect(mockUpdateWorkItem).toHaveBeenCalledWith(7, "CA-1", {
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
		mockUpdateWorkItem.mockRejectedValue(new Error("network down"));
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
		fireEvent.click(screen.getByLabelText("Backlog, CA-1"));
		fireEvent.click(screen.getByRole("option", { name: /In Progress/ }));

		await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
		expect(mockShowToast.mock.calls[0]?.[1]).toBe("error");
		expect(screen.getByLabelText("Backlog, CA-1")).toBeTruthy();
	});

	it("processes three rapid status picks in order", async () => {
		const pending: Array<() => void> = [];
		let version = 1;
		mockUpdateWorkItem.mockImplementation(
			(_ws, _key, patch) =>
				new Promise<WorkItem>((resolve) => {
					pending.push(() => {
						version += 1;
						const nextStatus = statuses.find((s) => s.id === patch.statusId)!;
						resolve(
							makeItem({
								id: 1,
								key: "CA-1",
								status: nextStatus,
								version,
							}),
						);
					});
				}),
		);
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
		const statusTrigger = () =>
			within(screen.getByTestId("tracker-row-CA-1").parentElement!).getByRole(
				"button",
				{ name: /, CA-1$/ },
			);

		fireEvent.click(statusTrigger());
		fireEvent.click(screen.getByRole("option", { name: /^Todo$/ }));
		fireEvent.click(statusTrigger());
		fireEvent.click(screen.getByRole("option", { name: /In Progress/ }));
		fireEvent.click(statusTrigger());
		fireEvent.click(screen.getByRole("option", { name: /Done/ }));

		await waitFor(() => expect(mockUpdateWorkItem).toHaveBeenCalledTimes(1));
		pending.shift()?.();
		await waitFor(() => expect(mockUpdateWorkItem).toHaveBeenCalledTimes(2));
		pending.shift()?.();
		await waitFor(() => expect(mockUpdateWorkItem).toHaveBeenCalledTimes(3));
		pending.shift()?.();

		expect(mockUpdateWorkItem.mock.calls[0]?.[2]).toEqual({
			statusId: 6,
			version: 1,
		});
		expect(mockUpdateWorkItem.mock.calls[1]?.[2]).toEqual({
			statusId: 2,
			version: 2,
		});
		expect(mockUpdateWorkItem.mock.calls[2]?.[2]).toEqual({
			statusId: 5,
			version: 3,
		});
		await waitFor(() =>
			expect(screen.getByLabelText("Done, CA-1")).toBeTruthy(),
		);
	});

	it("processes a queued status pick after 409 once refresh succeeds", async () => {
		mockUpdateWorkItem
			.mockRejectedValueOnce(new ApiError("conflict", 409, "version_conflict"))
			.mockResolvedValueOnce(
				makeItem({ id: 1, key: "CA-1", status: statuses[2]!, version: 6 }),
			);
		mockListWorkItems
			.mockResolvedValueOnce([
				makeItem({ id: 1, key: "CA-1", title: "Workspace Rename" }),
				makeItem({
					id: 2,
					key: "CA-2",
					title: "Done task",
					status: statuses[2]!,
					labels: [],
				}),
			])
			.mockResolvedValueOnce([
				makeItem({
					id: 1,
					key: "CA-1",
					title: "Workspace Rename",
					version: 5,
				}),
				makeItem({
					id: 2,
					key: "CA-2",
					title: "Done task",
					status: statuses[2]!,
					labels: [],
				}),
			]);
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
		const statusTrigger = () =>
			within(screen.getByTestId("tracker-row-CA-1").parentElement!).getByRole(
				"button",
				{ name: /, CA-1$/ },
			);

		fireEvent.click(statusTrigger());
		fireEvent.click(screen.getByRole("option", { name: /In Progress/ }));
		await waitFor(() =>
			expect(screen.getByLabelText("In Progress, CA-1")).toBeTruthy(),
		);

		fireEvent.click(statusTrigger());
		fireEvent.click(screen.getByRole("option", { name: /Done/ }));

		await waitFor(() =>
			expect(mockShowToast).toHaveBeenCalledWith(
				"Someone else updated this item first — refreshed.",
				"warning",
			),
		);
		await waitFor(() => expect(mockUpdateWorkItem).toHaveBeenCalledTimes(2));
		expect(mockUpdateWorkItem).toHaveBeenLastCalledWith(7, "CA-1", {
			statusId: 5,
			version: 5,
		});
		await waitFor(() =>
			expect(screen.getByLabelText("Done, CA-1")).toBeTruthy(),
		);
	});

	it("continues a queued status pick when 409 recovery refresh fails", async () => {
		mockUpdateWorkItem
			.mockRejectedValueOnce(new ApiError("conflict", 409, "version_conflict"))
			.mockResolvedValueOnce(
				makeItem({ id: 1, key: "CA-1", status: statuses[2]!, version: 2 }),
			);
		mockListWorkItems
			.mockResolvedValueOnce([
				makeItem({ id: 1, key: "CA-1", title: "Workspace Rename" }),
				makeItem({
					id: 2,
					key: "CA-2",
					title: "Done task",
					status: statuses[2]!,
					labels: [],
				}),
			])
			.mockRejectedValueOnce(new Error("network down"));
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
		const statusTrigger = () =>
			within(screen.getByTestId("tracker-row-CA-1").parentElement!).getByRole(
				"button",
				{ name: /, CA-1$/ },
			);

		fireEvent.click(statusTrigger());
		fireEvent.click(screen.getByRole("option", { name: /In Progress/ }));
		await waitFor(() =>
			expect(screen.getByLabelText("In Progress, CA-1")).toBeTruthy(),
		);

		fireEvent.click(statusTrigger());
		fireEvent.click(screen.getByRole("option", { name: /Done/ }));

		await waitFor(() =>
			expect(mockShowToast).toHaveBeenCalledWith(
				"Someone else updated this item first — refreshed.",
				"warning",
			),
		);
		await waitFor(() => expect(mockUpdateWorkItem).toHaveBeenCalledTimes(2));
		expect(mockUpdateWorkItem).toHaveBeenLastCalledWith(7, "CA-1", {
			statusId: 5,
			version: 1,
		});
		await waitFor(() =>
			expect(screen.getByLabelText("Done, CA-1")).toBeTruthy(),
		);
	});

	it("defers a second status pick until the first request settles", async () => {
		let rejectFirst: ((err: Error) => void) | undefined;
		mockUpdateWorkItem
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
		expect(mockUpdateWorkItem).toHaveBeenCalledTimes(1);

		rejectFirst?.(new Error("network down"));
		await waitFor(() => expect(mockUpdateWorkItem).toHaveBeenCalledTimes(2));
		// Runs against the rolled-back item, so the version is still the fresh one.
		expect(mockUpdateWorkItem).toHaveBeenLastCalledWith(7, "CA-1", {
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

		let releaseItems: ((items: WorkItem[]) => void) | undefined;
		mockListWorkItems.mockReturnValueOnce(
			new Promise<WorkItem[]>((resolve) => {
				releaseItems = resolve;
			}),
		);
		sseHandler?.({ type: "tracker.updated" });
		await waitFor(() => expect(mockListWorkItems).toHaveBeenCalledTimes(2));
		expect(screen.getByTestId("tracker-row-CA-1")).toBeTruthy();
		releaseItems?.([makeItem({ id: 1, key: "CA-1" })]);
	});

	it("does not let a stale SSE refresh overwrite newer item state", async () => {
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
		const initialItem = makeItem({ id: 1, key: "CA-1", version: 1 });
		mockListWorkItems.mockResolvedValueOnce([initialItem]);
		let resolveUpdate: ((item: WorkItem) => void) | undefined;
		mockUpdateWorkItem.mockImplementationOnce(
			() =>
				new Promise<WorkItem>((resolve) => {
					resolveUpdate = resolve;
				}),
		);
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-CA-1"));

		fireEvent.click(screen.getByLabelText("Backlog, CA-1"));
		fireEvent.click(screen.getByRole("option", { name: /In Progress/ }));
		await waitFor(() =>
			expect(screen.getByLabelText("In Progress, CA-1")).toBeTruthy(),
		);
		expect(mockUpdateWorkItem).toHaveBeenCalledTimes(1);

		mockListWorkItems.mockResolvedValueOnce([initialItem]);
		sseHandler?.({ type: "tracker.updated" });
		await waitFor(() => expect(mockListWorkItems).toHaveBeenCalledTimes(2));
		expect(screen.getByLabelText("In Progress, CA-1")).toBeTruthy();

		resolveUpdate?.(
			makeItem({ id: 1, key: "CA-1", status: statuses[1]!, version: 2 }),
		);
		await waitFor(() =>
			expect(screen.getByLabelText("In Progress, CA-1")).toBeTruthy(),
		);

		mockListWorkItems.mockResolvedValueOnce([initialItem]);
		sseHandler?.({ type: "tracker.updated" });
		await waitFor(() => expect(mockListWorkItems).toHaveBeenCalledTimes(3));
		await waitFor(() =>
			expect(screen.getByLabelText("In Progress, CA-1")).toBeTruthy(),
		);
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
		fireEvent.click(screen.getByRole("button", { name: /^New item$/ }));
		const modal = within(screen.getByRole("dialog"));
		await waitFor(() => modal.getByRole("button", { name: /^Backlog$/ }));
		fireEvent.change(screen.getByLabelText(/item title/i), {
			target: { value: "Fix realtime" },
		});
		fireEvent.click(screen.getByRole("button", { name: /create item/i }));
		await waitFor(() =>
			expect(mockCreateWorkItem).toHaveBeenCalledWith(7, {
				title: "Fix realtime",
				statusId: 1,
				priorityId: null,
			}),
		);
	});

	it("submits picker values on create", async () => {
		render(<TrackerPage />);
		await waitFor(() => screen.getByText("Backlog"));
		fireEvent.click(screen.getByRole("button", { name: /^New item$/ }));
		const modal = within(screen.getByRole("dialog"));
		fireEvent.change(screen.getByLabelText(/item title/i), {
			target: { value: "Full" },
		});
		fireEvent.click(modal.getByRole("button", { name: /^Backlog$/ }));
		fireEvent.click(screen.getByRole("option", { name: /In Progress/ }));
		fireEvent.click(modal.getByRole("button", { name: /Priority/ }));
		fireEvent.click(screen.getByRole("option", { name: /High/ }));
		fireEvent.click(screen.getByRole("button", { name: /create item/i }));
		await waitFor(() =>
			expect(mockCreateWorkItem).toHaveBeenCalledWith(
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
		fireEvent.click(screen.getByRole("button", { name: /^New item$/ }));
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
		fireEvent.keyDown(modal.getByRole("combobox", { name: "Add label…" }), {
			key: "Escape",
		});
		fireEvent.click(modal.getByRole("button", { name: /Assignee/ }));
		fireEvent.click(screen.getByRole("option", { name: /Alice/ }));
		fireEvent.keyDown(modal.getByRole("combobox", { name: "Assign to…" }), {
			key: "Escape",
		});
		fireEvent.click(screen.getByRole("button", { name: /create item/i }));
		await waitFor(() =>
			expect(mockCreateWorkItem).toHaveBeenCalledWith(
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

	describe("inline assignee and label toggles", () => {
		function ca1Row() {
			return screen.getByTestId("tracker-row-CA-1").parentElement!;
		}

		function openAssigneePicker() {
			const btn = within(ca1Row()).getByRole("button", { name: "Assignees" });
			if (btn.getAttribute("aria-expanded") !== "true") {
				fireEvent.click(btn);
			}
		}

		function openLabelPicker() {
			fireEvent.click(within(ca1Row()).getByRole("button", { name: "Labels" }));
		}

		it("adds an assignee from the row picker", async () => {
			mockListWorkItems.mockResolvedValueOnce([
				makeItem({
					id: 1,
					key: "CA-1",
					title: "Workspace Rename",
					assignees: [{ id: 7, displayName: "Alice", username: "alice" }],
					version: 2,
				}),
			]);
			mockUpdateWorkItem.mockResolvedValue(
				makeItem({
					id: 1,
					key: "CA-1",
					assignees: [
						{ id: 7, displayName: "Alice", username: "alice" },
						{ id: 8, displayName: "Bob", username: "bob" },
					],
					version: 3,
				}),
			);
			render(<TrackerPage />);
			await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
			expect(screen.getByTestId("row-inline-assignees-CA-1")).toBeTruthy();

			openAssigneePicker();
			fireEvent.click(screen.getByRole("option", { name: /Bob/ }));

			await waitFor(() =>
				expect(mockUpdateWorkItem).toHaveBeenCalledWith(7, "CA-1", {
					assigneeIds: [7, 8],
					version: 2,
				}),
			);
		});

		it("preserves an assignee that is missing from the current member catalog", async () => {
			mockListWorkItems.mockResolvedValueOnce([
				makeItem({
					id: 1,
					key: "CA-1",
					assignees: [
						{ id: 42, displayName: "Former member", username: "former" },
					],
					version: 2,
				}),
			]);
			mockUpdateWorkItem.mockResolvedValue(
				makeItem({
					id: 1,
					key: "CA-1",
					assignees: [
						{ id: 42, displayName: "Former member", username: "former" },
						{ id: 8, displayName: "Bob", username: "bob" },
					],
					version: 3,
				}),
			);
			render(<TrackerPage />);
			await waitFor(() => screen.getByTestId("tracker-row-CA-1"));

			openAssigneePicker();
			fireEvent.click(screen.getByRole("option", { name: /Bob/ }));

			await waitFor(() =>
				expect(mockUpdateWorkItem).toHaveBeenCalledWith(7, "CA-1", {
					assigneeIds: [42, 8],
					version: 2,
				}),
			);
		});

		it("queues rapid assignee toggles against live settled state", async () => {
			mockListWorkItems.mockResolvedValueOnce([
				makeItem({
					id: 1,
					key: "CA-1",
					title: "Workspace Rename",
					assignees: [{ id: 7, displayName: "Alice", username: "alice" }],
					version: 5,
				}),
			]);
			let resolveFirst: ((item: WorkItem) => void) | undefined;
			mockUpdateWorkItem
				.mockImplementationOnce(
					(_ws, _key, patch) =>
						new Promise<WorkItem>((resolve) => {
							resolveFirst = () =>
								resolve(
									makeItem({
										id: 1,
										key: "CA-1",
										assignees: [
											{ id: 7, displayName: "Alice", username: "alice" },
											{ id: 8, displayName: "Bob", username: "bob" },
										],
										version: 6,
									}),
								);
							void patch;
						}),
				)
				.mockResolvedValueOnce(
					makeItem({
						id: 1,
						key: "CA-1",
						assignees: [
							{ id: 7, displayName: "Alice", username: "alice" },
							{ id: 8, displayName: "Bob", username: "bob" },
							{ id: 9, displayName: "Carol", username: "carol" },
						],
						version: 7,
					}),
				);
			render(<TrackerPage />);
			await waitFor(() => screen.getByTestId("tracker-row-CA-1"));

			openAssigneePicker();
			fireEvent.click(screen.getByRole("option", { name: /Bob/ }));
			fireEvent.click(screen.getByRole("option", { name: /Carol/ }));

			await waitFor(() =>
				expect(mockUpdateWorkItem).toHaveBeenCalledWith(7, "CA-1", {
					assigneeIds: [7, 8],
					version: 5,
				}),
			);
			expect(mockUpdateWorkItem).toHaveBeenCalledTimes(1);

			resolveFirst?.(
				makeItem({
					id: 1,
					key: "CA-1",
					assignees: [
						{ id: 7, displayName: "Alice", username: "alice" },
						{ id: 8, displayName: "Bob", username: "bob" },
					],
					version: 6,
				}),
			);

			await waitFor(() =>
				expect(mockUpdateWorkItem).toHaveBeenCalledWith(7, "CA-1", {
					assigneeIds: [7, 8, 9],
					version: 6,
				}),
			);
			await waitFor(() => {
				const stack = within(ca1Row()).getByTestId("row-avatar-stack-CA-1");
				expect(within(stack).getByTitle("Alice")).toBeTruthy();
				expect(within(stack).getByTitle("Bob")).toBeTruthy();
			});
		});

		it("adds a label from the row picker", async () => {
			mockListWorkItems.mockResolvedValueOnce([
				makeItem({
					id: 1,
					key: "CA-1",
					title: "Workspace Rename",
					labels: [labels[0]!],
					version: 2,
				}),
			]);
			mockUpdateWorkItem.mockResolvedValue(
				makeItem({
					id: 1,
					key: "CA-1",
					labels: [labels[0]!, labels[1]!],
					version: 3,
				}),
			);
			render(<TrackerPage />);
			await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
			expect(screen.getByTestId("row-inline-labels-CA-1")).toBeTruthy();

			openLabelPicker();
			fireEvent.click(screen.getByRole("option", { name: /^Bug$/ }));

			await waitFor(() =>
				expect(mockUpdateWorkItem).toHaveBeenCalledWith(7, "CA-1", {
					labelIds: [3, 4],
					version: 2,
				}),
			);
		});

		it("preserves a label that is missing from the current label catalog", async () => {
			const legacyLabel: TrackerVocabulary = {
				id: 99,
				kind: "label",
				name: "Legacy label",
				position: 1000,
				colour: "oklch(0.7 0.1 15)",
			};
			mockListWorkItems.mockResolvedValueOnce([
				makeItem({
					id: 1,
					key: "CA-1",
					labels: [legacyLabel],
					version: 2,
				}),
			]);
			mockUpdateWorkItem.mockResolvedValue(
				makeItem({
					id: 1,
					key: "CA-1",
					labels: [legacyLabel, labels[0]!],
					version: 3,
				}),
			);
			render(<TrackerPage />);
			await waitFor(() => screen.getByTestId("tracker-row-CA-1"));

			openLabelPicker();
			fireEvent.click(screen.getByRole("option", { name: /^Feature$/ }));

			await waitFor(() =>
				expect(mockUpdateWorkItem).toHaveBeenCalledWith(7, "CA-1", {
					labelIds: [99, 3],
					version: 2,
				}),
			);
		});

		it("removes an assignee from the row picker", async () => {
			mockListWorkItems.mockResolvedValueOnce([
				makeItem({
					id: 1,
					key: "CA-1",
					title: "Workspace Rename",
					assignees: [
						{ id: 7, displayName: "Alice", username: "alice" },
						{ id: 8, displayName: "Bob", username: "bob" },
					],
					version: 2,
				}),
			]);
			mockUpdateWorkItem.mockResolvedValue(
				makeItem({
					id: 1,
					key: "CA-1",
					assignees: [{ id: 8, displayName: "Bob", username: "bob" }],
					version: 3,
				}),
			);
			render(<TrackerPage />);
			await waitFor(() => screen.getByTestId("tracker-row-CA-1"));

			openAssigneePicker();
			fireEvent.click(screen.getByRole("option", { name: /Alice/ }));

			await waitFor(() =>
				expect(mockUpdateWorkItem).toHaveBeenCalledWith(7, "CA-1", {
					assigneeIds: [8],
					version: 2,
				}),
			);
			await waitFor(() => {
				const stack = within(ca1Row()).getByTestId("row-avatar-stack-CA-1");
				expect(within(stack).getByTitle("Bob")).toBeTruthy();
			});
			openAssigneePicker();
			expect(
				screen
					.getByRole("option", { name: /Alice/ })
					.getAttribute("aria-selected"),
			).toBe("false");
		});

		it("removes a label from the row picker", async () => {
			mockListWorkItems.mockResolvedValueOnce([
				makeItem({
					id: 1,
					key: "CA-1",
					title: "Workspace Rename",
					labels: [labels[0]!, labels[1]!],
					version: 2,
				}),
			]);
			mockUpdateWorkItem.mockResolvedValue(
				makeItem({
					id: 1,
					key: "CA-1",
					labels: [labels[1]!],
					version: 3,
				}),
			);
			render(<TrackerPage />);
			await waitFor(() => screen.getByTestId("tracker-row-CA-1"));

			openLabelPicker();
			fireEvent.click(screen.getByRole("option", { name: /^Feature$/ }));

			await waitFor(() =>
				expect(mockUpdateWorkItem).toHaveBeenCalledWith(7, "CA-1", {
					labelIds: [4],
					version: 2,
				}),
			);
		});

		it("resumes the assignee queue after a 409 using refetched state", async () => {
			mockListWorkItems
				.mockResolvedValueOnce([
					makeItem({
						id: 1,
						key: "CA-1",
						title: "Workspace Rename",
						assignees: [{ id: 7, displayName: "Alice", username: "alice" }],
						version: 5,
					}),
				])
				.mockResolvedValueOnce([
					makeItem({
						id: 1,
						key: "CA-1",
						title: "Workspace Rename",
						assignees: [
							{ id: 7, displayName: "Alice", username: "alice" },
							{ id: 10, displayName: "Dave", username: "dave" },
						],
						version: 9,
					}),
					makeItem({
						id: 2,
						key: "CA-2",
						title: "Done task",
						status: statuses[2]!,
						labels: [],
					}),
				]);
			let resolveFirst: (() => void) | undefined;
			mockUpdateWorkItem
				.mockImplementationOnce(
					() =>
						new Promise((_resolve, reject) => {
							resolveFirst = () =>
								reject(new ApiError("conflict", 409, "version_conflict"));
						}),
				)
				.mockResolvedValueOnce(
					makeItem({
						id: 1,
						key: "CA-1",
						assignees: [
							{ id: 7, displayName: "Alice", username: "alice" },
							{ id: 10, displayName: "Dave", username: "dave" },
							{ id: 9, displayName: "Carol", username: "carol" },
						],
						version: 10,
					}),
				);
			render(<TrackerPage />);
			await waitFor(() => screen.getByTestId("tracker-row-CA-1"));

			openAssigneePicker();
			fireEvent.click(screen.getByRole("option", { name: /Bob/ }));
			fireEvent.click(screen.getByRole("option", { name: /Carol/ }));

			await waitFor(() =>
				expect(mockUpdateWorkItem).toHaveBeenCalledWith(7, "CA-1", {
					assigneeIds: [7, 8],
					version: 5,
				}),
			);
			resolveFirst?.();

			await waitFor(() =>
				expect(mockShowToast).toHaveBeenCalledWith(
					"Someone else updated this item first — refreshed.",
					"warning",
				),
			);
			await waitFor(() =>
				expect(mockListWorkItems).toHaveBeenCalledTimes(2),
			);
			await waitFor(() =>
				expect(mockUpdateWorkItem).toHaveBeenLastCalledWith(7, "CA-1", {
					assigneeIds: [7, 10, 9],
					version: 9,
				}),
			);
		});
	});
});

/** The Projects tab is where project cards live now. */
function showProjectsTab() {
	fireEvent.click(screen.getByRole("button", { name: /^Projects/ }));
}

function showItemsTab() {
	fireEvent.click(screen.getByRole("button", { name: /^Items/ }));
}

describe("TrackerPage items tab", () => {
	it("lists every item, project-assigned or not, and counts them all", async () => {
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
		mockListWorkItems.mockResolvedValueOnce([
			makeItem({ id: 1, key: "CA-1", title: "Loose task" }),
			inProjectItem({ id: 10, key: "CA-10", title: "Project task" }),
		]);
		render(<TrackerPage />);

		await waitFor(() => expect(screen.getByText("CA-1")).toBeTruthy());
		// The in-project item is on the same list, not hidden behind a search.
		expect(screen.getByText("CA-10")).toBeTruthy();
		// Toolbar total, group total and rows on screen describe one set.
		expect(screen.getByText("2 items")).toBeTruthy();
		const backlog = screen.getByTestId("toggle-section-Backlog");
		expect(within(backlog).getByText("2")).toBeTruthy();
	});

	it("marks an item's project with a chip and shows Set project for loose items", async () => {
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
		mockListWorkItems.mockResolvedValueOnce([
			makeItem({ id: 1, key: "CA-1", title: "Loose task" }),
			inProjectItem({ id: 10, key: "CA-10", title: "Project task" }),
		]);
		render(<TrackerPage />);

		await waitFor(() => screen.getByText("CA-10"));
		const projectRow = screen.getByTestId("tracker-row-CA-10").parentElement!;
		expect(
			within(projectRow).getByRole("button", { name: "Project: Rilis v2" }),
		).toBeTruthy();
		const looseRow = screen.getByTestId("tracker-row-CA-1").parentElement!;
		expect(
			within(looseRow).getByRole("button", { name: "Project: Set project" }),
		).toBeTruthy();
	});

	it("regroups by project without losing or duplicating an item", async () => {
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
		mockListWorkItems.mockResolvedValueOnce([
			makeItem({ id: 1, key: "CA-1", title: "Loose task" }),
			inProjectItem({ id: 10, key: "CA-10", title: "Project task" }),
		]);
		render(<TrackerPage />);
		await waitFor(() => screen.getByText("CA-10"));

		fireEvent.click(screen.getByRole("button", { name: /group by: status/i }));
		fireEvent.click(screen.getByRole("option", { name: /^Project$/ }));

		await waitFor(() =>
			expect(screen.getByTestId("toggle-section-Rilis v2")).toBeTruthy(),
		);
		expect(screen.getByTestId("toggle-section-No project")).toBeTruthy();
		expect(screen.getByText("CA-1")).toBeTruthy();
		expect(screen.getByText("CA-10")).toBeTruthy();
		expect(screen.getByText("2 items")).toBeTruthy();
		// Group header names the project, but the row chip still renders.
		const projectRow = screen.getByTestId("tracker-row-CA-10").parentElement!;
		expect(
			within(projectRow).getByRole("button", { name: "Project: Rilis v2" }),
		).toBeTruthy();
	});

	it("keeps an empty project visible when grouping by project", async () => {
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
		mockListWorkItems.mockResolvedValueOnce([
			makeItem({ id: 1, key: "CA-1", title: "Loose task" }),
		]);
		render(<TrackerPage />);
		await waitFor(() => screen.getByText("CA-1"));

		fireEvent.click(screen.getByRole("button", { name: /group by: status/i }));
		fireEvent.click(screen.getByRole("option", { name: /^Project$/ }));

		await waitFor(() =>
			expect(screen.getByTestId("toggle-section-Rilis v2")).toBeTruthy(),
		);
	});

	it("shows the empty state when nothing matches, even if a project name does", async () => {
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
		render(<TrackerPage />);
		await waitFor(() => screen.getByText("CA-1"));
		fireEvent.change(screen.getByPlaceholderText(/search tracker items/i), {
			target: { value: "rilis" },
		});
		// A project-name hit no longer suppresses the item empty state: the
		// Items tab has no project cards to point at.
		await waitFor(() =>
			expect(screen.getByText(/no items match/i)).toBeTruthy(),
		);
	});

	it("offers a create CTA when the workspace has no items at all", async () => {
		mockListWorkItems.mockResolvedValueOnce([]);
		render(<TrackerPage />);
		await waitFor(() =>
			expect(screen.getByText(/nothing tracked yet/i)).toBeTruthy(),
		);
		expect(
			screen.getByRole("button", { name: /create your first item/i }),
		).toBeTruthy();
	});

	it("surfaces a retry panel when the initial load fails", async () => {
		mockListWorkItems.mockRejectedValueOnce(new Error("network down"));
		render(<TrackerPage />);

		await waitFor(() =>
			expect(screen.getByText(/couldn't load the tracker/i)).toBeTruthy(),
		);
		expect(mockShowToast).toHaveBeenCalled();
		expect(mockShowToast.mock.calls[0]?.[1]).toBe("error");
		// Not the "nothing tracked yet" empty state — an empty page and a broken
		// page must not look the same.
		expect(screen.queryByText(/nothing tracked yet/i)).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: /try again/i }));
		await waitFor(() => expect(screen.getByText("CA-1")).toBeTruthy());
		expect(screen.queryByText(/couldn't load the tracker/i)).toBeNull();
	});

	it("keeps rows on screen when a background refresh fails", async () => {
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
		await waitFor(() => screen.getByText("CA-1"));

		mockListWorkItems.mockRejectedValueOnce(new Error("network down"));
		sseHandler?.({ type: "tracker.updated" });
		await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
		expect(screen.getByText("CA-1")).toBeTruthy();
		expect(screen.queryByText(/couldn't load the tracker/i)).toBeNull();
	});

	it("keeps collapsed groups collapsed across a tab switch", async () => {
		render(<TrackerPage />);
		await waitFor(() => screen.getByText("Done"));
		fireEvent.click(screen.getByTestId("toggle-section-Done"));
		expect(screen.queryByText("CA-2")).toBeNull();

		// Writing ?tab= mints a new location key; only a real re-navigation to
		// /tracker should clear collapse state.
		showProjectsTab();
		showItemsTab();
		await waitFor(() => screen.getByText("Done"));
		expect(screen.queryByText("CA-2")).toBeNull();
	});

	it("marks the active tab for assistive tech", async () => {
		render(<TrackerPage />);
		await waitFor(() => screen.getByText("Backlog"));
		expect(
			screen.getByRole("button", { name: /^Items/, current: "page" }),
		).toBeTruthy();

		showProjectsTab();
		expect(
			screen.getByRole("button", { name: /^Projects/, current: "page" }),
		).toBeTruthy();
	});

	it("keeps project cards off the items tab", async () => {
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
		render(<TrackerPage />);
		await waitFor(() => screen.getByText("CA-1"));
		expect(screen.queryByLabelText("Rilis v2")).toBeNull();

		showProjectsTab();
		await waitFor(() => expect(screen.getByLabelText("Rilis v2")).toBeTruthy());
	});

	it("shows Set project placeholder for items without a project", async () => {
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
		mockListWorkItems.mockResolvedValueOnce([
			makeItem({ id: 1, key: "CA-1", title: "Loose task" }),
		]);
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
		const row = screen.getByTestId("tracker-row-CA-1").parentElement!;
		expect(
			within(row).getByRole("button", { name: "Project: Set project" }),
		).toBeTruthy();
	});

	it("shows Set phase placeholder when project has no phase", async () => {
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
		mockListWorkItems.mockResolvedValueOnce([
			makeItem({
				id: 10,
				key: "TE-1",
				title: "Unphased task",
				projectId: P1,
				phaseId: null,
			}),
		]);
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-TE-1"));
		const row = screen.getByTestId("tracker-row-TE-1").parentElement!;
		expect(
			within(row).getByRole("button", { name: "Phase: Set phase" }),
		).toBeTruthy();
	});

	it("PATCHes project and phase together when selecting a phase", async () => {
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
		mockListWorkItems.mockResolvedValueOnce([
			makeItem({
				id: 3,
				key: "TE-3",
				title: "Phase me",
				projectId: P1,
				phaseId: null,
				version: 2,
			}),
		]);
		mockUpdateWorkItem.mockResolvedValue(
			makeItem({
				id: 3,
				key: "TE-3",
				title: "Phase me",
				projectId: P1,
				phaseId: Ph1,
				version: 3,
			}),
		);
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-TE-3"));
		const row = screen.getByTestId("tracker-row-TE-3").parentElement!;

		fireEvent.click(within(row).getByRole("button", { name: /Phase:/ }));
		fireEvent.click(screen.getByRole("option", { name: /Persiapan/ }));

		await waitFor(() =>
			expect(mockUpdateWorkItem).toHaveBeenCalledWith(7, "TE-3", {
				projectId: P1,
				phaseId: Ph1,
				version: 2,
			}),
		);
		await waitFor(() =>
			expect(
				within(row).getByRole("button", { name: "Phase: Persiapan" }),
			).toBeTruthy(),
		);
	});

	it("does not PATCH when re-picking the current phase", async () => {
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
		mockListWorkItems.mockResolvedValueOnce([
			inProjectItem({
				id: 3,
				key: "TE-3",
				title: "Phased task",
				version: 2,
			}),
		]);
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-TE-3"));
		const row = screen.getByTestId("tracker-row-TE-3").parentElement!;

		fireEvent.click(
			within(row).getByRole("button", { name: "Phase: Persiapan" }),
		);
		fireEvent.click(screen.getByRole("option", { name: /Persiapan/ }));

		expect(mockUpdateWorkItem).not.toHaveBeenCalled();
	});

	it("resets phase in one PATCH when changing project", async () => {
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject, projectB]);
		mockListWorkItems.mockResolvedValueOnce([
			inProjectItem({
				id: 3,
				key: "TE-3",
				title: "Move project",
				version: 2,
			}),
		]);
		mockUpdateWorkItem.mockResolvedValue(
			makeItem({
				id: 3,
				key: "TE-3",
				title: "Move project",
				projectId: P2,
				phaseId: null,
				version: 3,
			}),
		);
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-TE-3"));
		const row = screen.getByTestId("tracker-row-TE-3").parentElement!;

		fireEvent.click(
			within(row).getByRole("button", { name: "Project: Rilis v2" }),
		);
		fireEvent.click(screen.getByRole("option", { name: /Migrasi JSX/ }));

		await waitFor(() => expect(mockUpdateWorkItem).toHaveBeenCalledTimes(1));
		expect(mockUpdateWorkItem).toHaveBeenCalledWith(7, "TE-3", {
			projectId: P2,
			phaseId: null,
			version: 2,
		});
		await waitFor(() =>
			expect(
				within(row).getByRole("button", { name: "Phase: Set phase" }),
			).toBeTruthy(),
		);
	});

	it("does not PATCH when re-picking the current project", async () => {
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
		mockListWorkItems.mockResolvedValueOnce([
			inProjectItem({
				id: 3,
				key: "TE-3",
				title: "Stay put",
				version: 2,
			}),
		]);
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-TE-3"));
		const row = screen.getByTestId("tracker-row-TE-3").parentElement!;

		fireEvent.click(
			within(row).getByRole("button", { name: "Project: Rilis v2" }),
		);
		fireEvent.click(screen.getByRole("option", { name: /Rilis v2/ }));

		expect(mockUpdateWorkItem).not.toHaveBeenCalled();
		expect(
			within(row).getByRole("button", { name: "Phase: Persiapan" }),
		).toBeTruthy();
	});

	it("reverts to the original project after a rapid pick race resolves", async () => {
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject, projectB]);
		mockListWorkItems.mockResolvedValueOnce([
			inProjectItem({
				id: 3,
				key: "TE-3",
				title: "Race task",
				version: 2,
			}),
		]);
		let resolveFirst: ((item: WorkItem) => void) | undefined;
		mockUpdateWorkItem
			.mockImplementationOnce(
				() =>
					new Promise<WorkItem>((resolve) => {
						resolveFirst = resolve;
					}),
			)
			.mockResolvedValueOnce(
				makeItem({
					id: 3,
					key: "TE-3",
					title: "Race task",
					projectId: P1,
					phaseId: null,
					version: 4,
				}),
			);
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-TE-3"));
		const row = screen.getByTestId("tracker-row-TE-3").parentElement!;

		fireEvent.click(
			within(row).getByRole("button", { name: "Project: Rilis v2" }),
		);
		fireEvent.click(screen.getByRole("option", { name: /Migrasi JSX/ }));
		await waitFor(() => expect(mockUpdateWorkItem).toHaveBeenCalledTimes(1));

		fireEvent.click(
			within(row).getByRole("button", { name: "Project: Migrasi JSX" }),
		);
		fireEvent.click(screen.getByRole("option", { name: /Rilis v2/ }));
		expect(mockUpdateWorkItem).toHaveBeenCalledTimes(1);

		resolveFirst?.(
			makeItem({
				id: 3,
				key: "TE-3",
				title: "Race task",
				projectId: P2,
				phaseId: null,
				version: 3,
			}),
		);

		await waitFor(() => expect(mockUpdateWorkItem).toHaveBeenCalledTimes(2));
		expect(mockUpdateWorkItem).toHaveBeenLastCalledWith(7, "TE-3", {
			projectId: P1,
			phaseId: null,
			version: 3,
		});
	});

	it("shows No matches when a project has zero phases", async () => {
		mockListTrackerProjects.mockResolvedValueOnce([zeroPhaseProject]);
		mockListWorkItems.mockResolvedValueOnce([
			makeItem({
				id: 10,
				key: "TE-4",
				title: "Zero phase",
				projectId: zeroPhaseProject.id,
				phaseId: null,
			}),
		]);
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-TE-4"));
		const row = screen.getByTestId("tracker-row-TE-4").parentElement!;

		fireEvent.click(within(row).getByRole("button", { name: /Phase:/ }));
		const listbox = screen.getByRole("listbox", { name: "Set phase" });
		expect(within(listbox).getByText("No matches")).toBeTruthy();
		expect(within(listbox).queryAllByRole("option")).toHaveLength(0);
	});

	it("changes priority inline from the row glyph", async () => {
		mockListWorkItems.mockResolvedValueOnce([
			makeItem({
				id: 1,
				key: "TE-1",
				title: "Prioritize me",
				priority: priorities[0]!,
				version: 2,
			}),
		]);
		mockUpdateWorkItem.mockResolvedValue(
			makeItem({
				id: 1,
				key: "TE-1",
				title: "Prioritize me",
				priority: priorities[1]!,
				version: 3,
			}),
		);
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-TE-1"));
		const row = screen.getByTestId("tracker-row-TE-1").parentElement!;

		fireEvent.click(
			within(row).getByRole("button", { name: "Priority: High", hidden: true }),
		);
		fireEvent.click(screen.getByRole("option", { name: /^Low$/ }));

		await waitFor(() =>
			expect(mockUpdateWorkItem).toHaveBeenCalledWith(7, "TE-1", {
				priorityId: 11,
				version: 2,
			}),
		);
	});

	it('clears priority when selecting "No priority"', async () => {
		mockListWorkItems.mockResolvedValueOnce([
			makeItem({
				id: 1,
				key: "TE-1",
				title: "Clear priority",
				priority: priorities[0]!,
				version: 2,
			}),
		]);
		mockUpdateWorkItem.mockResolvedValue(
			makeItem({
				id: 1,
				key: "TE-1",
				title: "Clear priority",
				priority: null,
				version: 3,
			}),
		);
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-TE-1"));
		const row = screen.getByTestId("tracker-row-TE-1").parentElement!;

		fireEvent.click(
			within(row).getByRole("button", { name: "Priority: High", hidden: true }),
		);
		fireEvent.click(screen.getByRole("option", { name: /^No priority$/ }));

		await waitFor(() =>
			expect(mockUpdateWorkItem).toHaveBeenCalledWith(7, "TE-1", {
				priorityId: null,
				version: 2,
			}),
		);
	});

	it("does not PATCH when re-picking the current priority", async () => {
		mockListWorkItems.mockResolvedValueOnce([
			makeItem({
				id: 1,
				key: "TE-1",
				title: "Stay high",
				priority: priorities[0]!,
				version: 2,
			}),
		]);
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-TE-1"));
		const row = screen.getByTestId("tracker-row-TE-1").parentElement!;

		fireEvent.click(
			within(row).getByRole("button", { name: "Priority: High", hidden: true }),
		);
		fireEvent.click(screen.getByRole("option", { name: /^High$/ }));

		expect(mockUpdateWorkItem).not.toHaveBeenCalled();
	});

	it("re-picks the original priority after an in-flight change settles", async () => {
		mockListWorkItems.mockResolvedValueOnce([
			makeItem({
				id: 1,
				key: "TE-1",
				title: "Priority race",
				priority: priorities[0]!,
				version: 2,
			}),
		]);
		let resolveFirst: ((item: WorkItem) => void) | undefined;
		mockUpdateWorkItem
			.mockImplementationOnce(
				() =>
					new Promise<WorkItem>((resolve) => {
						resolveFirst = resolve;
					}),
			)
			.mockResolvedValueOnce(
				makeItem({
					id: 1,
					key: "TE-1",
					title: "Priority race",
					priority: priorities[0]!,
					version: 4,
				}),
			);
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-TE-1"));
		const row = screen.getByTestId("tracker-row-TE-1").parentElement!;

		fireEvent.click(
			within(row).getByRole("button", { name: "Priority: High", hidden: true }),
		);
		fireEvent.click(screen.getByRole("option", { name: /^Low$/ }));
		await waitFor(() => expect(mockUpdateWorkItem).toHaveBeenCalledTimes(1));

		fireEvent.click(
			within(row).getByRole("button", { name: "Priority: Low", hidden: true }),
		);
		fireEvent.click(screen.getByRole("option", { name: /^High$/ }));
		expect(mockUpdateWorkItem).toHaveBeenCalledTimes(1);

		resolveFirst?.(
			makeItem({
				id: 1,
				key: "TE-1",
				title: "Priority race",
				priority: priorities[1]!,
				version: 3,
			}),
		);

		await waitFor(() => expect(mockUpdateWorkItem).toHaveBeenCalledTimes(2));
		expect(mockUpdateWorkItem).toHaveBeenLastCalledWith(7, "TE-1", {
			priorityId: 10,
			version: 3,
		});
	});

	it("auto-uncollapses the destination priority group after a priority change", async () => {
		mockListWorkItems.mockResolvedValueOnce([
			makeItem({
				id: 1,
				key: "TE-1",
				title: "Move priority",
				priority: priorities[0]!,
				version: 2,
			}),
			makeItem({
				id: 2,
				key: "TE-2",
				title: "Already low",
				priority: priorities[1]!,
				version: 1,
			}),
		]);
		mockUpdateWorkItem.mockResolvedValue(
			makeItem({
				id: 1,
				key: "TE-1",
				title: "Move priority",
				priority: priorities[1]!,
				version: 3,
			}),
		);
		render(<TrackerPage />);
		await waitFor(() => screen.getByText("TE-1"));

		fireEvent.click(screen.getByRole("button", { name: /group by: status/i }));
		fireEvent.click(screen.getByRole("option", { name: /^Priority$/ }));
		await waitFor(() =>
			expect(screen.getByTestId("toggle-section-Low")).toBeTruthy(),
		);

		fireEvent.click(screen.getByTestId("toggle-section-Low"));
		expect(screen.queryByText("TE-2")).toBeNull();
		expect(screen.getByText("TE-1")).toBeTruthy();

		const row = screen.getByTestId("tracker-row-TE-1").parentElement!;
		fireEvent.click(
			within(row).getByRole("button", { name: "Priority: High", hidden: true }),
		);
		fireEvent.click(screen.getByRole("option", { name: /^Low$/ }));

		await waitFor(() => expect(mockUpdateWorkItem).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(screen.getByText("TE-2")).toBeTruthy());
		await waitFor(() => expect(screen.getByText("TE-1")).toBeTruthy());
	});

	it("queues priority change after project change with fresh version", async () => {
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject, projectB]);
		mockListWorkItems.mockResolvedValueOnce([
			inProjectItem({
				id: 5,
				key: "TE-5",
				title: "Cross field",
				priority: priorities[0]!,
				version: 4,
			}),
		]);
		let resolveProject: ((item: WorkItem) => void) | undefined;
		mockUpdateWorkItem
			.mockImplementationOnce(
				() =>
					new Promise<WorkItem>((resolve) => {
						resolveProject = resolve;
					}),
			)
			.mockResolvedValueOnce(
				inProjectItem({
					id: 5,
					key: "TE-5",
					title: "Cross field",
					projectId: P2,
					phaseId: null,
					priority: priorities[1]!,
					version: 6,
				}),
			);
		render(<TrackerPage />);
		await waitFor(() => screen.getByTestId("tracker-row-TE-5"));
		const row = screen.getByTestId("tracker-row-TE-5").parentElement!;

		fireEvent.click(
			within(row).getByRole("button", { name: "Project: Rilis v2" }),
		);
		fireEvent.click(screen.getByRole("option", { name: /Migrasi JSX/ }));

		fireEvent.click(
			within(row).getByRole("button", { name: "Priority: High", hidden: true }),
		);
		fireEvent.click(screen.getByRole("option", { name: /^Low$/ }));

		await waitFor(() => expect(mockUpdateWorkItem).toHaveBeenCalledTimes(1));
		expect(mockUpdateWorkItem).toHaveBeenCalledWith(7, "TE-5", {
			projectId: P2,
			phaseId: null,
			version: 4,
		});

		resolveProject?.(
			inProjectItem({
				id: 5,
				key: "TE-5",
				title: "Cross field",
				projectId: P2,
				phaseId: null,
				priority: priorities[0]!,
				version: 5,
			}),
		);

		await waitFor(() => expect(mockUpdateWorkItem).toHaveBeenCalledTimes(2));
		expect(mockUpdateWorkItem).toHaveBeenLastCalledWith(7, "TE-5", {
			priorityId: 11,
			version: 5,
		});
	});

	it("auto-uncollapses the destination project group after a project change", async () => {
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject, projectB]);
		mockListWorkItems.mockResolvedValueOnce([
			inProjectItem({
				id: 3,
				key: "TE-3",
				title: "Move groups",
				version: 2,
			}),
			inProjectItem({
				id: 11,
				key: "CA-11",
				title: "Already in P2",
				projectId: P2,
				phaseId: 12,
			}),
		]);
		mockUpdateWorkItem.mockResolvedValue(
			makeItem({
				id: 3,
				key: "TE-3",
				title: "Move groups",
				projectId: P2,
				phaseId: null,
				version: 3,
			}),
		);
		render(<TrackerPage />);
		await waitFor(() => screen.getByText("TE-3"));

		fireEvent.click(screen.getByRole("button", { name: /group by: status/i }));
		fireEvent.click(screen.getByRole("option", { name: /^Project$/ }));
		await waitFor(() =>
			expect(screen.getByTestId("toggle-section-Migrasi JSX")).toBeTruthy(),
		);

		fireEvent.click(screen.getByTestId("toggle-section-Migrasi JSX"));
		expect(screen.queryByText("CA-11")).toBeNull();
		expect(screen.getByText("TE-3")).toBeTruthy();

		const row = screen.getByTestId("tracker-row-TE-3").parentElement!;
		fireEvent.click(
			within(row).getByRole("button", { name: "Project: Rilis v2" }),
		);
		fireEvent.click(screen.getByRole("option", { name: /Migrasi JSX/ }));

		await waitFor(() => expect(mockUpdateWorkItem).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(screen.getByText("CA-11")).toBeTruthy());
		await waitFor(() => expect(screen.getByText("TE-3")).toBeTruthy());
	});
});

describe("TrackerPage projects", () => {
	it("shows a create CTA on the projects tab when none exist", async () => {
		render(<TrackerPage />);
		await waitFor(() => expect(screen.getByText("Backlog")).toBeTruthy());
		showProjectsTab();
		expect(screen.getByText(/no projects yet/i)).toBeTruthy();
		expect(
			screen.getByRole("button", { name: /create your first project/i }),
		).toBeTruthy();
	});

	it("opens the project modal, creates a project and shows the card without a manual refresh", async () => {
		mockListTrackerProjects
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([releaseProject]);
		mockCreateTrackerProject.mockResolvedValue(releaseProject);
		render(<TrackerPage />);
		await waitFor(() => screen.getByText("Backlog"));
		showProjectsTab();
		fireEvent.click(screen.getByRole("button", { name: /^new project$/i }));
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
		showProjectsTab();
		fireEvent.click(screen.getByRole("button", { name: /^new project$/i }));
		const modal = within(screen.getByRole("dialog"));
		fireEvent.click(modal.getByRole("button", { name: /create project/i }));
		expect(await modal.findByText("Name is required")).toBeTruthy();
		expect(screen.getByRole("dialog")).toBeTruthy();
	});

	it("shows name, percentage, task count and an overdue marker on a project card", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime(new Date("2026-10-05T12:00:00"));
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
		mockListWorkItems.mockResolvedValueOnce([
			inProjectItem({ id: 10, key: "CA-10", status: statuses[2]! }),
			inProjectItem({
				id: 11,
				key: "CA-11",
				status: statuses[1]!,
				endDate: "2026-09-20",
			}),
		]);
		render(<TrackerPage />);
		showProjectsTab();
		await waitFor(() => screen.getByText("Rilis v2"));
		expect(screen.getByText("50%")).toBeTruthy();
		expect(screen.getByText(/2 tasks/i)).toBeTruthy();
		expect(screen.getByLabelText(/overdue/i)).toBeTruthy();
	});

	it("filters project cards by name and reports the count", async () => {
		mockListTrackerProjects.mockResolvedValueOnce([
			releaseProject,
			{ ...releaseProject, id: 2, name: "Migrasi JSX", phases: [] },
		]);
		render(<TrackerPage />);
		showProjectsTab();
		await waitFor(() => expect(screen.getByText("2 projects")).toBeTruthy());
		fireEvent.change(screen.getByPlaceholderText(/search projects/i), {
			target: { value: "migrasi" },
		});
		await waitFor(() => expect(screen.getByText("1 project")).toBeTruthy());
		expect(screen.queryByText("Rilis v2")).toBeNull();
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
		showProjectsTab();
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
		sseHandler?.({ type: "tracker.project.created" });
		await waitFor(() => expect(screen.getByText("Rilis v2")).toBeTruthy());
	});

	it("drops the card and the item's chip on tracker.project.deleted", async () => {
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
		mockListWorkItems.mockResolvedValueOnce([
			inProjectItem({ id: 10, key: "CA-10", title: "Ship realtime sync" }),
		]);
		render(<TrackerPage />);
		await waitFor(() =>
			expect(screen.getByTestId("row-inline-project-CA-10")).toBeTruthy(),
		);

		mockListTrackerProjects.mockResolvedValueOnce([]);
		mockListWorkItems.mockResolvedValueOnce([
			makeItem({
				id: 10,
				key: "CA-10",
				title: "Ship realtime sync",
				projectId: null,
				phaseId: null,
			}),
		]);
		sseHandler?.({ type: "tracker.project.deleted" });
		// The item never left the list — only its project marker reverts to placeholder.
		await waitFor(() =>
			expect(
				within(
					screen.getByTestId("tracker-row-CA-10").parentElement!,
				).getByRole("button", { name: "Project: Set project" }),
			).toBeTruthy(),
		);
		expect(screen.getByText("CA-10")).toBeTruthy();

		showProjectsTab();
		await waitFor(() => expect(screen.queryByLabelText("Rilis v2")).toBeNull());
	});

	it("keeps the projects tab mounted when items are empty during a refresh", async () => {
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
		mockListWorkItems.mockResolvedValueOnce([]);
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
		render(<TrackerPage />);
		showProjectsTab();
		await waitFor(() => expect(screen.getByLabelText("Rilis v2")).toBeTruthy());

		let resolveItems: (value: WorkItem[]) => void = () => {};
		mockListWorkItems.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveItems = resolve;
				}),
		);
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
		sseHandler?.({ type: "tracker.project.updated" });
		expect(screen.queryByText("Loading…")).toBeNull();
		expect(screen.getByLabelText("Rilis v2")).toBeTruthy();
		resolveItems([]);
		await waitFor(() => expect(screen.getByLabelText("Rilis v2")).toBeTruthy());
	});

	describe("auxiliary labels and members loading", () => {
		it("does not show empty-state copy while labels and members are loading", async () => {
			let resolveLabels: (value: TrackerVocabulary[]) => void = () => {};
			let resolveMembers: (value: { members: never[] }) => void = () => {};
			mockListTrackerVocabularies.mockImplementation(
				(_wsId: number, kind?: string) => {
					if (kind === "priority") return Promise.resolve(priorities);
					if (kind === "label") {
						return new Promise((resolve) => {
							resolveLabels = resolve;
						});
					}
					return Promise.resolve(statuses);
				},
			);
			mockGetWorkspaceMembers.mockImplementation(
				() =>
					new Promise((resolve) => {
						resolveMembers = resolve;
					}),
			);

			render(<TrackerPage />);
			await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
			expect(screen.getAllByText("Loading labels…").length).toBeGreaterThan(0);
			expect(screen.getAllByText("Loading members…").length).toBeGreaterThan(0);
			expect(screen.queryByText("No labels in this workspace")).toBeNull();
			expect(screen.queryByText("No members in this workspace")).toBeNull();

			resolveLabels([]);
			resolveMembers({ members: [] });
		});

		it("fetches labels with workspace id and label kind", async () => {
			render(<TrackerPage />);
			await waitFor(() => screen.getByText("CA-1"));
			await waitFor(() =>
				expect(mockListTrackerVocabularies).toHaveBeenCalledWith(7, "label"),
			);
			const row = screen.getByTestId("tracker-row-CA-1").parentElement!;
			fireEvent.click(within(row).getByRole("button", { name: "Labels" }));
			await waitFor(() =>
				expect(screen.getByRole("option", { name: "Bug" })).toBeTruthy(),
			);
		});

		it("keeps rows visible when labels fetch fails", async () => {
			mockListTrackerVocabularies.mockImplementation(
				(_wsId: number, kind?: string) => {
					if (kind === "priority") return Promise.resolve(priorities);
					if (kind === "label") return Promise.reject(new Error("labels down"));
					return Promise.resolve(statuses);
				},
			);
			render(<TrackerPage />);
			await waitFor(() => screen.getByText("CA-1"));
			expect(screen.queryByText(/couldn't load the tracker/i)).toBeNull();
			await waitFor(() =>
				expect(
					screen.getAllByText("Labels unavailable").length,
				).toBeGreaterThan(0),
			);
			expect(screen.queryByText("No labels in this workspace")).toBeNull();
		});

		it("keeps rows visible when members fetch fails", async () => {
			mockGetWorkspaceMembers.mockRejectedValueOnce(new Error("members down"));
			render(<TrackerPage />);
			await waitFor(() => screen.getByText("CA-1"));
			expect(screen.queryByText(/couldn't load the tracker/i)).toBeNull();
			await waitFor(() =>
				expect(
					screen.getAllByText("Members unavailable").length,
				).toBeGreaterThan(0),
			);
			expect(screen.queryByText("No members in this workspace")).toBeNull();
		});

		it("ignores stale labels and members from an older load sequence", async () => {
			let refreshCallback: (() => void) | undefined;
			mockUseBoard.mockReturnValue({
				activeWorkspaceId: 7,
				subscribeTrackerEvents: vi.fn(() => () => {}),
				registerRefreshTrackerList: vi.fn((cb: (() => void) | null) => {
					refreshCallback = cb ?? undefined;
				}),
				refreshTrackerList: vi.fn(),
				showToast: mockShowToast,
			});

			let resolveFirstLabels: (value: TrackerVocabulary[]) => void;
			let resolveFirstMembers: (value: {
				members: Array<{
					userId: number;
					username: string;
					displayName: string;
					role: string;
				}>;
			}) => void;
			let resolveSecondLabels: (value: TrackerVocabulary[]) => void;
			let resolveSecondMembers: (value: {
				members: Array<{
					userId: number;
					username: string;
					displayName: string;
					role: string;
				}>;
			}) => void;

			let labelCallCount = 0;
			let memberCallCount = 0;

			mockListTrackerVocabularies.mockImplementation(
				(_wsId: number, kind?: string) => {
					if (kind === "priority") return Promise.resolve(priorities);
					if (kind === "label") {
						labelCallCount += 1;
						if (labelCallCount === 1) {
							return new Promise((resolve) => {
								resolveFirstLabels = resolve;
							});
						}
						return new Promise((resolve) => {
							resolveSecondLabels = resolve;
						});
					}
					return Promise.resolve(statuses);
				},
			);
			mockGetWorkspaceMembers.mockImplementation(() => {
				memberCallCount += 1;
				if (memberCallCount === 1) {
					return new Promise((resolve) => {
						resolveFirstMembers = resolve;
					});
				}
				return new Promise((resolve) => {
					resolveSecondMembers = resolve;
				});
			});

			render(<TrackerPage />);
			await waitFor(() => screen.getByText("CA-1"));

			refreshCallback?.();
			await waitFor(() => expect(labelCallCount).toBe(2));

			const sequenceBLabel: TrackerVocabulary = {
				id: 100,
				kind: "label",
				name: "Sequence-B-Label",
				position: 1000,
				colour: "oklch(0.7 0.1 260)",
			};
			const sequenceAMember = {
				userId: 88,
				username: "stale",
				displayName: "Sequence-A-Member",
				role: "member",
			};
			const sequenceBMember = {
				userId: 99,
				username: "fresh",
				displayName: "Sequence-B-Member",
				role: "member",
			};

			resolveSecondLabels!([sequenceBLabel]);
			resolveSecondMembers!({ members: [sequenceBMember] });
			const row = screen.getByTestId("tracker-row-CA-1").parentElement!;
			await waitFor(() =>
				expect(within(row).queryByText("Loading labels…")).toBeNull(),
			);
			await waitFor(() =>
				expect(within(row).queryByText("Loading members…")).toBeNull(),
			);
			fireEvent.click(within(row).getByRole("button", { name: "Labels" }));
			await waitFor(() =>
				expect(
					screen.getByRole("option", { name: "Sequence-B-Label" }),
				).toBeTruthy(),
			);
			fireEvent.keyDown(
				screen.getByRole("combobox", { name: "Change or add labels…" }),
				{ key: "Escape" },
			);
			fireEvent.click(within(row).getByRole("button", { name: "Assignees" }));
			await waitFor(() =>
				expect(
					screen.getByRole("option", { name: /Sequence-B-Member/ }),
				).toBeTruthy(),
			);
			fireEvent.keyDown(screen.getByRole("combobox", { name: "Assign to…" }), {
				key: "Escape",
			});

			resolveFirstLabels!([
				{
					id: 200,
					kind: "label",
					name: "Sequence-A-Label",
					position: 1000,
					colour: "oklch(0.7 0.1 15)",
				},
			]);
			resolveFirstMembers!({ members: [sequenceAMember] });

			await act(async () => {
				await Promise.resolve();
			});

			fireEvent.click(within(row).getByRole("button", { name: "Labels" }));
			await waitFor(() =>
				expect(
					screen.getByRole("option", { name: "Sequence-B-Label" }),
				).toBeTruthy(),
			);
			expect(
				screen.queryByRole("option", { name: "Sequence-A-Label" }),
			).toBeNull();
			fireEvent.keyDown(
				screen.getByRole("combobox", { name: "Change or add labels…" }),
				{ key: "Escape" },
			);
			fireEvent.click(within(row).getByRole("button", { name: "Assignees" }));
			await waitFor(() =>
				expect(
					screen.getByRole("option", { name: /Sequence-B-Member/ }),
				).toBeTruthy(),
			);
			expect(
				screen.queryByRole("option", { name: /Sequence-A-Member/ }),
			).toBeNull();
		});

		it("clears labels and members when switching workspace", async () => {
			const workspaceALabel: TrackerVocabulary = {
				id: 3,
				kind: "label",
				name: "Workspace-A-Label",
				position: 1000,
				colour: "oklch(0.7 0.1 260)",
			};
			const workspaceBLabel: TrackerVocabulary = {
				id: 4,
				kind: "label",
				name: "Workspace-B-Label",
				position: 1000,
				colour: "oklch(0.7 0.1 15)",
			};
			const workspaceAMember = {
				userId: 7,
				username: "alice-a",
				displayName: "Workspace-A-Member",
				role: "member",
			};
			const workspaceBMember = {
				userId: 8,
				username: "bob-b",
				displayName: "Workspace-B-Member",
				role: "member",
			};

			let resolveWorkspaceALabels: (value: TrackerVocabulary[]) => void;
			let resolveWorkspaceBLabels: (value: TrackerVocabulary[]) => void;
			let resolveWorkspaceAMembers: (value: {
				members: (typeof workspaceAMember)[];
			}) => void;
			let resolveWorkspaceBMembers: (value: {
				members: (typeof workspaceBMember)[];
			}) => void;

			mockListTrackerVocabularies.mockImplementation(
				(wsId: number, kind?: string) => {
					if (kind === "priority") return Promise.resolve(priorities);
					if (kind === "label") {
						if (wsId === 7) {
							return new Promise((resolve) => {
								resolveWorkspaceALabels = resolve;
							});
						}
						return new Promise((resolve) => {
							resolveWorkspaceBLabels = resolve;
						});
					}
					return Promise.resolve(statuses);
				},
			);
			mockGetWorkspaceMembers.mockImplementation((wsId: number) => {
				if (wsId === 7) {
					return new Promise((resolve) => {
						resolveWorkspaceAMembers = resolve;
					});
				}
				return new Promise((resolve) => {
					resolveWorkspaceBMembers = resolve;
				});
			});

			mockUseBoard.mockReturnValue({
				activeWorkspaceId: 7,
				subscribeTrackerEvents: vi.fn(() => () => {}),
				registerRefreshTrackerList: vi.fn(),
				refreshTrackerList: vi.fn(),
				showToast: mockShowToast,
			});

			const { rerender } = render(<TrackerPage />);
			await waitFor(() => screen.getByText("CA-1"));

			mockUseBoard.mockReturnValue({
				activeWorkspaceId: 8,
				subscribeTrackerEvents: vi.fn(() => () => {}),
				registerRefreshTrackerList: vi.fn(),
				refreshTrackerList: vi.fn(),
				showToast: mockShowToast,
			});
			rerender(<TrackerPage />);
			await waitFor(() => screen.getByText("CA-1"));

			expect(screen.getAllByText("Loading labels…").length).toBeGreaterThan(0);
			expect(screen.getAllByText("Loading members…").length).toBeGreaterThan(0);

			resolveWorkspaceALabels!([workspaceALabel]);
			resolveWorkspaceAMembers!({ members: [workspaceAMember] });

			await act(async () => {
				await Promise.resolve();
			});

			expect(screen.getAllByText("Loading labels…").length).toBeGreaterThan(0);
			expect(screen.getAllByText("Loading members…").length).toBeGreaterThan(0);

			resolveWorkspaceBLabels!([workspaceBLabel]);
			resolveWorkspaceBMembers!({ members: [workspaceBMember] });
			const row = screen.getByTestId("tracker-row-CA-1").parentElement!;
			await waitFor(() =>
				expect(within(row).queryByText("Loading labels…")).toBeNull(),
			);
			await waitFor(() =>
				expect(within(row).queryByText("Loading members…")).toBeNull(),
			);
			fireEvent.click(within(row).getByRole("button", { name: "Labels" }));
			await waitFor(() =>
				expect(
					screen.getByRole("option", { name: "Workspace-B-Label" }),
				).toBeTruthy(),
			);
			fireEvent.keyDown(
				screen.getByRole("combobox", { name: "Change or add labels…" }),
				{ key: "Escape" },
			);
			fireEvent.click(within(row).getByRole("button", { name: "Assignees" }));
			await waitFor(() =>
				expect(
					screen.getByRole("option", { name: /Workspace-B-Member/ }),
				).toBeTruthy(),
			);
		});
	});

	it("ignores a stale failed load when a newer refresh already succeeded", async () => {
		let resolveStale: (reason?: unknown) => void = () => {};
		let resolveFresh: (value: WorkItem[]) => void = () => {};
		mockListWorkItems
			.mockResolvedValueOnce([makeItem({ id: 1, key: "CA-1" })])
			.mockImplementationOnce(
				() =>
					new Promise((_, reject) => {
						resolveStale = reject;
					}),
			)
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveFresh = resolve;
					}),
			);
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
		await waitFor(() => screen.getByText("CA-1"));

		sseHandler?.({ type: "tracker.updated" });
		sseHandler?.({ type: "tracker.updated" });
		resolveFresh([makeItem({ id: 1, key: "CA-1", title: "Fresh title" })]);
		await waitFor(() => expect(screen.getByText("Fresh title")).toBeTruthy());

		resolveStale(new Error("network down"));
		await waitFor(() => expect(screen.getByText("Fresh title")).toBeTruthy());
		expect(mockShowToast).not.toHaveBeenCalled();
		expect(screen.queryByText(/couldn't load the tracker/i)).toBeNull();
	});
});
