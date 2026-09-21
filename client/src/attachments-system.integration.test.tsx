// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type AttachmentViewerHarness,
	advanceRefreshDebounce,
	createAttachmentViewerHarness,
	emitAttachmentAddedEvent,
} from "./attachments-system.harness";
import type { Card, CardAttachment, Column, User } from "./types";

vi.mock("./shared/workspaceSelection", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("./shared/workspaceSelection")>();
	return {
		...actual,
		chooseInitialWorkspace: ({
			workspaces,
			savedWorkspaceId,
		}: {
			workspaces: { id: number }[];
			savedWorkspaceId: number | null;
		}) => {
			if (savedWorkspaceId !== null) {
				const saved = workspaces.find((w) => w.id === savedWorkspaceId);
				if (saved) {
					return {
						activeWorkspaceId: saved.id,
						pickerRequired: false,
						clearSavedWorkspace: false,
					};
				}
			}
			return {
				activeWorkspaceId: workspaces[0]?.id ?? null,
				pickerRequired: false,
				clearSavedWorkspace: false,
			};
		},
		readSavedWorkspaceId: () => 7,
		persistWorkspaceId: vi.fn(),
		clearSavedWorkspaceId: vi.fn(),
	};
});

import { BoardProvider, CardAttachments, useBoard } from "./features/board";
import { PresenceProvider } from "./shared/PresenceContext";
import { ToastProvider } from "./shared/ToastContext";
import { useWorkspace, WorkspaceProvider } from "./shared/WorkspaceContext";

const viewerUser: User = {
	id: 1,
	username: "alice",
	displayName: "Alice",
	emailVerified: true,
	needsUsername: false,
};

const remoteActor: User = {
	id: 2,
	username: "sinta",
	displayName: "Sinta",
	emailVerified: true,
	needsUsername: false,
};

function makeAttachment(id: number): CardAttachment {
	return {
		id,
		thumbnailUrl: `/api/workspaces/7/cards/42/attachments/${id}/thumbnail`,
		originalUrl: `/api/workspaces/7/cards/42/attachments/${id}/original`,
		downloadUrl: `/api/workspaces/7/cards/42/attachments/${id}/original/download`,
		mimeType: "image/png",
		createdAt: "2026-09-05T10:00:00.000Z",
	};
}

function makeCard(attachments: CardAttachment[]): Card {
	return {
		id: 42,
		columnId: 1,
		title: "Card with image",
		description: "",
		position: 1024,
		version: 1,
		createdAt: "2026-06-01T00:00:00Z",
		updatedAt: "2026-06-01T00:00:00Z",
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

describe("attachment viewer system contract", () => {
	let harness: AttachmentViewerHarness;
	const uploadSpy = vi.fn();

	function BoardCardAttachmentsSurface() {
		const { columns } = useBoard();
		const { activeWorkspaceId } = useWorkspace();
		const card = columns
			?.flatMap((column) => column.cards)
			.find((c) => c.id === 42);
		if (!card || activeWorkspaceId === null) return null;

		return (
			<CardAttachments
				card={card}
				workspaceId={activeWorkspaceId}
				onUpload={async (pairs) => {
					uploadSpy(pairs);
					throw new Error(
						"upload callback must not run in viewer refresh test",
					);
				}}
			/>
		);
	}

	beforeEach(() => {
		localStorage.clear();
		uploadSpy.mockReset();
		harness = createAttachmentViewerHarness({
			workspaceId: 7,
			cardId: 42,
			initialAttachments: [makeAttachment(1)],
			refreshedAttachments: [makeAttachment(1), makeAttachment(2)],
			columnsWith,
			makeCard,
		});
		harness.install();
	});

	afterEach(() => {
		harness.teardown();
		cleanup();
		localStorage.clear();
		vi.unstubAllGlobals();
	});

	it("refreshes mounted CardAttachments from 1/3 to 2/3 after attachment.added SSE", async () => {
		await act(async () => {
			render(
				<ToastProvider>
					<WorkspaceProvider user={viewerUser} onSignedOut={vi.fn()}>
						<PresenceProvider>
							<BoardProvider>
								<BoardCardAttachmentsSurface />
							</BoardProvider>
						</PresenceProvider>
					</WorkspaceProvider>
				</ToastProvider>,
			);
		});

		await waitFor(() => expect(screen.getByText("1/3")).toBeTruthy());
		expect(
			screen.getByRole("button", { name: "View attachment 1" }),
		).toBeTruthy();

		await emitAttachmentAddedEvent(harness, {
			type: "attachment.added",
			workspaceId: 7,
			cardId: 42,
			actor: remoteActor,
			payload: {
				attachmentId: 2,
				mimeType: "image/png",
				createdAt: "2026-09-05T10:02:00.000Z",
			},
		});
		await advanceRefreshDebounce();

		await waitFor(() =>
			expect(harness.getBoardCallCount()).toBeGreaterThanOrEqual(2),
		);
		await waitFor(() => expect(screen.getByText("2/3")).toBeTruthy());
		expect(
			screen.getByRole("button", { name: "View attachment 2" }),
		).toBeTruthy();
		expect(uploadSpy).not.toHaveBeenCalled();
	});
});
