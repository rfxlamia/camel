// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockGetTrackerItem,
	mockUpdateTrackerItem,
	mockGetTrackerChangelog,
	mockListVocabularies,
	mockListTrackerProjects,
	mockGetWorkspaceMembers,
	mockNavigate,
	mockUseBoard,
	mockShowToast,
} = vi.hoisted(() => ({
	mockGetTrackerItem: vi.fn(),
	mockUpdateTrackerItem: vi.fn(),
	mockGetTrackerChangelog: vi.fn(),
	mockListVocabularies: vi.fn(),
	mockListTrackerProjects: vi.fn(),
	mockGetWorkspaceMembers: vi.fn(),
	mockNavigate: vi.fn(),
	mockUseBoard: vi.fn(),
	mockShowToast: vi.fn(),
}));

vi.mock("../api", () => ({
	api: {
		getTrackerItem: (...a: unknown[]) => mockGetTrackerItem(...a),
		updateTrackerItem: (...a: unknown[]) => mockUpdateTrackerItem(...a),
		getTrackerChangelog: (...a: unknown[]) => mockGetTrackerChangelog(...a),
		listTrackerVocabularies: (...a: unknown[]) => mockListVocabularies(...a),
		listTrackerProjects: (...a: unknown[]) => mockListTrackerProjects(...a),
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

vi.mock("react-router", () => ({
	useNavigate: () => mockNavigate,
	useParams: () => ({ key: "CA-42" }),
}));

import { ApiError } from "../api";
import type { TrackerPhase, TrackerProject, WorkItem } from "../types";
import TrackerDetailPage from "./TrackerDetailPage";

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

const projectA: TrackerProject = {
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

const projectB: TrackerProject = {
	id: 2,
	name: "Rilis v3",
	startDate: null,
	endDate: null,
	position: 2048,
	version: 1,
	phases: [],
	createdAt: "2026-08-01T00:00:00Z",
	updatedAt: "2026-08-01T00:00:00Z",
};

const backlog = {
	id: 1,
	kind: "status" as const,
	name: "Backlog",
	position: 1000,
	colour: "oklch(0.7 0.1 200)",
};
const inProgress = {
	id: 2,
	kind: "status" as const,
	name: "In Progress",
	position: 2000,
	colour: "oklch(0.7 0.1 90)",
};
const bugLabel = {
	id: 3,
	kind: "label" as const,
	name: "Bug",
	position: 1000,
	colour: "oklch(0.7 0.1 15)",
};
const featureLabel = {
	id: 4,
	kind: "label" as const,
	name: "Feature",
	position: 2000,
	colour: "oklch(0.7 0.1 280)",
};

const item = {
	id: 42,
	key: "CK-42",
	title: "Workspace Rename",
	description: "details",
	source: "tracker" as const,
	status: backlog,
	priority: null,
	labels: [],
	assignees: [],
	version: 1,
	createdAt: "2026-07-04T00:00:00Z",
	updatedAt: "2026-07-04T00:00:00Z",
};

beforeEach(() => {
	mockListTrackerProjects.mockResolvedValue([projectA, projectB]);
	mockGetTrackerItem.mockResolvedValue(item);
	mockGetTrackerChangelog.mockResolvedValue({
		events: [
			{
				id: 1,
				eventType: "tracker_item_created",
				trackerItemId: 42,
				title: "Workspace Rename",
				actor: { username: "alice", displayName: "Alice" },
				createdAt: "2026-07-04T00:00:00Z",
			},
			{
				id: 2,
				eventType: "tracker_item_updated",
				trackerItemId: 42,
				title: "Workspace Rename",
				actor: { username: "alice", displayName: "Alice" },
				payload: { title: "Workspace Rename", changed: ["status", "title"] },
				createdAt: "2026-07-05T00:00:00Z",
			},
			{
				id: 3,
				eventType: "tracker_item_updated",
				trackerItemId: 42,
				title: null,
				actor: { username: "alice", displayName: "Alice" },
				payload: { field: "status", from: "Backlog", to: "In Progress" },
				createdAt: "2026-07-06T00:00:00Z",
			},
		],
	});
	mockUpdateTrackerItem.mockResolvedValue({ ...item, version: 2 });
	mockListVocabularies.mockImplementation((_ws: number, kind: string) =>
		Promise.resolve(
			kind === "status"
				? [backlog, inProgress]
				: kind === "label"
					? [bugLabel, featureLabel]
					: [],
		),
	);
	mockGetWorkspaceMembers.mockResolvedValue({ members: [] });
	mockUseBoard.mockReturnValue({
		activeWorkspaceId: 7,
		showToast: mockShowToast,
		refreshTrackerList: vi.fn(),
		subscribeTrackerEvents: vi.fn(() => () => {}),
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("TrackerDetailPage", () => {
	it("loads item by key and renders changelog", async () => {
		render(<TrackerDetailPage />);
		await waitFor(() =>
			expect(screen.getByDisplayValue("Workspace Rename")).toBeTruthy(),
		);
		expect(screen.getByText(/created this item/i)).toBeTruthy();
		expect(screen.getByText(/changed the status and the title/i)).toBeTruthy();
		expect(
			screen.getByText(/changed the status from Backlog to In Progress/i),
		).toBeTruthy();
		expect(mockGetTrackerItem).toHaveBeenCalledWith(7, "CA-42");
	});

	it("commits a status pick straight away with the current version", async () => {
		mockUpdateTrackerItem.mockResolvedValue({
			...item,
			status: inProgress,
			version: 2,
		});
		render(<TrackerDetailPage />);
		await waitFor(() => screen.getByDisplayValue("Workspace Rename"));
		await waitFor(() =>
			expect(screen.getByRole("button", { name: /backlog/i })).toBeTruthy(),
		);
		fireEvent.click(screen.getByRole("button", { name: /backlog/i }));
		fireEvent.click(screen.getByRole("option", { name: /in progress/i }));
		await waitFor(() =>
			expect(mockUpdateTrackerItem).toHaveBeenCalledWith(7, "CK-42", {
				statusId: 2,
				version: 1,
			}),
		);

		// The pick moved the server version on; a following title save must
		// carry the new one or it would conflict with the page's own write.
		fireEvent.change(screen.getByDisplayValue("Workspace Rename"), {
			target: { value: "Renamed" },
		});
		fireEvent.click(screen.getByRole("button", { name: /save/i }));
		await waitFor(() =>
			expect(mockUpdateTrackerItem).toHaveBeenLastCalledWith(7, "CK-42", {
				title: "Renamed",
				description: "details",
				version: 2,
			}),
		);
	});

	it("keeps an unsaved title through a background refresh", async () => {
		let sseHandler:
			| ((e: { type: string; trackerItemId?: number }) => void)
			| undefined;
		mockUseBoard.mockReturnValue({
			activeWorkspaceId: 7,
			showToast: mockShowToast,
			refreshTrackerList: vi.fn(),
			subscribeTrackerEvents: (cb: typeof sseHandler) => {
				sseHandler = cb;
				return () => {};
			},
		});
		render(<TrackerDetailPage />);
		await waitFor(() => screen.getByDisplayValue("Workspace Rename"));
		fireEvent.change(screen.getByDisplayValue("Workspace Rename"), {
			target: { value: "Half-typed draft" },
		});
		mockGetTrackerItem.mockResolvedValueOnce({ ...item, version: 5 });
		sseHandler?.({ type: "tracker.updated", trackerItemId: 42 });
		await waitFor(() => expect(mockGetTrackerItem).toHaveBeenCalledTimes(2));
		expect(screen.getByDisplayValue("Half-typed draft")).toBeTruthy();
	});

	it("redirects to canonical key when API returns stale prefix", async () => {
		mockGetTrackerItem.mockResolvedValueOnce({
			...item,
			key: "CK-42",
			canonicalKey: "CK-42",
			redirectFrom: "CA-42",
		});
		render(<TrackerDetailPage />);
		await waitFor(() =>
			expect(mockNavigate).toHaveBeenCalledWith("/tracker/CK-42", {
				replace: true,
			}),
		);
	});

	it("shows conflict toast on 409 save mirroring cards", async () => {
		mockUpdateTrackerItem.mockRejectedValueOnce(
			new ApiError("conflict", 409, "version_conflict"),
		);
		render(<TrackerDetailPage />);
		await waitFor(() => screen.getByDisplayValue("Workspace Rename"));
		fireEvent.change(screen.getByDisplayValue("Workspace Rename"), {
			target: { value: "Renamed" },
		});
		fireEvent.click(screen.getByRole("button", { name: /save/i }));
		await waitFor(() =>
			expect(mockShowToast).toHaveBeenCalledWith(
				"Someone else updated this tracker item first — refreshed.",
				"warning",
			),
		);
	});

	it("refetches item on tracker.updated SSE", async () => {
		let sseHandler:
			| ((e: {
					type: string;
					payload?: unknown;
					trackerItemId?: number;
			  }) => void)
			| undefined;
		mockGetTrackerItem.mockResolvedValueOnce(item).mockResolvedValueOnce({
			...item,
			title: "Live title",
			version: 3,
		});
		mockUseBoard.mockReturnValue({
			activeWorkspaceId: 7,
			showToast: mockShowToast,
			refreshTrackerList: vi.fn(),
			subscribeTrackerEvents: (cb: typeof sseHandler) => {
				sseHandler = cb;
				return () => {};
			},
		});
		render(<TrackerDetailPage />);
		await waitFor(() => screen.getByDisplayValue("Workspace Rename"));
		sseHandler?.({ type: "tracker.updated", trackerItemId: 42 });
		await waitFor(() =>
			expect(screen.getByDisplayValue("Live title")).toBeTruthy(),
		);
		expect(mockGetTrackerItem).toHaveBeenCalledTimes(2);
	});

	it("removes item from list context on tracker.deleted SSE", async () => {
		const refreshTrackerList = vi.fn();
		let sseHandler:
			| ((e: { type: string; payload?: unknown }) => void)
			| undefined;
		mockUseBoard.mockReturnValue({
			activeWorkspaceId: 7,
			showToast: mockShowToast,
			refreshTrackerList,
			subscribeTrackerEvents: (cb: typeof sseHandler) => {
				sseHandler = cb;
				return () => {};
			},
		});
		render(<TrackerDetailPage />);
		await waitFor(() => screen.getByDisplayValue("Workspace Rename"));
		sseHandler?.({ type: "tracker.deleted", payload: { key: "CK-42" } });
		await waitFor(() =>
			expect(mockNavigate).toHaveBeenCalledWith("/tracker", { replace: true }),
		);
		expect(refreshTrackerList).toHaveBeenCalled();
	});

	it("queues rapid assignee toggles against the latest assignee list", async () => {
		const alice = {
			userId: 10,
			username: "alice",
			displayName: "Alice",
			role: "member" as const,
		};
		const bob = {
			userId: 11,
			username: "bob",
			displayName: "Bob",
			role: "member" as const,
		};
		mockGetWorkspaceMembers.mockResolvedValue({ members: [alice, bob] });
		let resolveFirst: (value: WorkItem) => void = () => {};
		mockUpdateTrackerItem
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveFirst = resolve;
					}),
			)
			.mockResolvedValueOnce({
				...item,
				assignees: [
					{ id: 10, username: "alice", displayName: "Alice" },
					{ id: 11, username: "bob", displayName: "Bob" },
				],
				version: 3,
			});
		render(<TrackerDetailPage />);
		await waitFor(() => screen.getByDisplayValue("Workspace Rename"));
		await waitFor(() =>
			expect(screen.getByRole("button", { name: /assignee/i })).toBeTruthy(),
		);
		fireEvent.click(screen.getByRole("button", { name: /assignee/i }));
		fireEvent.click(screen.getByRole("option", { name: /alice/i }));
		fireEvent.click(screen.getByRole("option", { name: /bob/i }));
		await waitFor(() =>
			expect(mockUpdateTrackerItem).toHaveBeenCalledWith(7, "CK-42", {
				assigneeIds: [10],
				version: 1,
			}),
		);
		resolveFirst({
			...item,
			assignees: [{ id: 10, username: "alice", displayName: "Alice" }],
			version: 2,
		});
		await waitFor(() =>
			expect(mockUpdateTrackerItem).toHaveBeenLastCalledWith(7, "CK-42", {
				assigneeIds: [10, 11],
				version: 2,
			}),
		);
	});

	it("serialises a title save behind an in-flight property pick", async () => {
		let resolveStatus: (value: typeof item) => void = () => {};
		mockUpdateTrackerItem
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveStatus = resolve;
					}),
			)
			.mockResolvedValueOnce({ ...item, title: "Renamed", version: 3 });
		render(<TrackerDetailPage />);
		await waitFor(() => screen.getByDisplayValue("Workspace Rename"));
		await waitFor(() =>
			expect(screen.getByRole("button", { name: /backlog/i })).toBeTruthy(),
		);
		fireEvent.click(screen.getByRole("button", { name: /backlog/i }));
		fireEvent.click(screen.getByRole("option", { name: /in progress/i }));
		fireEvent.change(screen.getByDisplayValue("Workspace Rename"), {
			target: { value: "Renamed" },
		});
		fireEvent.click(screen.getByRole("button", { name: /save/i }));
		await waitFor(() => expect(mockUpdateTrackerItem).toHaveBeenCalledTimes(1));
		resolveStatus({ ...item, status: inProgress, version: 2 });
		await waitFor(() =>
			expect(mockUpdateTrackerItem).toHaveBeenLastCalledWith(7, "CK-42", {
				title: "Renamed",
				description: "details",
				version: 2,
			}),
		);
	});

	it("ignores stale loadItem responses when a newer refresh finishes first", async () => {
		let resolveStale: (value: typeof item) => void = () => {};
		let resolveFresh: (value: typeof item) => void = () => {};
		mockGetTrackerItem
			.mockResolvedValueOnce(item)
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveStale = resolve;
					}),
			)
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveFresh = resolve;
					}),
			);
		let sseHandler:
			| ((e: { type: string; trackerItemId?: number }) => void)
			| undefined;
		mockUseBoard.mockReturnValue({
			activeWorkspaceId: 7,
			showToast: mockShowToast,
			refreshTrackerList: vi.fn(),
			subscribeTrackerEvents: (cb: typeof sseHandler) => {
				sseHandler = cb;
				return () => {};
			},
		});
		render(<TrackerDetailPage />);
		await waitFor(() => screen.getByDisplayValue("Workspace Rename"));
		sseHandler?.({ type: "tracker.updated", trackerItemId: 42 });
		sseHandler?.({ type: "tracker.updated", trackerItemId: 42 });
		resolveFresh({ ...item, title: "Fresh title", version: 4 });
		resolveStale({ ...item, title: "Stale title", version: 3 });
		await waitFor(() =>
			expect(screen.getByDisplayValue("Fresh title")).toBeTruthy(),
		);
		expect(screen.queryByDisplayValue("Stale title")).toBeNull();
	});

	it("queues rapid label toggles against the latest label list", async () => {
		let resolveFirst: (value: WorkItem) => void = () => {};
		mockUpdateTrackerItem
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveFirst = resolve;
					}),
			)
			.mockResolvedValueOnce({
				...item,
				labels: [bugLabel, featureLabel],
				version: 3,
			});
		render(<TrackerDetailPage />);
		await waitFor(() => screen.getByDisplayValue("Workspace Rename"));
		await waitFor(() =>
			expect(screen.getByRole("button", { name: /add label/i })).toBeTruthy(),
		);
		fireEvent.click(screen.getByRole("button", { name: /add label/i }));
		fireEvent.click(screen.getByRole("option", { name: /bug/i }));
		fireEvent.click(screen.getByRole("option", { name: /feature/i }));
		await waitFor(() =>
			expect(mockUpdateTrackerItem).toHaveBeenCalledWith(7, "CK-42", {
				labelIds: [3],
				version: 1,
			}),
		);
		resolveFirst({ ...item, labels: [bugLabel], version: 2 });
		await waitFor(() =>
			expect(mockUpdateTrackerItem).toHaveBeenLastCalledWith(7, "CK-42", {
				labelIds: [3, 4],
				version: 2,
			}),
		);
	});
});

describe("TrackerDetailPage dates and project/phase pickers", () => {
	it("sets and saves start and end dates from the property rail", async () => {
		mockUpdateTrackerItem.mockResolvedValue({
			...item,
			startDate: "2026-09-21",
			endDate: "2026-09-30",
			version: 2,
		});
		render(<TrackerDetailPage />);
		await waitFor(() => screen.getByDisplayValue("Workspace Rename"));
		fireEvent.change(screen.getByLabelText(/start date/i), {
			target: { value: "2026-09-21" },
		});
		fireEvent.change(screen.getByLabelText(/end date/i), {
			target: { value: "2026-09-30" },
		});
		fireEvent.click(screen.getByRole("button", { name: /save/i }));
		await waitFor(() =>
			expect(mockUpdateTrackerItem).toHaveBeenCalledWith(7, "CK-42", {
				title: "Workspace Rename",
				description: "details",
				startDate: "2026-09-21",
				endDate: "2026-09-30",
				version: 1,
			}),
		);
	});

	it("resets the phase selection when a different project is picked", async () => {
		mockUpdateTrackerItem
			.mockResolvedValueOnce({ ...item, projectId: 1, phaseId: null, version: 2 })
			.mockResolvedValueOnce({ ...item, projectId: 1, phaseId: 9, version: 3 })
			.mockResolvedValueOnce({ ...item, projectId: 2, phaseId: null, version: 4 });
		render(<TrackerDetailPage />);
		await waitFor(() => screen.getByDisplayValue("Workspace Rename"));

		fireEvent.click(await screen.findByRole("button", { name: /project/i }));
		fireEvent.click(screen.getByRole("option", { name: /rilis v2/i }));
		await waitFor(() =>
			expect(mockUpdateTrackerItem).toHaveBeenCalledWith(7, "CK-42", {
				projectId: 1,
				phaseId: null,
				version: 1,
			}),
		);

		fireEvent.click(screen.getByRole("button", { name: /phase/i }));
		fireEvent.click(screen.getByRole("option", { name: /persiapan/i }));
		await waitFor(() =>
			expect(mockUpdateTrackerItem).toHaveBeenLastCalledWith(7, "CK-42", {
				projectId: 1,
				phaseId: 9,
				version: 2,
			}),
		);

		fireEvent.click(screen.getByRole("button", { name: /rilis v2/i }));
		fireEvent.click(screen.getByRole("option", { name: /rilis v3/i }));
		await waitFor(() =>
			expect(mockUpdateTrackerItem).toHaveBeenLastCalledWith(7, "CK-42", {
				projectId: 2,
				phaseId: null,
				version: 3,
			}),
		);
	});

	it("surfaces inverted date range validation inline instead of a connection toast", async () => {
		mockUpdateTrackerItem.mockRejectedValue(
			new ApiError("end date must not precede start date", 400),
		);
		render(<TrackerDetailPage />);
		await waitFor(() => screen.getByDisplayValue("Workspace Rename"));
		fireEvent.change(screen.getByLabelText(/start date/i), {
			target: { value: "2026-09-30" },
		});
		fireEvent.change(screen.getByLabelText(/end date/i), {
			target: { value: "2026-09-21" },
		});
		fireEvent.click(screen.getByRole("button", { name: /save/i }));
		expect(
			await screen.findByText(/end date must not precede start date/i),
		).toBeTruthy();
		expect(mockShowToast).not.toHaveBeenCalledWith(
			"Couldn't save the tracker item. Check your connection and try again.",
			"error",
		);
	});

	it("shows the overdue marker for a past end date with a live status", async () => {
		mockGetTrackerItem.mockResolvedValue({
			...item,
			status: inProgress,
			endDate: "2026-07-01",
		});
		vi.setSystemTime(new Date("2026-08-05T12:00:00"));
		render(<TrackerDetailPage />);
		await waitFor(() => screen.getByDisplayValue("Workspace Rename"));
		expect(screen.getByLabelText(/overdue/i)).toBeTruthy();
		vi.useRealTimers();
	});
});
