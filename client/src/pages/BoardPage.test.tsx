import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockUseBoard,
	applyTemplate,
	refresh,
	showToast,
	navigate,
	moveCard,
	createCard,
	mockGetWorkspaceMembers,
	mockListTrackerVocabularies,
	mockListTrackerProjects,
} = vi.hoisted(() => ({
	mockUseBoard: vi.fn(),
	applyTemplate: vi.fn(),
	refresh: vi.fn(),
	showToast: vi.fn(),
	navigate: vi.fn(),
	moveCard: vi.fn(),
	createCard: vi.fn(),
	mockGetWorkspaceMembers: vi.fn(),
	mockListTrackerVocabularies: vi.fn(),
	mockListTrackerProjects: vi.fn(),
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
		fieldErrors?: Record<string, string>;
		constructor(
			message: string,
			status: number,
			code?: string,
			_retryAfterMs?: number,
			fieldErrors?: Record<string, string>,
		) {
			super(message);
			this.status = status;
			this.code = code;
			this.fieldErrors = fieldErrors;
		}
	},
	api: {
		applyTemplate: (...a: unknown[]) => applyTemplate(...a),
		createColumn: vi.fn(),
		createCard: (...a: unknown[]) => createCard(...a),
		moveCard: (...a: unknown[]) => moveCard(...a),
		updateColumn: vi.fn(),
		getWorkspaceMembers: (...a: unknown[]) => mockGetWorkspaceMembers(...a),
		listTrackerVocabularies: (...a: unknown[]) =>
			mockListTrackerVocabularies(...a),
		listTrackerProjects: (...a: unknown[]) => mockListTrackerProjects(...a),
	},
}));

vi.mock("../components/LoadingCamel", () => ({
	default: () => <div data-testid="loading-camel" />,
}));
vi.mock("../components/SuccessAnimation", () => ({
	default: () => <div data-testid="success-animation" />,
}));

import { ApiError } from "../api";
import BoardPage from "./BoardPage";
import type { Column, TrackerProject, TrackerVocabulary, WorkspaceMember } from "../types";
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
		updatedAt: "2026-08-01T00:00:00.000Z",
		startedAt: null,
		doneAt: null,
		dueDate: null,
		assignees: [],
	});
	createCard.mockReset().mockResolvedValue({
		id: 99,
		columnId: 1,
		title: "New card",
		description: "",
		position: 1,
		version: 1,
		createdAt: "2026-08-01T00:00:00.000Z",
		updatedAt: "2026-08-01T00:00:00.000Z",
		startedAt: null,
		doneAt: null,
		dueDate: null,
		assignees: [],
	});
	mockGetWorkspaceMembers.mockReset().mockResolvedValue({
		members: [
			{ userId: 1, username: "rafi", displayName: "Rafi", role: "member" },
		] satisfies WorkspaceMember[],
	});
	mockListTrackerVocabularies.mockReset().mockImplementation(
		(_workspaceId: number, kind: string) => {
			if (kind === "priority") {
				return Promise.resolve([
					{
						id: 10,
						kind: "priority",
						name: "High",
						position: 1,
						colour: "#f00",
					},
				] satisfies TrackerVocabulary[]);
			}
			if (kind === "label") return Promise.resolve([]);
			return Promise.resolve([]);
		},
	);
	mockListTrackerProjects.mockReset().mockResolvedValue([
		{
			id: 1,
			name: "Web",
			startDate: null,
			endDate: null,
			position: 1,
			version: 1,
			phases: [],
		},
	] satisfies TrackerProject[]);
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
				updatedAt: "2026-08-01T00:00:00.000Z",
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

	it("reverts and refreshes on version conflict, dropping queued picks", async () => {
		moveCard.mockRejectedValueOnce(
			new ApiError("conflict", 409, "version_conflict"),
		);
		renderListBoard(listColumns);
		await waitFor(() => screen.getByLabelText("To Do, Ship feature"));

		fireEvent.click(screen.getByLabelText("To Do, Ship feature"));
		fireEvent.click(screen.getByRole("option", { name: /In Progress/ }));
		await waitFor(() =>
			expect(screen.getByLabelText("In Progress, Ship feature")).toBeTruthy(),
		);

		await waitFor(() => expect(refresh).toHaveBeenCalled());
		expect(showToast.mock.calls[0]?.[1]).toBe("warning");
		expect(screen.getByLabelText("To Do, Ship feature")).toBeTruthy();
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
				updatedAt: "2026-08-01T00:00:00.000Z",
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
				updatedAt: "2026-08-01T00:00:00.000Z",
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
				updatedAt: "2026-08-01T00:00:00.000Z",
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

const boardColumns: Column[] = [
	{
		id: 1,
		title: "To do",
		position: 0,
		wipLimit: null,
		policy: "",
		isDone: false,
		isSignable: false,
		signableAssigneeId: null,
		color: null,
		cards: [],
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

function renderBoardView(
	columns: Column[] = boardColumns,
	workspaceId = 7,
) {
	mockUseBoard.mockReturnValue({
		columns,
		setColumns: vi.fn(),
		loadError: false,
		refresh,
		cancelScheduledRefresh: vi.fn(),
		showToast,
		deleteCard: vi.fn(),
		saveCard: vi.fn(),
		activeWorkspaceId: workspaceId,
		boardViewMode: "board",
		setBoardViewMode: vi.fn(),
	});
	return render(<BoardPage />);
}

function openFirstAddCard() {
	const addButtons = screen.getAllByRole("button", { name: /add card/i });
	fireEvent.click(addButtons[0]!);
}

function getTitleTextarea() {
	return screen.getAllByRole("combobox", {
		name: "Task title",
	})[0] as HTMLTextAreaElement;
}

async function pickFieldValue(fieldLabel: string, valueLabel: string) {
	const textarea = getTitleTextarea();
	const currentTitle = textarea.value.replace(/\s+$/, "");
	fireEvent.change(textarea, { target: { value: `${currentTitle} ` } });
	fireEvent.keyDown(textarea, { key: "@" });
	await waitFor(() =>
		expect(screen.getByRole("listbox", { name: "Task fields" })).toBeTruthy(),
	);
	const fieldOptions = screen.getAllByRole("option");
	const fieldIndex = fieldOptions.findIndex((option) =>
		option.textContent?.includes(fieldLabel),
	);
	for (let i = 0; i < fieldIndex; i++) {
		fireEvent.keyDown(textarea, { key: "ArrowDown" });
	}
	fireEvent.keyDown(textarea, { key: "Enter" });
	await waitFor(() =>
		expect(
			screen.getByRole("listbox", { name: `${fieldLabel} options` }),
		).toBeTruthy(),
	);
	const valueOptions = screen.getAllByRole("option");
	const valueIndex = valueOptions.findIndex((option) =>
		option.textContent?.includes(valueLabel),
	);
	for (let i = 0; i < valueIndex; i++) {
		fireEvent.keyDown(textarea, { key: "ArrowDown" });
	}
	fireEvent.keyDown(textarea, { key: "Enter" });
}

describe("BoardPage Add Card integration", () => {
	it("Treat refresh failure as synchronization failure", async () => {
		refresh
			.mockRejectedValueOnce(new Error("refresh failed"))
			.mockResolvedValueOnce(undefined);
		renderBoardView();

		openFirstAddCard();
		await waitFor(() => expect(getTitleTextarea()).toBeTruthy());
		const textarea = getTitleTextarea();
		fireEvent.change(textarea, { target: { value: "Sync test" } });
		fireEvent.click(screen.getAllByRole("button", { name: /add to board/i })[0]!);

		await waitFor(() => expect(createCard).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
		expect(createCard).toHaveBeenCalledTimes(1);
		expect(
			showToast.mock.calls.some((call) => String(call[0]).includes("refresh")),
		).toBe(true);
		expect(
			screen.queryByRole("combobox", { name: "Task title" }),
		).toBeNull();
	});

	it("mounts one catalog provider per Board workspace", async () => {
		const view = renderBoardView();
		await waitFor(() => expect(mockGetWorkspaceMembers).toHaveBeenCalledTimes(1));
		expect(mockListTrackerProjects).toHaveBeenCalledTimes(1);
		expect(
			mockListTrackerVocabularies.mock.calls.filter(([, kind]) => kind === "priority"),
		).toHaveLength(1);

		mockUseBoard.mockReturnValue({
			columns: boardColumns,
			setColumns: vi.fn(),
			loadError: false,
			refresh,
			cancelScheduledRefresh: vi.fn(),
			showToast,
			deleteCard: vi.fn(),
			saveCard: vi.fn(),
			activeWorkspaceId: 9,
			boardViewMode: "board",
			setBoardViewMode: vi.fn(),
		});
		view.rerender(<BoardPage />);

		await waitFor(() => expect(mockGetWorkspaceMembers).toHaveBeenCalledTimes(2));
		expect(mockGetWorkspaceMembers).toHaveBeenNthCalledWith(1, 7);
		expect(mockGetWorkspaceMembers).toHaveBeenNthCalledWith(2, 9);
		expect(mockListTrackerProjects).toHaveBeenCalledTimes(2);
	});

	it("propagates Board create field errors into Add Card", async () => {
		createCard.mockRejectedValueOnce(
			new ApiError("invalid metadata", 400, undefined, undefined, {
				projectId: "Project is no longer available.",
				assigneeIds: "Assignee is no longer a workspace member.",
			}),
		);
		renderBoardView();

		openFirstAddCard();
		await waitFor(() => expect(getTitleTextarea()).toBeTruthy());
		await pickFieldValue("Assignee", "Rafi");
		await pickFieldValue("Project", "Web");

		const textarea = getTitleTextarea();
		fireEvent.change(textarea, { target: { value: "Keep draft" } });
		fireEvent.click(screen.getAllByRole("button", { name: /add to board/i })[0]!);

		await waitFor(() => expect(createCard).toHaveBeenCalledTimes(1));
		expect(screen.getByRole("combobox", { name: "Task title" })).toBeTruthy();
		expect(textarea.value).toBe("Keep draft");
		const assigneeChip = screen.getAllByRole("button", {
			name: /^Assignee:\s*Rafi$/i,
		})[0];
		const projectChip = screen.getAllByRole("button", {
			name: /^Project:\s*Web$/i,
		})[0];
		expect(assigneeChip?.getAttribute("aria-invalid")).toBe("true");
		expect(projectChip?.getAttribute("aria-invalid")).toBe("true");
	});

	it("preserves Board draft for WIP network and server failures", async () => {
		const cases = [
			{
				name: "wip",
				error: new ApiError("wip", 409),
				toastKind: "warning",
			},
			{
				name: "network",
				error: new Error("network down"),
				toastKind: "error",
			},
			{
				name: "server",
				error: new ApiError("server boom", 500),
				toastKind: "error",
			},
		] as const;

		for (const testCase of cases) {
			createCard.mockReset().mockRejectedValueOnce(testCase.error);
			cleanup();
			renderBoardView();

			openFirstAddCard();
			await waitFor(() => expect(getTitleTextarea()).toBeTruthy());
			await pickFieldValue("Assignee", "Rafi");

			const textarea = getTitleTextarea();
			fireEvent.change(textarea, { target: { value: "Draft stays" } });
			fireEvent.click(
				screen.getAllByRole("button", { name: /add to board/i })[0]!,
			);

			await waitFor(() => expect(createCard).toHaveBeenCalledTimes(1));
			expect(screen.getByRole("combobox", { name: "Task title" })).toBeTruthy();
			expect(textarea.value).toBe("Draft stays");
			expect(
				screen.getByRole("button", { name: "Assignee: Rafi" }),
			).toBeTruthy();
			expect(
				showToast.mock.calls.some((call) => call[1] === testCase.toastKind),
			).toBe(true);
		}
	});
});
