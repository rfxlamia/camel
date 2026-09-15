// @vitest-environment jsdom
import {
	act,
	cleanup,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, CardAttachment, Column, User } from "../types";

const mockGetBoard = vi.fn();
const mockGetWorkspaces = vi.fn();
const mockGetMetrics = vi.fn();
const mockGetActivity = vi.fn();
const mockGetSettings = vi.fn();
const mockHeartbeat = vi.fn();
const mockGetPresence = vi.fn();
const mockUploadCardAttachments = vi.fn();
const mockDeleteCardAttachment = vi.fn();

vi.mock("../api", () => ({
	api: {
		getBoard: (...a: unknown[]) => mockGetBoard(...a),
		getWorkspaces: (...a: unknown[]) => mockGetWorkspaces(...a),
		getMetrics: (...a: unknown[]) => mockGetMetrics(...a),
		getActivity: (...a: unknown[]) => mockGetActivity(...a),
		getSettings: (...a: unknown[]) => mockGetSettings(...a),
		heartbeat: (...a: unknown[]) => mockHeartbeat(...a),
		getPresence: (...a: unknown[]) => mockGetPresence(...a),
		uploadCardAttachments: (...a: unknown[]) =>
			mockUploadCardAttachments(...a),
		deleteCardAttachment: (...a: unknown[]) => mockDeleteCardAttachment(...a),
		ticketIntake: {
			getConfig: vi.fn().mockResolvedValue({ enabled: false }),
		},
		focus: {
			getConfig: vi.fn().mockResolvedValue({ enabled: false }),
		},
	},
	ApiError: class ApiError extends Error {
		status: number;
		constructor(message: string, status = 0) {
			super(message);
			this.status = status;
		}
	},
}));

vi.mock("../lib/workspaceSelection", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../lib/workspaceSelection")>();
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

class MockEventSource {
	static instances: MockEventSource[] = [];
	url: string;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	close = vi.fn();
	constructor(url: string) {
		this.url = url;
		MockEventSource.instances.push(this);
	}
}
vi.stubGlobal("EventSource", MockEventSource);

import { api } from "../api";
import { BoardProvider, useBoard } from "../context/BoardContext";
import { ToastProvider } from "../context/ToastContext";
import CardAttachments from "./CardAttachments";

const testUser: User = {
	id: 1,
	username: "alice",
	displayName: "Alice",
	emailVerified: true,
	needsUsername: false,
};

const testActor: User = {
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

function setupApiMocks(initialAttachments: CardAttachment[]) {
	mockGetWorkspaces.mockResolvedValue({
		workspaces: [
			{
				id: 7,
				name: "Workspace A",
				role: "member",
				isPersonal: false,
				memberCount: 2,
			},
		],
		invites: [],
	});
	mockGetBoard.mockResolvedValue({
		columns: columnsWith(makeCard(initialAttachments)),
	});
	mockGetMetrics.mockResolvedValue(null);
	mockGetActivity.mockResolvedValue({ events: [] });
	mockGetSettings.mockResolvedValue({ settings: {} });
	mockHeartbeat.mockResolvedValue({ ok: true });
	mockGetPresence.mockResolvedValue({ users: [] });
}

function getEventSource(): MockEventSource {
	const instance = MockEventSource.instances.at(-1);
	if (!instance) throw new Error("EventSource not created");
	return instance;
}

async function emitSse(data: Record<string, unknown>) {
	const stream = getEventSource();
	await act(async () => {
		stream.onmessage?.({ data: JSON.stringify(data) });
	});
}

async function advanceRefreshDebounce() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 200));
	});
}

function BoardCardAttachmentsProbe() {
	const { columns, activeWorkspaceId, refresh, cancelScheduledRefresh } =
		useBoard();
	const card = columns?.flatMap((column) => column.cards).find((c) => c.id === 42);
	if (!card || activeWorkspaceId === null) return null;

	return (
		<CardAttachments
			card={card}
			workspaceId={activeWorkspaceId}
			onUpload={async (pairs) => {
				cancelScheduledRefresh();
				const response = await api.uploadCardAttachments(
					activeWorkspaceId,
					card.id,
					pairs,
				);
				await refresh();
				return response;
			}}
			onDelete={async (attachmentId) => {
				cancelScheduledRefresh();
				await api.deleteCardAttachment(
					activeWorkspaceId,
					card.id,
					attachmentId,
				);
				await refresh();
			}}
		/>
	);
}

describe("CardAttachments SSE gallery refresh", () => {
	beforeEach(() => {
		localStorage.clear();
		MockEventSource.instances = [];
		setupApiMocks([makeAttachment(1)]);
	});

	afterEach(() => {
		cleanup();
		localStorage.clear();
		vi.clearAllMocks();
	});

	it("updates the counter and gallery after attachment.added refreshes the board", async () => {
		await act(async () => {
			render(
				<ToastProvider>
					<BoardProvider user={testUser} onSignedOut={vi.fn()}>
						<BoardCardAttachmentsProbe />
					</BoardProvider>
				</ToastProvider>,
			);
		});

		await waitFor(() => expect(screen.getByText("1/3")).toBeTruthy());
		expect(
			screen.getByRole("button", { name: "View attachment 1" }),
		).toBeTruthy();

		mockGetBoard.mockResolvedValueOnce({
			columns: columnsWith(
				makeCard([
					makeAttachment(1),
					makeAttachment(2),
					makeAttachment(3),
				]),
			),
		});

		await emitSse({
			type: "attachment.added",
			actor: testActor,
			cardId: 42,
			payload: {
				attachmentId: 3,
				mimeType: "image/png",
				createdAt: "2026-09-05T10:02:00.000Z",
			},
		});
		await advanceRefreshDebounce();

		await waitFor(() => expect(mockGetBoard).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(screen.getByText("3/3")).toBeTruthy());
		expect(
			screen.getByRole("button", { name: "View attachment 3" }),
		).toBeTruthy();
	});
});
