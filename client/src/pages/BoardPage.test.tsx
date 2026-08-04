import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseBoard, applyTemplate, refresh, showToast, navigate, moveCard } =
	vi.hoisted(() => ({
		mockUseBoard: vi.fn(),
		applyTemplate: vi.fn(),
		refresh: vi.fn(),
		showToast: vi.fn(),
		navigate: vi.fn(),
		moveCard: vi.fn(),
	}));

vi.mock("../context/BoardContext", () => ({
	useBoard: () => mockUseBoard(),
}));

vi.mock("react-router", () => ({
	useNavigate: () => navigate,
	Outlet: () => null,
}));

vi.mock("../api", () => ({
	ApiError: class ApiError extends Error {
		status: number;
		code?: string;
		constructor(message: string, status: number, code?: string) {
			super(message);
			this.status = status;
			this.code = code;
		}
	},
	api: {
		applyTemplate: (...a: unknown[]) => applyTemplate(...a),
		createColumn: vi.fn(),
		createCard: vi.fn(),
		moveCard: (...a: unknown[]) => moveCard(...a),
		updateColumn: vi.fn(),
	},
}));

vi.mock("../components/LoadingCamel", () => ({
	default: () => <div data-testid="loading-camel" />,
}));
vi.mock("../components/SuccessAnimation", () => ({
	default: () => <div data-testid="success-animation" />,
}));

import { ApiError } from "../api";
import BoardPage, { moveCardToColumn } from "./BoardPage";
import type { Column, Card } from "../types";
import type { SetStateAction } from "react";

function makeListBoardValue(
	columns: Column[],
	setColumns: ReturnType<typeof vi.fn>,
) {
	return {
		columns,
		setColumns,
		loadError: false,
		refresh,
		cancelScheduledRefresh: vi.fn(),
		showToast,
		deleteCard: vi.fn(),
		saveCard: vi.fn(),
		activeWorkspaceId: 7,
		boardViewMode: "list" as const,
		setBoardViewMode: vi.fn(),
	};
}

function renderListBoard(initialColumns: Column[]) {
	let currentColumns = structuredClone(initialColumns);
	let rerenderBoard = () => {};
	const setColumns = vi.fn((updater: SetStateAction<Column[] | null>) => {
		currentColumns =
			typeof updater === "function"
				? (updater(currentColumns) ?? currentColumns)
				: (updater ?? currentColumns);
		mockUseBoard.mockReturnValue(makeListBoardValue(currentColumns, setColumns));
		rerenderBoard();
	});
	mockUseBoard.mockReturnValue(makeListBoardValue(currentColumns, setColumns));
	const view = render(<BoardPage />);
	rerenderBoard = () => view.rerender(<BoardPage />);
	return { ...view, setColumns };
}

beforeEach(() => {
	applyTemplate.mockReset();
	refresh.mockReset().mockResolvedValue(undefined);
	showToast.mockReset();
	moveCard.mockReset().mockResolvedValue({
		id: 1,
		columnId: 2,
		title: "Ship feature",
		description: "",
		position: 1,
		version: 2,
		createdAt: "2026-08-01T00:00:00.000Z",
		startedAt: null,
		doneAt: null,
		dueDate: null,
		assignees: [],
	});
	mockUseBoard.mockReturnValue({
		columns: [],
		setColumns: vi.fn(),
		loadError: false,
		refresh,
		cancelScheduledRefresh: vi.fn(),
		showToast,
		deleteCard: vi.fn(),
		activeWorkspaceId: 7,
		boardViewMode: "board",
		setBoardViewMode: vi.fn(),
	});
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("BoardPage empty-board template picker", () => {
	it("renders the TemplatePicker on an empty board (not the bare AddColumn empty state)", () => {
		render(<BoardPage />);
		expect(screen.getByText("Software Dev")).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: /^add column$/i }),
		).toBeNull();
	});

	it("on a 409 apply, silently refetches and shows no error toast", async () => {
		applyTemplate.mockRejectedValueOnce(new ApiError("conflict", 409));
		render(<BoardPage />);
		fireEvent.click(
			screen.getAllByRole("button", { name: /use this template/i })[0],
		);
		await waitFor(() => expect(refresh).toHaveBeenCalled());
		expect(showToast.mock.calls.every((c) => c[1] !== "error")).toBe(true);
	});

	it("on a non-409 apply error, shows an error toast and keeps the picker", async () => {
		applyTemplate.mockRejectedValueOnce(new ApiError("server boom", 500));
		render(<BoardPage />);
		fireEvent.click(
			screen.getAllByRole("button", { name: /use this template/i })[0],
		);
		await waitFor(() =>
			expect(showToast.mock.calls.some((c) => c[1] === "error")).toBe(true),
		);
		expect(screen.getByText("Software Dev")).toBeTruthy();
	});

	it("on 'Start blank instead', shows the manual AddColumn state and never applies", () => {
		render(<BoardPage />);
		fireEvent.click(
			screen.getByRole("button", { name: /start blank instead/i }),
		);
		expect(
			screen.getByRole("button", { name: /^add column$/i }),
		).toBeTruthy();
		expect(applyTemplate).not.toHaveBeenCalled();
	});
});

const listColumns = [
	{
		id: 1,
		title: "To Do",
		position: 0,
		wipLimit: null,
		policy: "",
		isDone: false,
		isSignable: false,
		signableAssigneeId: null,
		color: null,
		cards: [
			{
				id: 1,
				columnId: 1,
				title: "Ship feature",
				description: "",
				position: 1,
				version: 1,
				createdAt: "2026-08-01T00:00:00.000Z",
				startedAt: null,
				doneAt: null,
				dueDate: null,
				assignees: [],
			},
		],
	},
	{
		id: 2,
		title: "In Progress",
		position: 1,
		wipLimit: null,
		policy: "",
		isDone: false,
		isSignable: false,
		signableAssigneeId: null,
		color: null,
		cards: [],
	},
];

describe("moveCardToColumn", () => {
	const card: Card = {
		id: 1,
		columnId: 1,
		title: "Ship feature",
		description: "",
		position: 1,
		version: 1,
		createdAt: "2026-08-01T00:00:00.000Z",
		startedAt: null,
		doneAt: null,
		dueDate: null,
		assignees: [],
	};
	const columns: Column[] = [
		{
			id: 1,
			title: "To Do",
			position: 0,
			wipLimit: null,
			policy: "",
			isDone: false,
			isSignable: false,
			signableAssigneeId: null,
			color: null,
			cards: [card],
		},
		{
			id: 2,
			title: "In Progress",
			position: 1,
			wipLimit: null,
			policy: "",
			isDone: false,
			isSignable: false,
			signableAssigneeId: null,
			color: null,
			cards: [],
		},
	];

	it("returns the same columns when source and target are identical", () => {
		expect(moveCardToColumn(columns, 1, 1)).toBe(columns);
	});
});

describe("BoardPage list view column change", () => {
	it("moves a card via the list status picker", async () => {
		const setColumns = vi.fn();
		mockUseBoard.mockReturnValue({
			columns: listColumns,
			setColumns,
			loadError: false,
			refresh,
			cancelScheduledRefresh: vi.fn(),
			showToast,
			deleteCard: vi.fn(),
			saveCard: vi.fn(),
			activeWorkspaceId: 7,
			boardViewMode: "list",
			setBoardViewMode: vi.fn(),
		});
		render(<BoardPage />);
		fireEvent.click(screen.getByLabelText("To Do, Ship feature"));
		fireEvent.click(screen.getByRole("option", { name: /In Progress/ }));

		await waitFor(() =>
			expect(moveCard).toHaveBeenCalledWith(7, 1, {
				toColumnId: 2,
				index: 0,
				version: 1,
			}),
		);
		expect(refresh).toHaveBeenCalled();
	});

	it("rolls back and shows an error toast when moveCard fails", async () => {
		moveCard.mockRejectedValueOnce(new Error("network down"));
		const setColumns = vi.fn();
		mockUseBoard.mockReturnValue({
			columns: listColumns,
			setColumns,
			loadError: false,
			refresh,
			cancelScheduledRefresh: vi.fn(),
			showToast,
			deleteCard: vi.fn(),
			saveCard: vi.fn(),
			activeWorkspaceId: 7,
			boardViewMode: "list",
			setBoardViewMode: vi.fn(),
		});
		render(<BoardPage />);
		fireEvent.click(screen.getByLabelText("To Do, Ship feature"));
		fireEvent.click(screen.getByRole("option", { name: /In Progress/ }));

		await waitFor(() => expect(showToast).toHaveBeenCalled());
		expect(showToast.mock.calls[0]?.[1]).toBe("error");
		expect(setColumns.mock.calls.length).toBeGreaterThanOrEqual(2);
	});

	it("refreshes on version conflict and drops queued picks", async () => {
		moveCard.mockRejectedValueOnce(
			new ApiError("conflict", 409, "version_conflict"),
		);
		const setColumns = vi.fn();
		mockUseBoard.mockReturnValue({
			columns: listColumns,
			setColumns,
			loadError: false,
			refresh,
			cancelScheduledRefresh: vi.fn(),
			showToast,
			deleteCard: vi.fn(),
			saveCard: vi.fn(),
			activeWorkspaceId: 7,
			boardViewMode: "list",
			setBoardViewMode: vi.fn(),
		});
		render(<BoardPage />);
		fireEvent.click(screen.getByLabelText("To Do, Ship feature"));
		fireEvent.click(screen.getByRole("option", { name: /In Progress/ }));

		await waitFor(() => expect(refresh).toHaveBeenCalled());
		expect(showToast.mock.calls[0]?.[1]).toBe("warning");
	});

	it("defers a second column pick until the first request settles", async () => {
		const columnsWithDone: Column[] = [
			...listColumns,
			{
				id: 3,
				title: "Done",
				position: 2,
				wipLimit: null,
				policy: "",
				isDone: true,
				isSignable: false,
				signableAssigneeId: null,
				color: null,
				cards: [],
			},
		];
		let rejectFirst: ((err: Error) => void) | undefined;
		moveCard
			.mockImplementationOnce(
				() =>
					new Promise((_resolve, reject) => {
						rejectFirst = reject;
					}),
			)
			.mockResolvedValueOnce({
				id: 1,
				columnId: 3,
				title: "Ship feature",
				description: "",
				position: 1,
				version: 2,
				createdAt: "2026-08-01T00:00:00.000Z",
				startedAt: null,
				doneAt: "2026-08-02T00:00:00.000Z",
				dueDate: null,
				assignees: [],
			});
		renderListBoard(columnsWithDone);
		await waitFor(() => screen.getByLabelText("To Do, Ship feature"));

		fireEvent.click(screen.getByLabelText("To Do, Ship feature"));
		fireEvent.click(screen.getByRole("option", { name: /In Progress/ }));
		await waitFor(() =>
			expect(screen.getByLabelText("In Progress, Ship feature")).toBeTruthy(),
		);

		fireEvent.click(screen.getByLabelText("In Progress, Ship feature"));
		fireEvent.click(screen.getByRole("option", { name: /^Done$/ }));
		expect(moveCard).toHaveBeenCalledTimes(1);

		rejectFirst?.(new Error("network down"));
		await waitFor(() => expect(moveCard).toHaveBeenCalledTimes(2));
		expect(moveCard).toHaveBeenLastCalledWith(7, 1, {
			toColumnId: 3,
			index: 0,
			version: 1,
		});
		await waitFor(() =>
			expect(screen.getByLabelText("Done, Ship feature")).toBeTruthy(),
		);
	});

	it("rolls back only the failed card when another card moved concurrently", async () => {
		const twoCardColumns: Column[] = [
			{
				...listColumns[0]!,
				cards: [
					listColumns[0]!.cards[0]!,
					{
						...listColumns[0]!.cards[0]!,
						id: 2,
						title: "Other task",
						position: 2,
					},
				],
			},
			listColumns[1]!,
		];
		let rejectFirst: ((err: Error) => void) | undefined;
		moveCard
			.mockImplementationOnce(
				() =>
					new Promise((_resolve, reject) => {
						rejectFirst = reject;
					}),
			)
			.mockResolvedValueOnce({
				id: 2,
				columnId: 2,
				title: "Other task",
				description: "",
				position: 1,
				version: 1,
				createdAt: "2026-08-01T00:00:00.000Z",
				startedAt: null,
				doneAt: null,
				dueDate: null,
				assignees: [],
			});
		renderListBoard(twoCardColumns);
		await waitFor(() => screen.getByLabelText("To Do, Ship feature"));

		fireEvent.click(screen.getByLabelText("To Do, Ship feature"));
		fireEvent.click(screen.getByRole("option", { name: /In Progress/ }));

		fireEvent.click(screen.getByLabelText("To Do, Other task"));
		fireEvent.click(screen.getByRole("option", { name: /In Progress/ }));
		await waitFor(() =>
			expect(screen.getByLabelText("In Progress, Other task")).toBeTruthy(),
		);

		rejectFirst?.(new Error("network down"));
		await waitFor(() => expect(showToast).toHaveBeenCalled());
		expect(screen.getByLabelText("To Do, Ship feature")).toBeTruthy();
		expect(screen.getByLabelText("In Progress, Other task")).toBeTruthy();
	});

	it("completes a queued A→B→A move using refreshed card state", async () => {
		let resolveFirst: ((value: unknown) => void) | undefined;
		moveCard
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveFirst = resolve;
					}),
			)
			.mockResolvedValueOnce({
				id: 1,
				columnId: 1,
				title: "Ship feature",
				description: "",
				position: 1,
				version: 3,
				createdAt: "2026-08-01T00:00:00.000Z",
				startedAt: null,
				doneAt: null,
				dueDate: null,
				assignees: [],
			});
		renderListBoard(listColumns);
		await waitFor(() => screen.getByLabelText("To Do, Ship feature"));

		fireEvent.click(screen.getByLabelText("To Do, Ship feature"));
		fireEvent.click(screen.getByRole("option", { name: /In Progress/ }));
		await waitFor(() =>
			expect(screen.getByLabelText("In Progress, Ship feature")).toBeTruthy(),
		);

		fireEvent.click(screen.getByLabelText("In Progress, Ship feature"));
		fireEvent.click(screen.getByRole("option", { name: /To Do/ }));
		expect(moveCard).toHaveBeenCalledTimes(1);

		resolveFirst?.({
			id: 1,
			columnId: 2,
			title: "Ship feature",
			description: "",
			position: 1,
			version: 2,
			createdAt: "2026-08-01T00:00:00.000Z",
			startedAt: null,
			doneAt: null,
			dueDate: null,
			assignees: [],
		});

		await waitFor(() => expect(moveCard).toHaveBeenCalledTimes(2));
		expect(moveCard).toHaveBeenLastCalledWith(7, 1, {
			toColumnId: 1,
			index: 0,
			version: 2,
		});
		await waitFor(() =>
			expect(screen.getByLabelText("To Do, Ship feature")).toBeTruthy(),
		);
	});
});
