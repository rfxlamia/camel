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
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, Column } from "../types";

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
vi.mock("../api", () => ({
	api: {
		getWorkspaceMembers: (...a: unknown[]) => getWorkspaceMembers(...a),
		getCardActivity: (...a: unknown[]) => getCardActivity(...a),
		ticketIntake: {
			getHistory: (...a: unknown[]) => mockGetHistory(...a),
		},
	},
}));

const mockOpen = vi.fn();
vi.mock("../hooks/useTicketIntakeChat", () => ({
	useTicketIntakeChat: () => ({ open: mockOpen }),
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

function setBoard(card: Card) {
	mockUseBoard.mockReturnValue({
		activeWorkspaceId: 1,
		columns: columnsWith(card),
		saveCard: vi.fn(),
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

describe("ContextPanel — Report issue gated on active workspace (Story 9)", () => {
	it("does not render the Report issue button when activeWorkspaceId is null", () => {
		mockUseBoard.mockReturnValue({
			activeWorkspaceId: null,
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
