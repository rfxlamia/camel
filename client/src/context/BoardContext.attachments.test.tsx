// @vitest-environment jsdom
import {
	act,
	cleanup,
	render,
	waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../types";

const mockGetBoard = vi.fn();
const mockGetWorkspaces = vi.fn();
const mockGetMetrics = vi.fn();
const mockGetActivity = vi.fn();
const mockGetSettings = vi.fn();
const mockHeartbeat = vi.fn();
const mockGetPresence = vi.fn();

vi.mock("../api", () => ({
	api: {
		getBoard: (...a: unknown[]) => mockGetBoard(...a),
		getWorkspaces: (...a: unknown[]) => mockGetWorkspaces(...a),
		getMetrics: (...a: unknown[]) => mockGetMetrics(...a),
		getActivity: (...a: unknown[]) => mockGetActivity(...a),
		getSettings: (...a: unknown[]) => mockGetSettings(...a),
		heartbeat: (...a: unknown[]) => mockHeartbeat(...a),
		getPresence: (...a: unknown[]) => mockGetPresence(...a),
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
	mockGetBoard.mockResolvedValue({ columns: [] });
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

import { BoardProvider, useBoard } from "./BoardContext";
import { PresenceProvider } from "./PresenceContext";
import { ToastProvider } from "./ToastContext";
import { WorkspaceProvider } from "./WorkspaceContext";

async function renderBoard(children: React.ReactNode) {
	await act(async () => {
		render(
			<ToastProvider>
				<WorkspaceProvider user={testUser} onSignedOut={vi.fn()}>
					<PresenceProvider>
						<BoardProvider>
							{children}
						</BoardProvider>
					</PresenceProvider>
				</WorkspaceProvider>
			</ToastProvider>,
		);
	});
	await waitFor(() => expect(mockGetBoard).toHaveBeenCalled());
	mockGetBoard.mockClear();
}

describe("BoardContext attachment SSE", () => {
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

	it("attachment.added fans out to card subscribers and schedules board refresh", async () => {
		const cardHandler = vi.fn();

		function Probe() {
			const { subscribeCardEvents } = useBoard();
			React.useEffect(
				() => subscribeCardEvents(cardHandler),
				[subscribeCardEvents],
			);
			return null;
		}

		await renderBoard(<Probe />);

		const attachmentEvent = {
			type: "attachment.added",
			actor: testActor,
			cardId: 42,
			payload: {
				attachmentId: 9,
				mimeType: "image/png",
				createdAt: "2026-09-05T10:00:00.000Z",
			},
		};
		await emitSse(attachmentEvent);

		expect(cardHandler).toHaveBeenCalledWith(attachmentEvent);
		await advanceRefreshDebounce();
		expect(mockGetBoard).toHaveBeenCalled();
	});

	it("attachment.removed fans out to card subscribers and schedules board refresh", async () => {
		const cardHandler = vi.fn();

		function Probe() {
			const { subscribeCardEvents } = useBoard();
			React.useEffect(
				() => subscribeCardEvents(cardHandler),
				[subscribeCardEvents],
			);
			return null;
		}

		await renderBoard(<Probe />);

		const attachmentEvent = {
			type: "attachment.removed",
			actor: testActor,
			cardId: 42,
			payload: {
				attachmentId: 9,
				mimeType: "image/png",
				createdAt: "2026-09-05T10:00:00.000Z",
			},
		};
		await emitSse(attachmentEvent);

		expect(cardHandler).toHaveBeenCalledWith(attachmentEvent);
		await advanceRefreshDebounce();
		expect(mockGetBoard).toHaveBeenCalled();
	});
});
