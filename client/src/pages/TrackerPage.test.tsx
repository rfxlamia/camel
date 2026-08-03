// @vitest-environment jsdom
// client/src/pages/TrackerPage.test.tsx
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackerItem, TrackerVocabulary } from "../types";

const {
	mockListTrackerItems,
	mockCreateTrackerItem,
	mockListTrackerVocabularies,
	mockGetWorkspaceMembers,
	mockUseBoard,
	mockNavigate,
	mockLocation,
} = vi.hoisted(() => ({
	mockListTrackerItems: vi.fn(),
	mockCreateTrackerItem: vi.fn(),
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

import TrackerPage from "./TrackerPage";
import { KANBAN_NAV } from "../layout/sidebar/navItems";

const statuses: TrackerVocabulary[] = [
	{
		id: 1,
		kind: "status",
		name: "Backlog",
		position: 1000,
		colour: "oklch(0.7 0.1 200)",
	},
	{
		id: 2,
		kind: "status",
		name: "In Progress",
		position: 3000,
		colour: "oklch(0.7 0.1 150)",
	},
	{
		id: 5,
		kind: "status",
		name: "Done",
		position: 5000,
		colour: "oklch(0.7 0.1 140)",
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

function makeItem(overrides: Partial<TrackerItem> & { id: number }): TrackerItem {
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

beforeEach(() => {
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
		expect(screen.getByLabelText("Backlog")).toBeTruthy();
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

	it("opens create modal from global + and submits title-only defaults", async () => {
		render(<TrackerPage />);
		fireEvent.click(
			screen.getByRole("button", { name: /create tracker item/i }),
		);
		fireEvent.change(screen.getByLabelText(/title/i), {
			target: { value: "Fix realtime" },
		});
		fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
		await waitFor(() =>
			expect(mockCreateTrackerItem).toHaveBeenCalledWith(7, {
				title: "Fix realtime",
			}),
		);
	});

	it("submits picker values on create", async () => {
		render(<TrackerPage />);
		await waitFor(() => screen.getByText("Backlog"));
		fireEvent.click(
			screen.getByRole("button", { name: /create tracker item/i }),
		);
		fireEvent.change(screen.getByLabelText(/title/i), {
			target: { value: "Full" },
		});
		fireEvent.click(screen.getByLabelText(/In Progress/i));
		fireEvent.click(screen.getByLabelText(/High/i));
		fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
		await waitFor(() =>
			expect(mockCreateTrackerItem).toHaveBeenCalledWith(
				7,
				expect.objectContaining({
					title: "Full",
					statusId: 2,
					priorityId: expect.any(Number),
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
		await waitFor(() => screen.getByLabelText("Feature"));
		fireEvent.change(screen.getByLabelText(/title/i), {
			target: { value: "Tagged task" },
		});
		fireEvent.change(screen.getByLabelText(/description/i), {
			target: { value: "Needs review" },
		});
		fireEvent.click(screen.getByLabelText("Feature"));
		fireEvent.click(screen.getByPlaceholderText(/search members/i));
		fireEvent.click(screen.getByRole("option", { name: /Alice/i }));
		fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
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
