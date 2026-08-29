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

let locationKeySeq = 0;

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
		expect(screen.getByText("Feature")).toBeTruthy();
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

	it("sets both dates from the row date popover", async () => {
		mockListTrackerItems.mockResolvedValueOnce([
			makeItem({
				id: 4,
				key: "TE-4",
				title: "Schedule me",
				startDate: null,
				endDate: null,
				version: 3,
			}),
		]);
		mockUpdateTrackerItem.mockResolvedValue(
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
			expect(mockUpdateTrackerItem).toHaveBeenCalledWith(7, "TE-4", {
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
		mockListTrackerItems.mockResolvedValueOnce([
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

		expect(mockUpdateTrackerItem).not.toHaveBeenCalled();
	});

	it("reverts the date and refetches after a version conflict", async () => {
		mockListTrackerItems.mockResolvedValueOnce([
			makeItem({
				id: 4,
				key: "TE-4",
				title: "Schedule me",
				startDate: null,
				endDate: null,
				version: 3,
			}),
		]);
		mockUpdateTrackerItem.mockRejectedValueOnce(
			new ApiError("conflict", 409, "version_conflict"),
		);
		mockListTrackerItems.mockResolvedValueOnce([
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
		await waitFor(() => expect(mockListTrackerItems).toHaveBeenCalledTimes(2));
		expect(screen.getByLabelText("Date: Set date")).toBeTruthy();
	});

	it("commits an edited date draft before opening the status picker", async () => {
		mockListTrackerItems.mockResolvedValueOnce([
			makeItem({
				id: 4,
				key: "TE-4",
				title: "Schedule me",
				startDate: null,
				endDate: null,
				version: 3,
			}),
		]);
		mockUpdateTrackerItem.mockResolvedValue(
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

		await waitFor(() =>
			expect(mockUpdateTrackerItem).toHaveBeenCalledTimes(1),
		);
		expect(mockUpdateTrackerItem).toHaveBeenCalledWith(7, "TE-4", {
			startDate: "2026-08-06",
			endDate: "2026-08-26",
			version: 3,
		});
		expect(screen.getByRole("option", { name: /In Progress/ })).toBeTruthy();
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

	it("processes three rapid status picks in order", async () => {
		const pending: Array<() => void> = [];
		let version = 1;
		mockUpdateTrackerItem.mockImplementation(
			(_ws, _key, patch) =>
				new Promise<TrackerItem>((resolve) => {
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

		await waitFor(() => expect(mockUpdateTrackerItem).toHaveBeenCalledTimes(1));
		pending.shift()?.();
		await waitFor(() => expect(mockUpdateTrackerItem).toHaveBeenCalledTimes(2));
		pending.shift()?.();
		await waitFor(() => expect(mockUpdateTrackerItem).toHaveBeenCalledTimes(3));
		pending.shift()?.();

		expect(mockUpdateTrackerItem.mock.calls[0]?.[2]).toEqual({
			statusId: 6,
			version: 1,
		});
		expect(mockUpdateTrackerItem.mock.calls[1]?.[2]).toEqual({
			statusId: 2,
			version: 2,
		});
		expect(mockUpdateTrackerItem.mock.calls[2]?.[2]).toEqual({
			statusId: 5,
			version: 3,
		});
		await waitFor(() =>
			expect(screen.getByLabelText("Done, CA-1")).toBeTruthy(),
		);
	});

	it("processes a queued status pick after 409 once refresh succeeds", async () => {
		mockUpdateTrackerItem
			.mockRejectedValueOnce(
				new ApiError("conflict", 409, "version_conflict"),
			)
			.mockResolvedValueOnce(
				makeItem({ id: 1, key: "CA-1", status: statuses[2]!, version: 6 }),
			);
		mockListTrackerItems
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
		await waitFor(() => expect(mockUpdateTrackerItem).toHaveBeenCalledTimes(2));
		expect(mockUpdateTrackerItem).toHaveBeenLastCalledWith(7, "CA-1", {
			statusId: 5,
			version: 5,
		});
		await waitFor(() =>
			expect(screen.getByLabelText("Done, CA-1")).toBeTruthy(),
		);
	});

	it("skips a queued status pick when 409 recovery refresh fails", async () => {
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
		mockUpdateTrackerItem.mockRejectedValueOnce(
			new ApiError("conflict", 409, "version_conflict"),
		);
		mockListTrackerItems
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
		expect(mockUpdateTrackerItem).toHaveBeenCalledTimes(1);
		expect(screen.getByLabelText("Backlog, CA-1")).toBeTruthy();

		mockListTrackerItems.mockResolvedValueOnce([
			makeItem({ id: 1, key: "CA-1", title: "Workspace Rename", version: 5 }),
			makeItem({
				id: 2,
				key: "CA-2",
				title: "Done task",
				status: statuses[2]!,
				labels: [],
			}),
		]);
		mockUpdateTrackerItem.mockResolvedValueOnce(
			makeItem({ id: 1, key: "CA-1", status: statuses[1]!, version: 6 }),
		);
		sseHandler?.({ type: "tracker.updated" });
		await waitFor(() => screen.getByLabelText("Backlog, CA-1"));

		fireEvent.click(statusTrigger());
		fireEvent.click(screen.getByRole("option", { name: /In Progress/ }));
		await waitFor(() => expect(mockUpdateTrackerItem).toHaveBeenCalledTimes(2));
		await waitFor(() =>
			expect(screen.getByLabelText("In Progress, CA-1")).toBeTruthy(),
		);
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
			screen.getByRole("button", { name: /^New item$/ }),
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
			screen.getByRole("button", { name: /^New item$/ }),
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
			screen.getByRole("button", { name: /^New item$/ }),
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
		mockListTrackerItems.mockResolvedValueOnce([
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

	it("marks an item's project with a chip and leaves loose items unmarked", async () => {
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
		mockListTrackerItems.mockResolvedValueOnce([
			makeItem({ id: 1, key: "CA-1", title: "Loose task" }),
			inProjectItem({ id: 10, key: "CA-10", title: "Project task" }),
		]);
		render(<TrackerPage />);

		await waitFor(() => screen.getByText("CA-10"));
		expect(screen.getByTestId("row-project-CA-10").textContent).toBe(
			"Rilis v2",
		);
		expect(screen.queryByTestId("row-project-CA-1")).toBeNull();
	});

	it("regroups by project without losing or duplicating an item", async () => {
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
		mockListTrackerItems.mockResolvedValueOnce([
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
		// The group header already names the project, so the chip stands down.
		expect(screen.queryByTestId("row-project-CA-10")).toBeNull();
	});

	it("keeps an empty project visible when grouping by project", async () => {
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
		mockListTrackerItems.mockResolvedValueOnce([
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
		mockListTrackerItems.mockResolvedValueOnce([]);
		render(<TrackerPage />);
		await waitFor(() =>
			expect(screen.getByText(/nothing tracked yet/i)).toBeTruthy(),
		);
		expect(
			screen.getByRole("button", { name: /create your first item/i }),
		).toBeTruthy();
	});

	it("surfaces a retry panel when the initial load fails", async () => {
		mockListTrackerItems.mockRejectedValueOnce(new Error("network down"));
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

		mockListTrackerItems.mockRejectedValueOnce(new Error("network down"));
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
		mockListTrackerItems.mockResolvedValueOnce([
			inProjectItem({ id: 10, key: "CA-10", title: "Ship realtime sync" }),
		]);
		render(<TrackerPage />);
		await waitFor(() =>
			expect(screen.getByTestId("row-project-CA-10")).toBeTruthy(),
		);

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
		// The item never left the list — only its project marker did.
		await waitFor(() =>
			expect(screen.queryByTestId("row-project-CA-10")).toBeNull(),
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
		mockListTrackerItems.mockResolvedValueOnce([]);
		mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
		render(<TrackerPage />);
		showProjectsTab();
		await waitFor(() => expect(screen.getByLabelText("Rilis v2")).toBeTruthy());

		let resolveItems: (value: TrackerItem[]) => void = () => {};
		mockListTrackerItems.mockImplementationOnce(
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

	it("ignores a stale failed load when a newer refresh already succeeded", async () => {
		let resolveStale: (reason?: unknown) => void = () => {};
		let resolveFresh: (value: TrackerItem[]) => void = () => {};
		mockListTrackerItems
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
