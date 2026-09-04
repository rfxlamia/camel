// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FocusSession, User } from "../types";

const {
	mockFocusGet,
	mockFocusPost,
	mockFocusPatch,
	focusEventHandlers,
	mockShowToast,
	mockSetHasActiveFocusSession,
	mockSetFocusSessionHydrated,
} = vi.hoisted(() => ({
	mockFocusGet: vi.fn(),
	mockFocusPost: vi.fn(),
	mockFocusPatch: vi.fn(),
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
				post: (...args: unknown[]) => mockFocusPost(...args),
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

function makeReadySession(
	overrides: Partial<FocusSession> = {},
): FocusSession {
	return {
		id: 2,
		state: "ready",
		accumulatedSeconds: 0,
		runningSince: null,
		version: 1,
		source: "board",
		taskId: 481,
		taskKey: "CA-42",
		returnPath: "/board/card/481",
		finishedAt: null,
		...overrides,
	};
}

function makeRunningSession(
	overrides: Partial<FocusSession> = {},
): FocusSession {
	return {
		id: 1,
		state: "running",
		accumulatedSeconds: 1200,
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

function makePausedSession(
	overrides: Partial<FocusSession> = {},
): FocusSession {
	return {
		...makeRunningSession(),
		state: "paused",
		runningSince: null,
		accumulatedSeconds: 1200,
		version: 3,
		...overrides,
	};
}

let activeWorkspaceId = 3;

function emitFocusEvent(event: {
	type: "focus_session.updated";
	userId: number;
	workspaceId: number;
	payload: { session: FocusSession | null };
}) {
	for (const handler of focusEventHandlers) {
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
	}),
}));

describe("FocusSessionProvider", () => {
	beforeEach(() => {
		activeWorkspaceId = 3;
		focusEventHandlers.clear();
		mockFocusGet.mockReset();
		mockFocusPost.mockReset();
		mockFocusPatch.mockReset();
		mockShowToast.mockReset();
		mockSetHasActiveFocusSession.mockReset();
		mockSetFocusSessionHydrated.mockReset();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("restores from the server when a Running session loads", async () => {
		const running = makeRunningSession();
		mockFocusGet.mockResolvedValue({ session: running });

		const { result } = renderHook(() => useFocusSession(), {
			wrapper: createWrapper(),
		});

		expect(result.current.session).toBeNull();
		expect(result.current.loading).toBe(true);

		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.session).toEqual(running);
		expect(mockSetHasActiveFocusSession).toHaveBeenCalledWith(true);
		expect(mockSetFocusSessionHydrated).toHaveBeenCalledWith(true);
	});

	it("session null silent settles empty without error or toast", async () => {
		mockFocusGet.mockResolvedValue({ session: null });

		const { result } = renderHook(() => useFocusSession(), {
			wrapper: createWrapper(),
		});

		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.session).toBeNull();
		expect(result.current.actionError).toBeNull();
		expect(mockShowToast).not.toHaveBeenCalled();
	});

	it("autoFinished toast warns when the task is missing", async () => {
		mockFocusGet.mockResolvedValue({
			session: null,
			autoFinished: { reason: "task_missing", taskKey: "CA-42" },
		});

		const { result } = renderHook(() => useFocusSession(), {
			wrapper: createWrapper(),
		});

		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.session).toBeNull();
		expect(mockShowToast).toHaveBeenCalledWith(
			expect.stringMatching(/no longer available/i),
			"warning",
		);
	});

	it("treats GET 404 as an empty session without surfacing an error", async () => {
		mockFocusGet.mockRejectedValue(
			new ApiError("Not found", 404, "not_found"),
		);

		const { result } = renderHook(() => useFocusSession(), {
			wrapper: createWrapper(),
		});

		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.session).toBeNull();
		expect(result.current.actionError).toBeNull();
		expect(mockShowToast).not.toHaveBeenCalled();
		expect(mockSetFocusSessionHydrated).toHaveBeenCalledWith(true);
	});

	it("clears stale session when the active workspace changes", async () => {
		const ws3Session = makeRunningSession({ version: 2 });
		let resolveWs4!: (value: { session: FocusSession | null }) => void;
		mockFocusGet.mockImplementation((workspaceId: number) => {
			if (workspaceId === 3) {
				return Promise.resolve({ session: ws3Session });
			}
			return new Promise((resolve) => {
				resolveWs4 = resolve;
			});
		});

		const { result, rerender } = renderHook(() => useFocusSession(), {
			wrapper: createWrapper(),
		});

		await waitFor(() => expect(result.current.session).toEqual(ws3Session));

		activeWorkspaceId = 4;
		rerender();

		expect(result.current.session).toBeNull();
		expect(result.current.loading).toBe(true);
		expect(mockSetHasActiveFocusSession).toHaveBeenCalledWith(false);
		expect(mockSetFocusSessionHydrated).toHaveBeenCalledWith(false);

		const ws4Session = makeReadySession({
			taskId: 77,
			source: "tracker",
			version: 1,
		});
		await act(async () => {
			resolveWs4({ session: ws4Session });
		});

		await waitFor(() => expect(result.current.session).toEqual(ws4Session));
		expect(mockSetFocusSessionHydrated).toHaveBeenCalledWith(true);
	});

	it("ignores a stale workspace response after switching workspaces", async () => {
		let resolveWs3!: (value: { session: FocusSession | null }) => void;
		let resolveWs4!: (value: { session: FocusSession | null }) => void;
		mockFocusGet.mockImplementation((workspaceId: number) => {
			if (workspaceId === 3) {
				return new Promise((resolve) => {
					resolveWs3 = resolve;
				});
			}
			return new Promise((resolve) => {
				resolveWs4 = resolve;
			});
		});

		const { result, rerender } = renderHook(() => useFocusSession(), {
			wrapper: createWrapper(),
		});

		activeWorkspaceId = 4;
		rerender();

		const ws4Session = makeReadySession({ taskId: 77, source: "tracker" });
		await act(async () => {
			resolveWs4({ session: ws4Session });
		});
		await waitFor(() => expect(result.current.session).toEqual(ws4Session));

		await act(async () => {
			resolveWs3({ session: makeRunningSession() });
		});

		expect(result.current.session).toEqual(ws4Session);
	});

	it("focus posts the board contract and adopts Ready", async () => {
		mockFocusGet.mockResolvedValue({ session: null });
		const ready = makeReadySession();
		mockFocusPost.mockResolvedValue({ session: ready });

		const { result } = renderHook(() => useFocusSession(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.loading).toBe(false));

		await act(async () => {
			await result.current.focus({ source: "board", taskId: 481 });
		});

		expect(mockFocusPost).toHaveBeenCalledWith(3, {
			action: "focus",
			source: "board",
			taskId: 481,
		});
		expect(result.current.session).toEqual(ready);
	});

	it("switchTo posts the switch contract and adopts the new task", async () => {
		const active = makeReadySession({ taskId: 481, version: 2 });
		mockFocusGet.mockResolvedValue({ session: active });
		const switched = makeReadySession({
			taskId: 77,
			source: "tracker",
			version: 1,
		});
		mockFocusPost.mockResolvedValue({ session: switched });

		const { result } = renderHook(() => useFocusSession(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.session).toEqual(active));

		await act(async () => {
			await result.current.switchTo({
				source: "tracker",
				taskId: 77,
				version: 2,
			});
		});

		expect(mockFocusPost).toHaveBeenCalledWith(3, {
			action: "switch",
			source: "tracker",
			taskId: 77,
			version: 2,
		});
		expect(result.current.session).toEqual(switched);
	});

	it("start sends the lifecycle patch and adopts Running", async () => {
		const ready = makeReadySession();
		const running = makeRunningSession({ version: 2 });
		mockFocusGet.mockResolvedValue({ session: ready });
		mockFocusPatch.mockResolvedValue({ session: running });

		const { result } = renderHook(() => useFocusSession(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.session).toEqual(ready));

		await act(async () => {
			await result.current.start();
		});

		expect(mockFocusPatch).toHaveBeenCalledWith(3, {
			action: "start",
			version: 1,
		});
		expect(result.current.session).toEqual(running);
	});

	it("pause sends the lifecycle patch and adopts Paused", async () => {
		const running = makeRunningSession();
		const paused = makePausedSession();
		mockFocusGet.mockResolvedValue({ session: running });
		mockFocusPatch.mockResolvedValue({ session: paused });

		const { result } = renderHook(() => useFocusSession(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.session).toEqual(running));

		await act(async () => {
			await result.current.pause();
		});

		expect(mockFocusPatch).toHaveBeenCalledWith(3, {
			action: "pause",
			version: 2,
		});
		expect(result.current.session).toEqual(paused);
	});

	it("resume sends the lifecycle patch and adopts Running", async () => {
		const paused = makePausedSession();
		const running = makeRunningSession({ version: 4 });
		mockFocusGet.mockResolvedValue({ session: paused });
		mockFocusPatch.mockResolvedValue({ session: running });

		const { result } = renderHook(() => useFocusSession(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.session).toEqual(paused));

		await act(async () => {
			await result.current.resume();
		});

		expect(mockFocusPatch).toHaveBeenCalledWith(3, {
			action: "resume",
			version: 3,
		});
		expect(result.current.session).toEqual(running);
	});

	it("finish returns the finished payload and clears local session", async () => {
		const running = makeRunningSession();
		const finished = {
			...running,
			state: "finished" as const,
			runningSince: null,
			finishedAt: "2026-09-04T12:00:00.000Z",
			version: 3,
		};
		mockFocusGet.mockResolvedValue({ session: running });
		mockFocusPatch.mockResolvedValue({ session: finished });

		const { result } = renderHook(() => useFocusSession(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.session).toEqual(running));

		let returned!: FocusSession;
		await act(async () => {
			returned = await result.current.finish();
		});

		expect(mockFocusPatch).toHaveBeenCalledWith(3, {
			action: "finish",
			version: 2,
		});
		expect(returned).toEqual(finished);
		expect(result.current.session).toBeNull();
		expect(mockSetHasActiveFocusSession).toHaveBeenCalledWith(false);
	});

	it("exposes a retryable error when Start fails with 5xx", async () => {
		const ready = makeReadySession();
		const running = makeRunningSession({ version: 2 });
		mockFocusGet.mockResolvedValue({ session: ready });
		mockFocusPatch
			.mockRejectedValueOnce(new ApiError("Server error", 500))
			.mockResolvedValueOnce({ session: running });

		const { result } = renderHook(() => useFocusSession(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.session).toEqual(ready));

		await act(async () => {
			await result.current.start();
		});

		expect(result.current.session).toEqual(ready);
		expect(result.current.actionError).toMatch(/Server error/);

		await act(async () => {
			await result.current.start();
		});

		expect(result.current.session).toEqual(running);
		expect(result.current.actionError).toBeNull();
	});

	it("version_conflict adopts the body session silently on resume", async () => {
		const paused = makePausedSession({ version: 3 });
		const reconciled = makePausedSession({ version: 4 });
		const running = makeRunningSession({ version: 5 });
		mockFocusGet.mockResolvedValue({ session: paused });
		mockFocusPatch
			.mockRejectedValueOnce(
				new ApiError("Conflict", 409, "version_conflict", undefined, undefined, reconciled),
			)
			.mockResolvedValueOnce({ session: running });

		const { result } = renderHook(() => useFocusSession(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.session).toEqual(paused));

		await act(async () => {
			await result.current.resume();
		});

		expect(result.current.session).toEqual(reconciled);
		expect(result.current.actionError).toBeNull();
		expect(mockFocusGet).toHaveBeenCalledTimes(1);

		await act(async () => {
			await result.current.resume();
		});

		expect(mockFocusPatch).toHaveBeenLastCalledWith(3, {
			action: "resume",
			version: 4,
		});
	});

	it("version_conflict null clears local session without GET or error", async () => {
		const paused = makePausedSession({ version: 3 });
		mockFocusGet.mockResolvedValue({ session: paused });
		mockFocusPatch.mockRejectedValue(
			new ApiError("Conflict", 409, "version_conflict", undefined, undefined, null),
		);

		const { result } = renderHook(() => useFocusSession(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.session).toEqual(paused));

		await act(async () => {
			await result.current.pause();
		});

		expect(result.current.session).toBeNull();
		expect(result.current.actionError).toBeNull();
		expect(mockFocusGet).toHaveBeenCalledTimes(1);
	});

	it("session_active adopts the current session and rethrows", async () => {
		mockFocusGet.mockResolvedValue({ session: null });
		const active = makeReadySession({ taskId: 10, version: 2 });
		mockFocusPost.mockRejectedValue(
			new ApiError("Conflict", 409, "session_active", undefined, undefined, active),
		);

		const { result } = renderHook(() => useFocusSession(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.loading).toBe(false));

		let caught: unknown;
		await act(async () => {
			try {
				await result.current.focus({ source: "board", taskId: 481 });
			} catch (err) {
				caught = err;
			}
		});

		expect(caught).toMatchObject({ code: "session_active" });
		await waitFor(() => expect(result.current.session).toEqual(active));
		expect(result.current.actionError).toBeNull();
	});

	it("switchTo version_conflict adopts the body session silently", async () => {
		const active = makeReadySession({ version: 2 });
		const reconciled = makeReadySession({ version: 4, taskId: 77, source: "tracker" });
		mockFocusGet.mockResolvedValue({ session: active });
		mockFocusPost.mockRejectedValue(
			new ApiError(
				"Conflict",
				409,
				"version_conflict",
				undefined,
				undefined,
				reconciled,
			),
		);

		const { result } = renderHook(() => useFocusSession(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.session).toEqual(active));

		await act(async () => {
			await result.current.switchTo({
				source: "tracker",
				taskId: 77,
				version: 2,
			});
		});

		expect(result.current.session).toEqual(reconciled);
		expect(result.current.actionError).toBeNull();
	});

	it("invalid_transition uses the generic actionError path", async () => {
		const ready = makeReadySession();
		mockFocusGet.mockResolvedValue({ session: ready });
		mockFocusPatch.mockRejectedValue(
			new ApiError("Conflict", 409, "invalid_transition", undefined, undefined, ready),
		);

		const { result } = renderHook(() => useFocusSession(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.session).toEqual(ready));

		await act(async () => {
			await result.current.start();
		});

		expect(result.current.session).toEqual(ready);
		expect(result.current.actionError).toMatch(/Conflict/);
	});

	it("tab B pauses updates the Running session from SSE", async () => {
		const running = makeRunningSession({ version: 2 });
		const paused = makePausedSession({ version: 3 });
		mockFocusGet.mockResolvedValue({ session: running });

		const { result } = renderHook(() => useFocusSession(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.session).toEqual(running));

		await act(async () => {
			emitFocusEvent({
				type: "focus_session.updated",
				userId: 7,
				workspaceId: 3,
				payload: { session: paused },
			});
		});

		expect(result.current.session).toEqual(paused);
		expect(mockFocusGet).toHaveBeenCalledTimes(1);
	});

	it("payload.session null clears local state without refetch", async () => {
		const running = makeRunningSession();
		mockFocusGet.mockResolvedValue({ session: running });

		const { result } = renderHook(() => useFocusSession(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.session).toEqual(running));

		await act(async () => {
			emitFocusEvent({
				type: "focus_session.updated",
				userId: 7,
				workspaceId: 3,
				payload: { session: null },
			});
		});

		expect(result.current.session).toBeNull();
		expect(mockFocusGet).toHaveBeenCalledTimes(1);
	});

	it("other user focus event does not change local session", async () => {
		const running = makeRunningSession();
		const paused = makePausedSession();
		mockFocusGet.mockResolvedValue({ session: running });

		const { result } = renderHook(() => useFocusSession(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.session).toEqual(running));

		await act(async () => {
			emitFocusEvent({
				type: "focus_session.updated",
				userId: 9,
				workspaceId: 3,
				payload: { session: paused },
			});
		});

		expect(result.current.session).toEqual(running);
		expect(mockFocusGet).toHaveBeenCalledTimes(1);
	});
});
