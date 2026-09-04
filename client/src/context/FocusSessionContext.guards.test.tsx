// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FocusSession, User } from "../types";

const {
	mockFocusGet,
	mockFocusPatch,
	cardEventHandlers,
	trackerEventHandlers,
	membershipEventHandlers,
	focusEventHandlers,
	mockShowToast,
	mockSetHasActiveFocusSession,
	mockSetFocusSessionHydrated,
} = vi.hoisted(() => ({
	mockFocusGet: vi.fn(),
	mockFocusPatch: vi.fn(),
	cardEventHandlers: new Set<
		(event: {
			type: string;
			actor: User;
			cardId: number;
			payload?: unknown;
		}) => void
	>(),
	trackerEventHandlers: new Set<
		(event: {
			type: string;
			payload?: unknown;
			trackerItemId?: number;
		}) => void
	>(),
	membershipEventHandlers: new Set<
		(event: {
			type: "membership.removed";
			userId: number;
			workspaceId: number;
			workspaceName: string;
		}) => void
	>(),
	focusEventHandlers: new Set<
		(event: {
			type: "focus_session.updated";
			userId: number;
			workspaceId: number;
			payload: { session: FocusSession | null };
		}) => void
	>(),
	mockShowToast: vi.fn(),
	mockSetHasActiveFocusSession: vi.fn(),
	mockSetFocusSessionHydrated: vi.fn(),
}));

vi.mock("../api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../api")>();
	return {
		...actual,
		api: {
			...actual.api,
			focus: {
				...actual.api.focus,
				get: (...args: unknown[]) => mockFocusGet(...args),
				patch: (...args: unknown[]) => mockFocusPatch(...args),
			},
		},
	};
});

import { ApiError } from "../api";
import {
	FocusSessionProvider,
	useFocusSession,
} from "../context/FocusSessionContext";

const testUser: User = {
	id: 7,
	username: "ana",
	displayName: "Ana",
	emailVerified: true,
	needsUsername: false,
};

const testActor: User = {
	id: 1,
	username: "bob",
	displayName: "Bob",
	emailVerified: true,
	needsUsername: false,
};

function makeBoardSession(
	overrides: Partial<FocusSession> = {},
): FocusSession {
	return {
		id: 1,
		state: "running",
		accumulatedSeconds: 600,
		runningSince: "2026-09-04T10:00:00.000Z",
		version: 2,
		source: "board",
		taskId: 481,
		taskKey: "CA-42",
		returnPath: "/board/card/481",
		finishedAt: null,
		...overrides,
	};
}

function makeTrackerSession(
	overrides: Partial<FocusSession> = {},
): FocusSession {
	return {
		id: 2,
		state: "running",
		accumulatedSeconds: 300,
		runningSince: "2026-09-04T10:00:00.000Z",
		version: 1,
		source: "tracker",
		taskId: 77,
		taskKey: "CAM-77",
		returnPath: "/tracker/CAM-77",
		finishedAt: null,
		...overrides,
	};
}

let activeWorkspaceId = 3;

function emitCardEvent(event: {
	type: string;
	actor: User;
	cardId: number;
	payload?: unknown;
}) {
	for (const handler of cardEventHandlers) {
		handler(event);
	}
}

function emitTrackerEvent(event: {
	type: string;
	payload?: unknown;
	trackerItemId?: number;
}) {
	for (const handler of trackerEventHandlers) {
		handler(event);
	}
}

function emitMembershipEvent(event: {
	type: "membership.removed";
	userId: number;
	workspaceId: number;
	workspaceName: string;
}) {
	for (const handler of membershipEventHandlers) {
		handler(event);
	}
}

function createWrapper() {
	return function Wrapper({ children }: { children: ReactNode }) {
		return <FocusSessionProvider>{children}</FocusSessionProvider>;
	};
}

vi.mock("./BoardContext", () => ({
	useBoard: () => ({
		activeWorkspaceId,
		user: testUser,
		showToast: mockShowToast,
		setHasActiveFocusSession: mockSetHasActiveFocusSession,
		setFocusSessionHydrated: mockSetFocusSessionHydrated,
		subscribeFocusEvents: (
			handler: (event: {
				type: "focus_session.updated";
				userId: number;
				workspaceId: number;
				payload: { session: FocusSession | null };
			}) => void,
		) => {
			focusEventHandlers.add(handler);
			return () => {
				focusEventHandlers.delete(handler);
			};
		},
		subscribeCardEvents: (
			handler: (event: {
				type: string;
				actor: User;
				cardId: number;
				payload?: unknown;
			}) => void,
		) => {
			cardEventHandlers.add(handler);
			return () => {
				cardEventHandlers.delete(handler);
			};
		},
		subscribeTrackerEvents: (
			handler: (event: {
				type: string;
				payload?: unknown;
				trackerItemId?: number;
			}) => void,
		) => {
			trackerEventHandlers.add(handler);
			return () => {
				trackerEventHandlers.delete(handler);
			};
		},
		subscribeMembershipEvents: (
			handler: (event: {
				type: "membership.removed";
				userId: number;
				workspaceId: number;
				workspaceName: string;
			}) => void,
		) => {
			membershipEventHandlers.add(handler);
			return () => {
				membershipEventHandlers.delete(handler);
			};
		},
	}),
}));

async function loadSession(session: FocusSession) {
	mockFocusGet.mockResolvedValue({ session });
	const hook = renderHook(() => useFocusSession(), {
		wrapper: createWrapper(),
	});
	await waitFor(() => expect(hook.result.current.session).toEqual(session));
	return hook;
}

describe("FocusSessionProvider live auto-finish guards", () => {
	beforeEach(() => {
		activeWorkspaceId = 3;
		cardEventHandlers.clear();
		trackerEventHandlers.clear();
		membershipEventHandlers.clear();
		focusEventHandlers.clear();
		mockFocusGet.mockReset();
		mockFocusPatch.mockReset();
		mockShowToast.mockReset();
		mockSetHasActiveFocusSession.mockReset();
		mockSetFocusSessionHydrated.mockReset();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("matching card deleted auto-finishes board session", async () => {
		const session = makeBoardSession();
		const finished = { ...session, state: "finished" as const, version: 3 };
		mockFocusPatch.mockResolvedValue({ session: finished });

		const { result } = await loadSession(session);

		await act(async () => {
			emitCardEvent({
				type: "card.deleted",
				actor: testActor,
				cardId: 481,
				payload: {},
			});
		});

		await waitFor(() => expect(mockFocusPatch).toHaveBeenCalled());
		expect(mockFocusPatch).toHaveBeenCalledWith(3, {
			action: "finish",
			version: 2,
		});
		expect(result.current.session).toBeNull();
		expect(mockShowToast).toHaveBeenCalledWith(
			expect.stringMatching(/no longer available/i),
			"warning",
		);
	});

	it("different cardId leaves board session unchanged", async () => {
		const session = makeBoardSession();
		const { result } = await loadSession(session);

		await act(async () => {
			emitCardEvent({
				type: "card.deleted",
				actor: testActor,
				cardId: 482,
				payload: {},
			});
		});

		expect(mockFocusPatch).not.toHaveBeenCalled();
		expect(result.current.session).toEqual(session);
		expect(mockShowToast).not.toHaveBeenCalled();
	});

	it("matching tracker deleted auto-finishes tracker session", async () => {
		const session = makeTrackerSession();
		const finished = { ...session, state: "finished" as const, version: 2 };
		mockFocusPatch.mockResolvedValue({ session: finished });

		const { result } = await loadSession(session);

		await act(async () => {
			emitTrackerEvent({
				type: "tracker.deleted",
				trackerItemId: 77,
			});
		});

		await waitFor(() => expect(mockFocusPatch).toHaveBeenCalled());
		expect(mockFocusPatch).toHaveBeenCalledWith(3, {
			action: "finish",
			version: 1,
		});
		expect(result.current.session).toBeNull();
		expect(mockShowToast).toHaveBeenCalledWith(
			expect.stringMatching(/no longer available/i),
			"warning",
		);
	});

	it("colliding tracker deleted ignores board session", async () => {
		const session = makeBoardSession();
		const { result } = await loadSession(session);

		await act(async () => {
			emitTrackerEvent({
				type: "tracker.deleted",
				trackerItemId: 481,
			});
		});

		expect(mockFocusPatch).not.toHaveBeenCalled();
		expect(result.current.session).toEqual(session);
		expect(mockShowToast).not.toHaveBeenCalled();
	});

	it("different trackerItemId leaves tracker session unchanged", async () => {
		const session = makeTrackerSession();
		const { result } = await loadSession(session);

		await act(async () => {
			emitTrackerEvent({
				type: "tracker.deleted",
				trackerItemId: 99,
			});
		});

		expect(mockFocusPatch).not.toHaveBeenCalled();
		expect(result.current.session).toEqual(session);
		expect(mockShowToast).not.toHaveBeenCalled();
	});

	it("colliding card deleted ignores tracker session", async () => {
		const session = makeTrackerSession({ taskId: 481 });
		const { result } = await loadSession(session);

		await act(async () => {
			emitCardEvent({
				type: "card.deleted",
				actor: testActor,
				cardId: 481,
				payload: {},
			});
		});

		expect(mockFocusPatch).not.toHaveBeenCalled();
		expect(result.current.session).toEqual(session);
		expect(mockShowToast).not.toHaveBeenCalled();
	});

	it("card updated does not finish board session", async () => {
		const session = makeBoardSession();
		const { result } = await loadSession(session);

		await act(async () => {
			emitCardEvent({
				type: "card.updated",
				actor: testActor,
				cardId: 481,
				payload: { title: "Renamed" },
			});
		});

		expect(mockFocusPatch).not.toHaveBeenCalled();
		expect(result.current.session).toEqual(session);
		expect(mockShowToast).not.toHaveBeenCalled();
	});

	it("tracker updated does not finish tracker session", async () => {
		const session = makeTrackerSession();
		const { result } = await loadSession(session);

		await act(async () => {
			emitTrackerEvent({
				type: "tracker.updated",
				trackerItemId: 77,
				payload: { title: "Renamed" },
			});
		});

		expect(mockFocusPatch).not.toHaveBeenCalled();
		expect(result.current.session).toEqual(session);
		expect(mockShowToast).not.toHaveBeenCalled();
	});

	it("deleted finish 409 still clears local session", async () => {
		const session = makeBoardSession();
		const conflictBody = makeBoardSession({ version: 5 });
		mockFocusPatch.mockRejectedValue(
			new ApiError(
				"Conflict",
				409,
				"version_conflict",
				undefined,
				undefined,
				conflictBody,
			),
		);

		const { result } = await loadSession(session);

		await act(async () => {
			emitCardEvent({
				type: "card.deleted",
				actor: testActor,
				cardId: 481,
				payload: {},
			});
		});

		await waitFor(() => expect(result.current.session).toBeNull());
		expect(mockShowToast).toHaveBeenCalledWith(
			expect.stringMatching(/no longer available/i),
			"warning",
		);
	});

	it("deleted finish 5xx still clears local session", async () => {
		const session = makeBoardSession();
		mockFocusPatch.mockRejectedValue(new ApiError("Server error", 500));

		const { result } = await loadSession(session);

		await act(async () => {
			emitCardEvent({
				type: "card.deleted",
				actor: testActor,
				cardId: 481,
				payload: {},
			});
		});

		await waitFor(() => expect(result.current.session).toBeNull());
		expect(mockShowToast).toHaveBeenCalledWith(
			expect.stringMatching(/no longer available/i),
			"warning",
		);
	});

	it("matching membership removed clears session even on 404", async () => {
		const session = makeBoardSession();
		mockFocusPatch.mockRejectedValue(new ApiError("Not found", 404));

		const { result } = await loadSession(session);

		await act(async () => {
			emitMembershipEvent({
				type: "membership.removed",
				userId: 7,
				workspaceId: 3,
				workspaceName: "Workspace 3",
			});
		});

		await waitFor(() => expect(result.current.session).toBeNull());
		expect(mockShowToast).toHaveBeenCalledWith(
			expect.stringMatching(/no longer have access/i),
			"warning",
		);
	});

	it("different user membership leaves session unchanged", async () => {
		const session = makeBoardSession();
		const { result } = await loadSession(session);

		await act(async () => {
			emitMembershipEvent({
				type: "membership.removed",
				userId: 9,
				workspaceId: 3,
				workspaceName: "Workspace 3",
			});
		});

		expect(mockFocusPatch).not.toHaveBeenCalled();
		expect(result.current.session).toEqual(session);
		expect(mockShowToast).not.toHaveBeenCalled();
	});

	it("no session card deleted is inert", async () => {
		mockFocusGet.mockResolvedValue({ session: null });
		const { result } = renderHook(() => useFocusSession(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.session).toBeNull();

		await act(async () => {
			emitCardEvent({
				type: "card.deleted",
				actor: testActor,
				cardId: 481,
				payload: {},
			});
		});

		expect(mockFocusPatch).not.toHaveBeenCalled();
		expect(mockShowToast).not.toHaveBeenCalled();
	});

	it("no session tracker deleted is inert", async () => {
		mockFocusGet.mockResolvedValue({ session: null });
		const { result } = renderHook(() => useFocusSession(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.loading).toBe(false));

		await act(async () => {
			emitTrackerEvent({
				type: "tracker.deleted",
				trackerItemId: 77,
			});
		});

		expect(mockFocusPatch).not.toHaveBeenCalled();
		expect(mockShowToast).not.toHaveBeenCalled();
	});

	it("no session membership removed is inert", async () => {
		mockFocusGet.mockResolvedValue({ session: null });
		const { result } = renderHook(() => useFocusSession(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.loading).toBe(false));

		await act(async () => {
			emitMembershipEvent({
				type: "membership.removed",
				userId: 7,
				workspaceId: 3,
				workspaceName: "Workspace 3",
			});
		});

		expect(mockFocusPatch).not.toHaveBeenCalled();
		expect(mockShowToast).not.toHaveBeenCalled();
	});
});
