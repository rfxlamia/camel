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
vi.mock("../api", () => ({
	api: {
		getWorkspaceMembers: (...a: unknown[]) => getWorkspaceMembers(...a),
		getCardActivity: (...a: unknown[]) => getCardActivity(...a),
	},
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
	getWorkspaceMembers.mockReset().mockResolvedValue({ members: [] });
	getCardActivity.mockReset().mockResolvedValue({ events: [] });
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
