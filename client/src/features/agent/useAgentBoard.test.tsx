import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api";
import type { AgentBoard, AgentEvent } from "../../types";
import { useAgentBoard } from "./useAgentBoard";

const mocks = vi.hoisted(() => ({
	workspaceId: 7 as number | null,
	events: [] as AgentEvent[],
	revision: 0,
	clear: vi.fn(),
	toast: vi.fn(),
	get: vi.fn(),
	retry: vi.fn(),
	approve: vi.fn(),
	create: vi.fn(),
	artifact: vi.fn(),
}));
vi.mock("../../api", () => ({
	api: {
		getAgentBoard: mocks.get,
		retryAgentBoard: mocks.retry,
		approveAgentBoard: mocks.approve,
		createAgentBoard: mocks.create,
		getAgentArtifact: mocks.artifact,
	},
	ApiError: class extends Error {
		constructor(
			message: string,
			public status: number,
		) {
			super(message);
		}
	},
}));
vi.mock("../../shared/WorkspaceContext", () => ({
	useWorkspace: () => ({ activeWorkspaceId: mocks.workspaceId }),
}));
vi.mock("../../shared/ToastContext", () => ({
	useShowToast: () => mocks.toast,
}));
vi.mock("../board", () => ({
	useBoard: () => ({
		agentEvents: mocks.events,
		connectionRevision: mocks.revision,
		clearAgentEvents: mocks.clear,
	}),
}));
const board = (
	id: number,
	executionStatus: AgentBoard["executionStatus"] = "running",
): AgentBoard =>
	({
		id,
		executionStatus,
		status: "approved",
		originalIntent: "Plan",
		templateId: "dev-team",
		createdAt: "2026-01-01",
		columns: [],
	}) as unknown as AgentBoard;
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}
function setup(initialEntry = "/agent?boardId=1") {
	return renderHook(
		() => {
			const state = useAgentBoard();
			const [params, navigate] = useSearchParams();
			return { ...state, params, navigate };
		},
		{
			wrapper: ({ children }) => (
				<MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>
			),
		},
	);
}
beforeEach(() => {
	vi.resetAllMocks();
	mocks.workspaceId = 7;
	mocks.events = [];
	mocks.revision = 0;
	mocks.get.mockImplementation(async (_workspace: number, id: number) =>
		board(id),
	);
	mocks.retry.mockResolvedValue({ boardId: 2 });
	mocks.approve.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("agent board retry and synchronization", () => {
	it("retries into a fresh child URL without approving or replacing the source", async () => {
		const { result } = setup();
		await waitFor(() => expect(result.current.board?.id).toBe(1));
		await act(async () => {
			await result.current.handleApproveOrRetry("retry");
		});
		expect(mocks.retry).toHaveBeenCalledWith(7, 1);
		expect(mocks.approve).not.toHaveBeenCalled();
		expect(result.current.params.get("boardId")).toBe("2");
		await waitFor(() => expect(result.current.board?.id).toBe(2));
	});
	it.each([
		403, 409, 422, 429,
	])("keeps the source selected when retry is denied (%s)", async (status) => {
		mocks.retry.mockRejectedValue(new ApiError("Retry denied", status));
		const { result } = setup();
		await waitFor(() => expect(result.current.board?.id).toBe(1));
		await act(async () => {
			await result.current.handleApproveOrRetry("retry");
		});
		expect(result.current.params.get("boardId")).toBe("1");
		expect(result.current.error).toBe("Retry denied");
	});
	it("prevents duplicate synchronous retries", async () => {
		const pending = deferred<{ boardId: number }>();
		mocks.retry.mockReturnValue(pending.promise);
		const { result } = setup();
		await waitFor(() => expect(result.current.board?.id).toBe(1));
		let action!: Promise<void>;
		act(() => {
			action = result.current.handleApproveOrRetry("retry");
			void result.current.handleApproveOrRetry("retry");
		});
		expect(mocks.retry).toHaveBeenCalledTimes(1);
		await act(async () => {
			pending.resolve({ boardId: 2 });
			await action;
		});
	});
	it.each([
		"terminal",
		"reconnect",
	])("refetches running → failed on %s", async (trigger) => {
		const { result, rerender } = setup();
		await waitFor(() =>
			expect(result.current.board?.executionStatus).toBe("running"),
		);
		mocks.get.mockResolvedValue(board(1, "failed"));
		if (trigger === "terminal")
			mocks.events = [{ type: "agent.board.failed", boardId: 1 }];
		else mocks.revision++;
		rerender();
		await waitFor(() =>
			expect(result.current.board?.executionStatus).toBe("failed"),
		);
	});
	it("does not refetch for another board's terminal event", async () => {
		const { result, rerender } = setup();
		await waitFor(() => expect(result.current.board?.id).toBe(1));
		const calls = mocks.get.mock.calls.length;
		mocks.events = [{ type: "agent.board.failed", boardId: 99 }];
		rerender();
		expect(mocks.get).toHaveBeenCalledTimes(calls);
	});
	it("discards earlier same-board fetch results", async () => {
		const old = deferred<AgentBoard>();
		mocks.get.mockReturnValueOnce(old.promise);
		const { result, rerender } = setup();
		mocks.get.mockResolvedValue(board(1, "failed"));
		mocks.revision++;
		rerender();
		await waitFor(() =>
			expect(result.current.board?.executionStatus).toBe("failed"),
		);
		await act(async () => {
			old.resolve(board(1));
		});
		expect(result.current.board?.executionStatus).toBe("failed");
		expect(result.current.loading).toBe(false);
	});
	it("discards stale initial success and finally when the selected board changes", async () => {
		const old = deferred<AgentBoard>();
		const next = deferred<AgentBoard>();
		mocks.get
			.mockReturnValueOnce(old.promise)
			.mockReturnValueOnce(next.promise);
		const { result } = setup();
		act(() => result.current.navigate({ boardId: "2" }));
		await act(async () => {
			old.resolve(board(1));
		});
		expect(result.current.board).toBeNull();
		expect(result.current.loading).toBe(true);
		await act(async () => {
			next.resolve(board(2));
		});
		expect(result.current.board?.id).toBe(2);
	});
	it("discards stale failures without clearing the newer URL", async () => {
		const old = deferred<AgentBoard>();
		mocks.get.mockReturnValueOnce(old.promise);
		const { result } = setup();
		act(() => result.current.navigate({ boardId: "2" }));
		await waitFor(() => expect(result.current.board?.id).toBe(2));
		await act(async () => {
			old.reject(new Error("old error"));
		});
		expect(result.current.params.get("boardId")).toBe("2");
		expect(mocks.toast).not.toHaveBeenCalled();
	});
	it.each([
		"workspace",
		"board",
	])("ignores retry completion after switching %s", async (switchTo) => {
		const pending = deferred<{ boardId: number }>();
		mocks.retry.mockReturnValue(pending.promise);
		const { result, rerender } = setup();
		await waitFor(() => expect(result.current.board?.id).toBe(1));
		let action!: Promise<void>;
		act(() => {
			action = result.current.handleApproveOrRetry("retry");
		});
		if (switchTo === "workspace") {
			mocks.workspaceId = 9;
			rerender();
		} else act(() => result.current.navigate({ boardId: "3" }));
		await act(async () => {
			pending.resolve({ boardId: 2 });
			await action;
		});
		expect(result.current.params.get("boardId")).toBe(
			switchTo === "workspace" ? "1" : "3",
		);
	});
	it("resolves create only after the board ref is ready for queued messages", async () => {
		mocks.create.mockResolvedValue({ boardId: 2 });
		const pendingBoard = deferred<AgentBoard>();
		mocks.get
			.mockReturnValueOnce(pendingBoard.promise)
			.mockResolvedValue(board(2));
		const { result } = setup("/agent");
		let action!: Promise<void>;
		act(() => {
			action = result.current.createBoard("Plan");
		});
		await waitFor(() => expect(mocks.get).toHaveBeenCalledWith(7, 2));
		expect(result.current.boardRef.current).toBeNull();
		await act(async () => {
			pendingBoard.resolve(board(2));
			await action;
			expect(result.current.boardRef.current?.id).toBe(2);
		});
		expect(result.current.params.get("boardId")).toBe("2");
	});

	it("ignores create completion after switching workspace", async () => {
		const pending = deferred<{ boardId: number }>();
		mocks.create.mockReturnValue(pending.promise);
		const { result, rerender } = setup();
		let action!: Promise<void>;
		act(() => {
			action = result.current.createBoard("Plan");
		});
		mocks.workspaceId = 9;
		rerender();
		await act(async () => {
			pending.resolve({ boardId: 2 });
			await action;
		});
		expect(result.current.params.get("boardId")).toBe("1");
	});
});
