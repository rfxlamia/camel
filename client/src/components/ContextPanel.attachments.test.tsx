// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, CardAttachment, Column } from "../types";

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
const uploadCardAttachments = vi.fn();
const deleteCardAttachment = vi.fn();
const listTrackerVocabularies = vi.fn();
const listTrackerProjects = vi.fn();
const getHistory = vi.fn();
vi.mock("../api", () => ({
	api: {
		getWorkspaceMembers: (...args: unknown[]) => getWorkspaceMembers(...args),
		getCardActivity: (...args: unknown[]) => getCardActivity(...args),
		uploadCardAttachments: (...args: unknown[]) =>
			uploadCardAttachments(...args),
		deleteCardAttachment: (...args: unknown[]) =>
			deleteCardAttachment(...args),
		listTrackerVocabularies: (...args: unknown[]) =>
			listTrackerVocabularies(...args),
		listTrackerProjects: (...args: unknown[]) => listTrackerProjects(...args),
		ticketIntake: {
			getHistory: (...args: unknown[]) => getHistory(...args),
		},
	},
}));

const prepareImageAttachment = vi.fn();
vi.mock("../lib/imageAttachments", () => ({
	MAX_ATTACHMENT_BYTES: 10 * 1024 * 1024,
	MAX_ATTACHMENT_COUNT: 3,
	prepareImageAttachment: (...args: unknown[]) =>
		prepareImageAttachment(...args),
}));

vi.mock("../hooks/useTicketIntakeChat", () => ({
	useTicketIntakeChat: () => ({
		open: vi.fn(),
		close: vi.fn(),
		panelOpen: false,
		activeVariant: "card",
	}),
}));

import ContextPanel from "./ContextPanel";

function makeAttachment(id: number): CardAttachment {
	return {
		id,
		thumbnailUrl: `/thumbnail/${id}`,
		originalUrl: `/original/${id}`,
		downloadUrl: `/download/${id}`,
		mimeType: "image/png",
		createdAt: "2026-09-05T10:00:00.000Z",
	};
}

function makeCard(attachments: CardAttachment[] = []): Card {
	return {
		id: 1,
		columnId: 1,
		title: "Card",
		description: "",
		position: 1024,
		version: 1,
		createdAt: "2026-09-05T10:00:00.000Z",
		updatedAt: "2026-09-05T10:00:00.000Z",
		startedAt: null,
		doneAt: null,
		dueDate: null,
		assignees: [],
		attachments,
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
	const refresh = vi.fn().mockResolvedValue(undefined);
	const cancelScheduledRefresh = vi.fn();
	mockUseBoard.mockReturnValue({
		activeWorkspaceId: 1,
		ticketIntakeEnabled: false,
		ticketIntakeEvents: [],
		focusModeEnabled: false,
		columns: columnsWith(card),
		saveCard: vi.fn().mockResolvedValue("saved"),
		deleteCard: vi.fn(),
		showToast: vi.fn(),
		setHasUnsavedCardEdits: vi.fn(),
		refresh,
		cancelScheduledRefresh,
	});
	return { refresh, cancelScheduledRefresh };
}

async function selectImage(): Promise<void> {
	fireEvent.click(screen.getByRole("button", { name: "Add images" }));
	fireEvent.click(screen.getByRole("button", { name: "Select images" }));
	const input = screen.getByLabelText("Select images") as HTMLInputElement;
	fireEvent.change(input, {
		target: {
			files: [new File(["png"], "image.png", { type: "image/png" })],
		},
	});
	await waitFor(() => expect(uploadCardAttachments).toHaveBeenCalledTimes(1));
}

const uploadResponse = {
	attachments: [makeAttachment(2)],
	acceptedCount: 1,
	addedCount: 1,
	rejectedCount: 0,
	requestedCount: 1,
	total: 2,
	totalCount: 2,
	limit: 3,
};

beforeEach(() => {
	mockUseBoard.mockReset();
	getWorkspaceMembers.mockReset().mockResolvedValue({ members: [] });
	getCardActivity.mockReset().mockResolvedValue({ events: [] });
	uploadCardAttachments.mockReset();
	deleteCardAttachment.mockReset();
	listTrackerVocabularies.mockReset().mockResolvedValue([]);
	listTrackerProjects.mockReset().mockResolvedValue([]);
	getHistory.mockReset().mockResolvedValue({ tickets: [] });
	prepareImageAttachment.mockReset().mockImplementation(async (input: Blob) => {
		const file = input as File;
		return {
			kind: "valid" as const,
			file,
			original: file,
			thumbnail: file,
			prepared: { thumbnail: file, original: file },
		};
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("ContextPanel attachment mutation refresh ordering", () => {
	it("cancels and explicitly refreshes only after successful upload and delete", async () => {
		uploadCardAttachments.mockResolvedValue(uploadResponse);
		deleteCardAttachment.mockResolvedValue(undefined);
		const { refresh, cancelScheduledRefresh } = setBoard(
			makeCard([makeAttachment(1)]),
		);
		render(<ContextPanel />);

		await selectImage();
		await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
		expect(cancelScheduledRefresh).toHaveBeenCalledTimes(1);
		expect(uploadCardAttachments.mock.invocationCallOrder[0]).toBeLessThan(
			cancelScheduledRefresh.mock.invocationCallOrder[0]!,
		);
		expect(cancelScheduledRefresh.mock.invocationCallOrder[0]).toBeLessThan(
			refresh.mock.invocationCallOrder[0]!,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Delete attachment 1" }),
		);
		fireEvent.click(
			within(
				screen.getByRole("dialog", { name: "Confirm attachment delete" }),
			).getByRole("button", { name: "Delete" }),
		);
		await waitFor(() => expect(deleteCardAttachment).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
		expect(cancelScheduledRefresh).toHaveBeenCalledTimes(2);
		expect(deleteCardAttachment.mock.invocationCallOrder[0]).toBeLessThan(
			cancelScheduledRefresh.mock.invocationCallOrder[1]!,
		);
		expect(cancelScheduledRefresh.mock.invocationCallOrder[1]).toBeLessThan(
			refresh.mock.invocationCallOrder[1]!,
		);
	});

	it("preserves a pending refresh when upload or delete fails", async () => {
		uploadCardAttachments.mockRejectedValue(new Error("upload failed"));
		deleteCardAttachment.mockRejectedValue(new Error("delete failed"));
		const { refresh, cancelScheduledRefresh } = setBoard(
			makeCard([makeAttachment(1)]),
		);
		render(<ContextPanel />);

		await selectImage();
		await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
		expect(cancelScheduledRefresh).not.toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();

		fireEvent.click(
			screen.getByRole("button", { name: "Delete attachment 1" }),
		);
		fireEvent.click(
			within(
				screen.getByRole("dialog", { name: "Confirm attachment delete" }),
			).getByRole("button", { name: "Delete" }),
		);
		await waitFor(() => expect(deleteCardAttachment).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
		expect(cancelScheduledRefresh).not.toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();
	});
});
