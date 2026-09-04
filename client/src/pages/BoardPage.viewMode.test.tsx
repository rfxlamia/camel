import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockUseBoard,
	mockGetWorkspaceMembers,
	mockListTrackerVocabularies,
	mockListTrackerProjects,
} = vi.hoisted(() => ({
	mockUseBoard: vi.fn(),
	mockGetWorkspaceMembers: vi.fn(),
	mockListTrackerVocabularies: vi.fn(),
	mockListTrackerProjects: vi.fn(),
}));

vi.mock("react-router", () => ({
	useNavigate: () => vi.fn(),
	Outlet: () => null,
}));
vi.mock("../api", () => ({
	ApiError: class extends Error {},
	api: {
		getWorkspaceMembers: (...a: unknown[]) => mockGetWorkspaceMembers(...a),
		listTrackerVocabularies: (...a: unknown[]) =>
			mockListTrackerVocabularies(...a),
		listTrackerProjects: (...a: unknown[]) => mockListTrackerProjects(...a),
	},
}));
vi.mock("../components/LoadingCamel", () => ({ default: () => null }));
vi.mock("../components/SuccessAnimation", () => ({ default: () => null }));
vi.mock("../components/ListView", () => ({
	default: () => <div data-testid="list-view" />,
}));
vi.mock("../components/CalendarView", () => ({
	default: () => <div data-testid="calendar-view" />,
}));
vi.mock("../context/BoardContext", () => ({
	useBoard: () => mockUseBoard(),
}));

import BoardPage from "./BoardPage";

describe("BoardPage view mode routing", () => {
	beforeEach(() => {
		mockGetWorkspaceMembers.mockReset().mockResolvedValue({ members: [] });
		mockListTrackerVocabularies.mockReset().mockResolvedValue([]);
		mockListTrackerProjects.mockReset().mockResolvedValue([]);
	});

	afterEach(cleanup);

	it("renders ListView when boardViewMode is list", () => {
		mockUseBoard.mockReturnValue({
			columns: [
				{
					id: 1,
					title: "Todo",
					position: 0,
					wipLimit: null,
					policy: "",
					isDone: false,
					isSignable: false,
					signableAssigneeId: null,
					color: null,
					cards: [],
				},
			],
			setColumns: vi.fn(),
			loadError: false,
			refresh: vi.fn(),
			cancelScheduledRefresh: vi.fn(),
			showToast: vi.fn(),
			deleteCard: vi.fn(),
			activeWorkspaceId: 7,
			boardViewMode: "list",
			setBoardViewMode: vi.fn(),
		});
		render(<BoardPage />);
		expect(screen.getByTestId("list-view")).toBeTruthy();
	});

	it("renders kanban columns when boardViewMode is board", () => {
		mockUseBoard.mockReturnValue({
			columns: [
				{
					id: 1,
					title: "Todo",
					position: 0,
					wipLimit: null,
					policy: "",
					isDone: false,
					isSignable: false,
					signableAssigneeId: null,
					color: null,
					cards: [],
				},
			],
			setColumns: vi.fn(),
			loadError: false,
			refresh: vi.fn(),
			cancelScheduledRefresh: vi.fn(),
			showToast: vi.fn(),
			deleteCard: vi.fn(),
			activeWorkspaceId: 7,
			boardViewMode: "board",
			setBoardViewMode: vi.fn(),
		});
		render(<BoardPage />);
		expect(screen.getByText("Todo")).toBeTruthy();
		expect(screen.queryByTestId("list-view")).toBeNull();
	});

	it("renders CalendarView when boardViewMode is calendar", () => {
		mockUseBoard.mockReturnValue({
			columns: [],
			setColumns: vi.fn(),
			loadError: false,
			refresh: vi.fn(),
			cancelScheduledRefresh: vi.fn(),
			showToast: vi.fn(),
			deleteCard: vi.fn(),
			activeWorkspaceId: 7,
			boardViewMode: "calendar",
			setBoardViewMode: vi.fn(),
		});
		render(<BoardPage />);
		expect(screen.getByTestId("calendar-view")).toBeTruthy();
	});

	it("renders ViewSwitcher in the toolbar, not in the board canvas", () => {
		mockUseBoard.mockReturnValue({
			columns: [
				{
					id: 1,
					title: "Todo",
					position: 0,
					wipLimit: null,
					policy: "",
					isDone: false,
					isSignable: false,
					signableAssigneeId: null,
					color: null,
					cards: [],
				},
			],
			setColumns: vi.fn(),
			loadError: false,
			refresh: vi.fn(),
			cancelScheduledRefresh: vi.fn(),
			showToast: vi.fn(),
			deleteCard: vi.fn(),
			activeWorkspaceId: 7,
			boardViewMode: "board",
			setBoardViewMode: vi.fn(),
		});
		const { container } = render(<BoardPage />);
		const tablist = screen.getByRole("tablist", { name: "Board view" });
		expect(tablist.closest(".board-canvas")).toBeNull();
		expect(container.querySelector(".board-canvas .mb-4")).toBeNull();
	});
});
