// @vitest-environment jsdom
import {
	act,
	cleanup,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../types";

const mockGetBoard = vi.fn();
const mockGetWorkspaces = vi.fn();
const mockGetMetrics = vi.fn();
const mockGetActivity = vi.fn();
const mockGetSettings = vi.fn();
const mockHeartbeat = vi.fn();
const mockGetPresence = vi.fn();
const mockFocusGetConfig = vi.fn();

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
			getConfig: (...a: unknown[]) => mockFocusGetConfig(...a),
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

const testActor = {
	id: 1,
	username: "alice",
	displayName: "Alice",
	emailVerified: true,
	needsUsername: false,
};

function setupApiMocks(
	workspaces: Array<{
		id: number;
		name: string;
		role: string;
		isPersonal: boolean;
		memberCount: number;
	}> = [
		{
			id: 7,
			name: "Workspace A",
			role: "member",
			isPersonal: false,
			memberCount: 2,
		},
		{
			id: 99,
			name: "Personal",
			role: "owner",
			isPersonal: true,
			memberCount: 1,
		},
	],
) {
	mockGetWorkspaces.mockResolvedValue({ workspaces, invites: [] });
	mockGetBoard.mockResolvedValue({ columns: [] });
	mockGetMetrics.mockResolvedValue(null);
	mockGetActivity.mockResolvedValue({ events: [] });
	mockGetSettings.mockResolvedValue({ settings: {} });
	mockHeartbeat.mockResolvedValue({ ok: true });
	mockGetPresence.mockResolvedValue({ users: [] });
	mockFocusGetConfig.mockResolvedValue({ enabled: false });
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

async function renderBoard(children: React.ReactNode) {
	await act(async () => {
		render(
			<BoardProvider user={testUser} onSignedOut={vi.fn()}>
				{children}
			</BoardProvider>,
		);
	});
	await waitFor(() => expect(mockGetBoard).toHaveBeenCalled());
	const callsAfterLoad = mockGetBoard.mock.calls.length;
	mockGetBoard.mockClear();
	return callsAfterLoad;
}

describe("BoardContext focus SSE seams", () => {
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

	it("focus_session.updated reaches subscribers without scheduling board refresh", async () => {
		const focusHandler = vi.fn();
		let unsubscribe = () => {};

		function Probe() {
			const { subscribeFocusEvents } = useBoard();
			React.useEffect(() => {
				unsubscribe = subscribeFocusEvents(focusHandler);
				return unsubscribe;
			}, [subscribeFocusEvents]);
			return null;
		}

		await renderBoard(<Probe />);

		const event = {
			type: "focus_session.updated",
			userId: 1,
			workspaceId: 7,
			payload: { session: null },
		};
		await emitSse(event);

		expect(focusHandler).toHaveBeenCalledWith(event);
		await advanceRefreshDebounce();
		expect(mockGetBoard).not.toHaveBeenCalled();

		focusHandler.mockClear();
		unsubscribe();
		await emitSse(event);
		expect(focusHandler).not.toHaveBeenCalled();
	});

	it("card.updated fans out to subscribers and still schedules board refresh", async () => {
		const cardHandler = vi.fn();
		const trackerHandler = vi.fn();
		let unsubscribeCard = () => {};

		function Probe() {
			const { subscribeCardEvents, subscribeTrackerEvents } = useBoard();
			React.useEffect(() => {
				unsubscribeCard = subscribeCardEvents(cardHandler);
				const unsubTracker = subscribeTrackerEvents(trackerHandler);
				return () => {
					unsubscribeCard();
					unsubTracker();
				};
			}, [subscribeCardEvents, subscribeTrackerEvents]);
			return null;
		}

		await renderBoard(<Probe />);

		const cardEvent = {
			type: "card.updated",
			actor: testActor,
			cardId: 481,
			payload: { key: "CAM-42" },
		};
		await emitSse(cardEvent);
		expect(cardHandler).toHaveBeenCalledWith(cardEvent);
		await advanceRefreshDebounce();
		expect(mockGetBoard).toHaveBeenCalled();

		cardHandler.mockClear();
		trackerHandler.mockClear();
		mockGetBoard.mockClear();

		const trackerEvent = {
			type: "tracker.updated",
			actor: testActor,
			trackerItemId: 77,
		};
		await emitSse(trackerEvent);
		expect(cardHandler).not.toHaveBeenCalled();
		expect(trackerHandler).toHaveBeenCalledWith(trackerEvent);

		cardHandler.mockClear();
		unsubscribeCard();
		await emitSse(cardEvent);
		expect(cardHandler).not.toHaveBeenCalled();
	});

	it("card.deleted fans out to subscribers and still schedules board refresh", async () => {
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

		const cardEvent = {
			type: "card.deleted",
			actor: testActor,
			cardId: 481,
			payload: { key: "CAM-42" },
		};
		await emitSse(cardEvent);
		expect(cardHandler).toHaveBeenCalledWith(cardEvent);
		await advanceRefreshDebounce();
		expect(mockGetBoard).toHaveBeenCalled();
	});

	it("tracker.deleted fans out to tracker subscribers", async () => {
		const trackerHandler = vi.fn();

		function Probe() {
			const { subscribeTrackerEvents } = useBoard();
			React.useEffect(
				() => subscribeTrackerEvents(trackerHandler),
				[subscribeTrackerEvents],
			);
			return null;
		}

		await renderBoard(<Probe />);

		const trackerEvent = {
			type: "tracker.deleted",
			actor: testActor,
			trackerItemId: 77,
		};
		await emitSse(trackerEvent);
		expect(trackerHandler).toHaveBeenCalledWith(trackerEvent);
	});

	it("membership.removed reaches subscribers and preserves redirect behavior", async () => {
		const membershipHandler = vi.fn();
		let unsubscribe = () => {};

		function Probe() {
			const { subscribeMembershipEvents, toast } = useBoard();
			React.useEffect(() => {
				unsubscribe = subscribeMembershipEvents(membershipHandler);
				return unsubscribe;
			}, [subscribeMembershipEvents]);
			return <span data-testid="toast">{toast?.message ?? ""}</span>;
		}

		await renderBoard(<Probe />);

		const redirectEvent = {
			type: "membership.removed",
			userId: testUser.id,
			workspaceId: 7,
			workspaceName: "Removed Workspace",
		};
		await emitSse(redirectEvent);
		expect(membershipHandler).toHaveBeenCalledWith(redirectEvent);
		await waitFor(() =>
			expect(screen.getByTestId("toast").textContent).toMatch(
				/You were removed from Removed Workspace/,
			),
		);

		membershipHandler.mockClear();
		mockGetWorkspaces.mockResolvedValue({
			workspaces: [
				{
					id: 7,
					name: "Workspace A",
					role: "member",
					isPersonal: false,
					memberCount: 2,
				},
				{
					id: 9,
					name: "Workspace B",
					role: "member",
					isPersonal: false,
					memberCount: 3,
				},
			],
			invites: [],
		});
		await act(async () => {
			cleanup();
			MockEventSource.instances = [];
			render(
				<BoardProvider user={testUser} onSignedOut={vi.fn()}>
					<Probe />
				</BoardProvider>,
			);
		});
		await waitFor(() => expect(mockGetBoard).toHaveBeenCalled());

		const noRedirectEvent = {
			type: "membership.removed",
			userId: testUser.id,
			workspaceId: 9,
			workspaceName: "Workspace B",
		};
		await emitSse(noRedirectEvent);
		expect(membershipHandler).toHaveBeenCalledWith(noRedirectEvent);

		membershipHandler.mockClear();
		unsubscribe();
		const otherUserEvent = {
			type: "membership.removed",
			userId: 999,
			workspaceId: 7,
			workspaceName: "Removed Workspace",
		};
		await emitSse(otherUserEvent);
		expect(membershipHandler).not.toHaveBeenCalled();
	});

	it("focus flags on the real provider expose defaults and setters", async () => {
		function Probe() {
			const {
				hasActiveFocusSession,
				focusSessionHydrated,
				setHasActiveFocusSession,
				setFocusSessionHydrated,
			} = useBoard();
			return (
				<>
					<span data-testid="has-active">{String(hasActiveFocusSession)}</span>
					<span data-testid="hydrated">{String(focusSessionHydrated)}</span>
					<span data-testid="has-set-active">
						{String(typeof setHasActiveFocusSession === "function")}
					</span>
					<span data-testid="has-set-hydrated">
						{String(typeof setFocusSessionHydrated === "function")}
					</span>
				</>
			);
		}

		await renderBoard(<Probe />);

		expect(screen.getByTestId("has-active").textContent).toBe("false");
		expect(screen.getByTestId("hydrated").textContent).toBe("false");
		expect(screen.getByTestId("has-set-active").textContent).toBe("true");
		expect(screen.getByTestId("has-set-hydrated").textContent).toBe("true");
	});
});

// React is used only for hooks in probe components.
import React from "react";
