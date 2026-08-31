// client/src/components/ContextPanel.test.tsx — NEW FILE (jsdom).
// Proves the DetailsSection server→form sync effect (the one whose deps trip
// biome's useExhaustiveDependencies). Two behaviors must hold:
//   1. A server card refresh (new version) adopts into the form when the draft
//      is clean.
//   2. The same refresh is IGNORED while the user has unsaved edits — the
//      draft is never clobbered.
// useBoard (context), react-router, and api are mocked so the test exercises
// only this component's sync logic.
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, Column, TrackerPhase, TrackerProject, TrackerVocabulary } from "../types";

const mockPriorities: TrackerVocabulary[] = [
	{
		id: 10,
		kind: "priority",
		name: "High",
		position: 1024,
		colour: "#f00",
	},
	{
		id: 11,
		kind: "priority",
		name: "Low",
		position: 2048,
		colour: "#00f",
	},
];

const mockLabels: TrackerVocabulary[] = [
	{
		id: 3,
		kind: "label",
		name: "Bug",
		position: 1024,
		colour: "#f00",
	},
];

const mockPhase: TrackerPhase = {
	id: 9,
	projectId: 1,
	name: "Q1",
	subtitle: "",
	startDate: null,
	endDate: null,
	position: 1024,
	version: 1,
	createdAt: "2026-08-01T00:00:00Z",
	updatedAt: "2026-08-01T00:00:00Z",
};

const mockProjects: TrackerProject[] = [
	{
		id: 1,
		name: "Alpha",
		startDate: null,
		endDate: null,
		position: 1024,
		version: 1,
		phases: [mockPhase],
	},
];

const mockUseBoard = vi.fn();
vi.mock("../context/BoardContext", () => ({
	useBoard: () => mockUseBoard(),
}));

vi.mock("react-router", () => ({
	useParams: () => ({ cardId: "1" }),
	useNavigate: () => vi.fn(),
}));

const getWorkspaceMembers = vi.fn();
const getCardActivity = vi.fn();
const mockGetHistory = vi.fn();
const listTrackerVocabularies = vi.fn();
const listTrackerProjects = vi.fn();
vi.mock("../api", () => ({
	api: {
		getWorkspaceMembers: (...a: unknown[]) => getWorkspaceMembers(...a),
		getCardActivity: (...a: unknown[]) => getCardActivity(...a),
		listTrackerVocabularies: (...a: unknown[]) =>
			listTrackerVocabularies(...a),
		listTrackerProjects: (...a: unknown[]) => listTrackerProjects(...a),
		ticketIntake: {
			getHistory: (...a: unknown[]) => mockGetHistory(...a),
		},
	},
}));

const mockOpen = vi.fn();
const mockClose = vi.fn();
vi.mock("../hooks/useTicketIntakeChat", () => ({
	useTicketIntakeChat: () => ({
		open: mockOpen,
		close: mockClose,
		panelOpen: false,
		activeVariant: "card",
	}),
}));

import ContextPanel from "./ContextPanel";

function makeCard(over: Partial<Card>): Card {
	return {
		id: 1,
		columnId: 1,
		title: "Original",
		description: "",
		position: 1024,
		version: 1,
		createdAt: "2026-06-01T00:00:00Z",
		startedAt: null,
		doneAt: null,
		dueDate: null,
		assignees: [],
		...over,
	};
}

function columnsWith(card: Card): Column[] {
	return [
		{
			id: 1,
			title: "Todo",
			position: 1024,
			wipLimit: null,
			policy: "",
			isDone: false,
			isSignable: false,
			signableAssigneeId: null,
			color: null,
			cards: [card],
		},
	];
}

function setBoard(card: Card, saveCard = vi.fn().mockResolvedValue("saved")) {
	mockUseBoard.mockReturnValue({
		activeWorkspaceId: 1,
		ticketIntakeEnabled: true,
		ticketIntakeEvents: [],
		columns: columnsWith(card),
		saveCard,
		deleteCard: vi.fn(),
		showToast: vi.fn(),
		setHasUnsavedCardEdits: vi.fn(),
	});
}

function titleInput(): HTMLInputElement {
	return screen.getByPlaceholderText("Card title") as HTMLInputElement;
}

beforeEach(() => {
	mockUseBoard.mockReset();
	mockOpen.mockReset();
	getWorkspaceMembers.mockReset().mockResolvedValue({ members: [] });
	getCardActivity.mockReset().mockResolvedValue({ events: [] });
	mockGetHistory.mockReset().mockResolvedValue({ tickets: [] });
	listTrackerVocabularies.mockReset();
	listTrackerProjects.mockReset();
	listTrackerVocabularies.mockImplementation((_ws: number, kind: string) => {
		if (kind === "priority") return Promise.resolve(mockPriorities);
		if (kind === "label") return Promise.resolve(mockLabels);
		return Promise.resolve([]);
	});
	listTrackerProjects.mockResolvedValue(mockProjects);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("ContextPanel server→form sync", () => {
	it("adopts a server refresh into the form when the draft is clean", async () => {
		setBoard(makeCard({ version: 1, title: "Original" }));
		const { rerender } = render(<ContextPanel />);
		await waitFor(() => expect(titleInput().value).toBe("Original"));

		// Simulate an SSE board refresh: same card id, new version + title.
		setBoard(makeCard({ version: 2, title: "Server Update" }));
		rerender(<ContextPanel />);

		await waitFor(() => expect(titleInput().value).toBe("Server Update"));
	});

	it("preserves an in-progress edit when a server refresh arrives", async () => {
		setBoard(makeCard({ version: 1, title: "Original" }));
		const { rerender } = render(<ContextPanel />);
		await waitFor(() => expect(titleInput().value).toBe("Original"));

		// User starts editing — draft is now dirty.
		fireEvent.change(titleInput(), { target: { value: "My local edit" } });
		expect(titleInput().value).toBe("My local edit");

		// A concurrent server refresh must NOT overwrite the dirty draft.
		setBoard(makeCard({ version: 2, title: "Server Update" }));
		rerender(<ContextPanel />);

		await waitFor(() => expect(getCardActivity).toHaveBeenCalled());
		expect(titleInput().value).toBe("My local edit");
	});
});

describe("ContextPanel — Report issue prefill", () => {
	it("opens the card-variant chat prefilled with title, description, and a link back to the card", () => {
		setBoard(
			makeCard({
				id: 1,
				title: "Fix login redirect",
				description: "Redirect loops on logout",
			}),
		);
		render(<ContextPanel />);

		fireEvent.click(screen.getByRole("button", { name: /report issue/i }));

		expect(mockOpen).toHaveBeenCalledWith(
			expect.objectContaining({
				variant: "card",
				prefill: expect.objectContaining({
					title: "Fix login redirect",
					description: "Redirect loops on logout",
					cardId: 1,
				}),
			}),
		);
	});
});

describe("ContextPanel — ticket history section", () => {
	it("shows 2 history entries with title, link, and relative time", async () => {
		mockGetHistory.mockResolvedValueOnce({
			tickets: [
				{
					title: "T1",
					issueUrl: "https://linear.app/cam/issue/CAM-1",
					createdAt: "2026-06-30T00:00:00Z",
				},
				{
					title: "T2",
					issueUrl: "https://linear.app/cam/issue/CAM-2",
					createdAt: "2026-06-29T00:00:00Z",
				},
			],
		});
		setBoard(makeCard({ id: 1 }));
		render(<ContextPanel />);

		await waitFor(() => {
			expect(screen.getAllByRole("link", { name: /CAM-/ })).toHaveLength(2);
		});
	});

	it("shows a lightweight empty state when there is no ticket history", async () => {
		mockGetHistory.mockResolvedValueOnce({ tickets: [] });
		setBoard(makeCard({ id: 1 }));
		render(<ContextPanel />);

		await waitFor(() => {
			expect(screen.getByText(/no ticket/i)).toBeTruthy();
		});
	});
});

describe("ContextPanel — taxonomy fields", () => {
	it("includes version and taxonomy ids in save, then adopts baseline after success", async () => {
		const saveCard = vi.fn().mockResolvedValue("saved");
		setBoard(
			makeCard({
				version: 3,
				priority: mockPriorities[1]!,
				labels: [],
				projectId: null,
				phaseId: null,
			}),
			saveCard,
		);
		const { rerender } = render(<ContextPanel />);

		await waitFor(() =>
			expect(screen.getByRole("button", { name: /low/i })).toBeTruthy(),
		);

		fireEvent.click(screen.getByRole("button", { name: /add label/i }));
		fireEvent.click(screen.getByRole("option", { name: "Bug" }));
		fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

		await waitFor(() => expect(saveCard).toHaveBeenCalled());
		await waitFor(() => expect(saveCard.mock.results[0]?.type).toBe("return"));
		const patch = saveCard.mock.calls[0]![1];
		expect(patch.version).toBe(3);
		expect(patch.labelIds).toEqual([3]);
		expect(patch).not.toHaveProperty("statusId");

		// Simulate SSE after successful save — baseline is clean so form adopts.
		setBoard(
			makeCard({
				version: 4,
				priority: mockPriorities[1]!,
				labels: mockLabels,
				projectId: 1,
				phaseId: 9,
			}),
			saveCard,
		);
		rerender(<ContextPanel />);

		await waitFor(() => {
			expect(
				within(screen.getByLabelText("Card taxonomy")).getByText("Bug"),
			).toBeTruthy();
		});
		await waitFor(() => {
			expect(screen.getByRole("button", { name: /alpha/i })).toBeTruthy();
		});
	});

	it("does not overwrite unsaved taxonomy edits on SSE refresh", async () => {
		setBoard(
			makeCard({
				version: 1,
				priority: null,
				labels: [],
			}),
		);
		const { rerender } = render(<ContextPanel />);

		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: /priority/i }),
			).toBeTruthy(),
		);

		fireEvent.click(screen.getByRole("button", { name: /priority/i }));
		fireEvent.click(screen.getByRole("option", { name: "High" }));

		setBoard(
			makeCard({
				version: 2,
				priority: mockPriorities[1]!,
				labels: mockLabels,
			}),
		);
		rerender(<ContextPanel />);

		await waitFor(() => expect(getCardActivity).toHaveBeenCalled());
		expect(
			within(screen.getByLabelText("Card taxonomy")).getByRole("button", {
				name: /high/i,
			}),
		).toBeTruthy();
		expect(
			within(screen.getByLabelText("Card taxonomy")).queryByText("Bug"),
		).toBeNull();
	});

	it("retains taxonomy selections when option lists are empty", async () => {
		listTrackerVocabularies.mockResolvedValue([]);
		listTrackerProjects.mockResolvedValue([]);
		setBoard(
			makeCard({
				priority: mockPriorities[0]!,
				labels: mockLabels,
				projectId: 1,
				projectName: "Alpha",
				phaseId: 9,
				phaseName: "Q1",
			}),
		);
		render(<ContextPanel />);

		await waitFor(() =>
			expect(
				within(screen.getByLabelText("Card taxonomy")).getByRole("button", {
					name: /high/i,
				}),
			).toBeTruthy(),
		);
		expect(
			within(screen.getByLabelText("Card taxonomy")).getByText("Bug"),
		).toBeTruthy();
	});

	it("does not render a status picker in the panel", async () => {
		setBoard(makeCard({}));
		render(<ContextPanel />);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: /priority/i }),
			).toBeTruthy(),
		);
		expect(screen.queryByRole("button", { name: /^status$/i })).toBeNull();
		expect(screen.queryByRole("combobox", { name: /change status/i })).toBeNull();
	});
});

describe("ContextPanel — Report issue gated on active workspace (Story 9)", () => {
	it("does not render the Report issue button when activeWorkspaceId is null", () => {
		mockUseBoard.mockReturnValue({
			activeWorkspaceId: null,
			ticketIntakeEnabled: true,
			ticketIntakeEvents: [],
			columns: columnsWith(makeCard({ id: 1 })),
			saveCard: vi.fn(),
			deleteCard: vi.fn(),
			showToast: vi.fn(),
			setHasUnsavedCardEdits: vi.fn(),
		});
		render(<ContextPanel />);
		expect(
			screen.queryByRole("button", { name: /report issue/i }),
		).toBeNull();
	});
});
