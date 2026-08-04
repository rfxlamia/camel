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
	mockGetWorkspaceMembers,
	mockNavigate,
	mockUseBoard,
	mockShowToast,
} = vi.hoisted(() => ({
	mockGetTrackerItem: vi.fn(),
	mockUpdateTrackerItem: vi.fn(),
	mockGetTrackerChangelog: vi.fn(),
	mockListVocabularies: vi.fn(),
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
import type { TrackerItem } from "../types";
import TrackerDetailPage from "./TrackerDetailPage";

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

const item = {
	id: 42,
	key: "CK-42",
	title: "Workspace Rename",
	description: "details",
	status: backlog,
	priority: null,
	labels: [],
	assignees: [],
	version: 1,
	createdAt: "2026-07-04T00:00:00Z",
	updatedAt: "2026-07-04T00:00:00Z",
};

beforeEach(() => {
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
		Promise.resolve(kind === "status" ? [backlog, inProgress] : []),
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
		let resolveFirst: (value: TrackerItem) => void = () => {};
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
});
