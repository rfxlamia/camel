// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockGetTrackerItem,
	mockUpdateTrackerItem,
	mockGetTrackerChangelog,
	mockNavigate,
	mockUseBoard,
	mockShowToast,
} = vi.hoisted(() => ({
	mockGetTrackerItem: vi.fn(),
	mockUpdateTrackerItem: vi.fn(),
	mockGetTrackerChangelog: vi.fn(),
	mockNavigate: vi.fn(),
	mockUseBoard: vi.fn(),
	mockShowToast: vi.fn(),
}));

vi.mock("../api", () => ({
	api: {
		getTrackerItem: (...a: unknown[]) => mockGetTrackerItem(...a),
		updateTrackerItem: (...a: unknown[]) => mockUpdateTrackerItem(...a),
		getTrackerChangelog: (...a: unknown[]) => mockGetTrackerChangelog(...a),
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
import TrackerDetailPage from "./TrackerDetailPage";

const item = {
	id: 42,
	key: "CK-42",
	title: "Workspace Rename",
	description: "details",
	status: {
		id: 1,
		kind: "status" as const,
		name: "Backlog",
		position: 1000,
		colour: "oklch(0.7 0.1 200)",
	},
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
				title: null,
				actor: { username: "alice", displayName: "Alice" },
				payload: { field: "status", from: "Backlog", to: "In Progress" },
				createdAt: "2026-07-05T00:00:00Z",
			},
		],
	});
	mockUpdateTrackerItem.mockResolvedValue({ ...item, version: 2 });
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
		expect(screen.getByText(/tracker_item_created/i)).toBeTruthy();
		expect(screen.getByText(/In Progress/i)).toBeTruthy();
		expect(mockGetTrackerItem).toHaveBeenCalledWith(7, "CA-42");
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
		mockGetTrackerItem
			.mockResolvedValueOnce(item)
			.mockResolvedValueOnce({
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
});
