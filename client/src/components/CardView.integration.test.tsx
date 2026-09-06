// @vitest-environment jsdom
import {
	act,
	cleanup,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardProvider, useBoard } from "../context/BoardContext";
import type { User } from "../types";
import { CardBody } from "./CardView";

const mockGetBoard = vi.fn();
const mockGetWorkspaces = vi.fn();
const mockGetMetrics = vi.fn();
const mockGetActivity = vi.fn();
const mockGetSettings = vi.fn();
const mockHeartbeat = vi.fn();
const mockGetPresence = vi.fn();

vi.mock("../api", () => ({
	api: {
		getBoard: (...args: unknown[]) => mockGetBoard(...args),
		getWorkspaces: (...args: unknown[]) => mockGetWorkspaces(...args),
		getMetrics: (...args: unknown[]) => mockGetMetrics(...args),
		getActivity: (...args: unknown[]) => mockGetActivity(...args),
		getSettings: (...args: unknown[]) => mockGetSettings(...args),
		heartbeat: (...args: unknown[]) => mockHeartbeat(...args),
		getPresence: (...args: unknown[]) => mockGetPresence(...args),
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
	close = vi.fn();
	constructor(url: string) {
		this.url = url;
		MockEventSource.instances.push(this);
	}
}
vi.stubGlobal("EventSource", MockEventSource);

const testUser: User = {
	id: 1,
	username: "alice",
	displayName: "Alice",
	emailVerified: true,
	needsUsername: false,
};

function serverBoardWithAttachments() {
	const workspaceId = 7;
	const cardId = 42;
	const makeServerAttachment = (id: number, label: "A" | "B" | "C") => ({
		id,
		thumbnailUrl: `/api/workspaces/${workspaceId}/cards/${cardId}/attachments/${id}/thumbnail-${label}`,
		originalUrl: `/api/workspaces/${workspaceId}/cards/${cardId}/attachments/${id}/original-${label}`,
		downloadUrl: `/api/workspaces/${workspaceId}/cards/${cardId}/attachments/${id}/original/download-${label}`,
		mimeType: "image/png",
		createdAt: `2026-09-05T10:0${id}:00.000Z`,
	});

	return {
		columns: [
			{
				id: 1,
				title: "Todo",
				position: 1,
				wipLimit: null,
				policy: "",
				isDone: false,
				isSignable: false,
				signableAssigneeId: null,
				color: null,
				cards: [
					{
						id: cardId,
						key: "WS-42",
						columnId: 1,
						title: "Hydrated cover card",
						description: "",
						position: 1,
						version: 1,
						createdAt: "2026-09-05T09:00:00.000Z",
						updatedAt: "2026-09-05T09:00:00.000Z",
						startedAt: null,
						doneAt: null,
						dueDate: null,
						assignees: [],
						attachments: [
							makeServerAttachment(1, "A"),
							makeServerAttachment(2, "B"),
							makeServerAttachment(3, "C"),
						],
					},
				],
			},
		],
	};
}

function setupApiMocks() {
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
	mockGetBoard.mockResolvedValue(serverBoardWithAttachments());
	mockGetMetrics.mockResolvedValue(null);
	mockGetActivity.mockResolvedValue({ events: [] });
	mockGetSettings.mockResolvedValue({ settings: {} });
	mockHeartbeat.mockResolvedValue({ ok: true });
	mockGetPresence.mockResolvedValue({ users: [] });
}

function HydratedCardBodyProbe() {
	const { columns } = useBoard();
	const card = columns?.[0]?.cards[0];
	if (!card) {
		return <span data-testid="board-loading">loading</span>;
	}
	return <CardBody card={card} />;
}

async function renderHydratedBoard() {
	await act(async () => {
		render(
			<BoardProvider user={testUser} onSignedOut={vi.fn()}>
				<HydratedCardBodyProbe />
			</BoardProvider>,
		);
	});
	await waitFor(() => expect(mockGetBoard).toHaveBeenCalled());
	await waitFor(() =>
		expect(screen.queryByTestId("board-loading")).toBeNull(),
	);
}

describe("CardBody hydrated board cover", () => {
	beforeEach(() => {
		localStorage.clear();
		MockEventSource.instances = [];
		setupApiMocks();
	});

	afterEach(() => {
		cleanup();
		localStorage.clear();
		vi.clearAllMocks();
	});

	it("renders the server-ordered cover from a hydrated board response", async () => {
		const board = serverBoardWithAttachments();
		const coverUrl = board.columns[0].cards[0].attachments[0].thumbnailUrl;

		await renderHydratedBoard();

		const cover = screen.getByRole("img", {
			name: "Attachment preview for Hydrated cover card",
		});
		expect(cover.getAttribute("src")).toBe(coverUrl);
		expect(screen.getByText("+2")).toBeTruthy();
		expect(screen.getByLabelText("2 more attachments")).toBeTruthy();
		expect(screen.getByText("Hydrated cover card")).toBeTruthy();
	});
});
