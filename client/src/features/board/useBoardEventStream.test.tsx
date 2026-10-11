import { act, cleanup, renderHook } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardProvider } from "./BoardProvider";
import { useBoard } from "./boardContextDefinition";

const mocks = vi.hoisted(() => ({
	workspaceId: 7 as number | null,
	getBoard: vi.fn(),
	settings: vi.fn(),
	reload: vi.fn(),
	switch: vi.fn(),
	toast: vi.fn(),
	signOut: vi.fn(),
}));
vi.mock("../../api", () => ({
	api: {
		getBoard: mocks.getBoard,
		getMetrics: vi.fn().mockResolvedValue(null),
		getActivity: vi.fn().mockResolvedValue({ events: [] }),
	},
	ApiError: class extends Error {},
}));
vi.mock("../../shared/WorkspaceContext", () => ({
	useWorkspace: () => ({
		activeWorkspaceId: mocks.workspaceId,
		user: { id: 1 },
		workspaces: [],
		refreshSettings: mocks.settings,
		reloadWorkspaces: mocks.reload,
		switchWorkspace: mocks.switch,
		signOutLocally: mocks.signOut,
	}),
}));
vi.mock("../../shared/ToastContext", () => ({
	useShowToast: () => mocks.toast,
}));
class MockEventSource {
	static instances: MockEventSource[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	close = vi.fn();
	constructor(public url: string) {
		MockEventSource.instances.push(this);
	}
}
beforeEach(() => {
	vi.clearAllMocks();
	mocks.workspaceId = 7;
	MockEventSource.instances = [];
	mocks.getBoard.mockResolvedValue({ columns: [] });
	vi.stubGlobal("EventSource", MockEventSource);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
function wrapper({ children }: ComponentProps<typeof BoardProvider>) {
	return <BoardProvider>{children}</BoardProvider>;
}
describe("SSE connection revisions", () => {
	it("increments a numeric revision on open and reconnect without inventing log events", async () => {
		const { result } = renderHook(useBoard, { wrapper });
		const stream = MockEventSource.instances[0];
		expect(result.current.connectionRevision).toBe(0);
		await act(async () => {
			stream.onopen?.();
		});
		expect(result.current.connectionRevision).toBe(1);
		await act(async () => {
			stream.onopen?.();
		});
		expect(result.current.connectionRevision).toBe(2);
		expect(result.current.agentEvents).toEqual([]);
	});
	it("ignores callbacks from a closed workspace connection", async () => {
		const { result, rerender, unmount } = renderHook(useBoard, { wrapper });
		const old = MockEventSource.instances[0];
		const oldOpen = old.onopen;
		const oldMessage = old.onmessage;
		mocks.workspaceId = 9;
		rerender();
		expect(old.close).toHaveBeenCalled();
		const calls = mocks.getBoard.mock.calls.length;
		const revision = result.current.connectionRevision;
		await act(async () => {
			oldOpen?.();
			oldMessage?.({
				data: JSON.stringify({ type: "agent.board.failed", boardId: 1 }),
			});
		});
		expect(mocks.getBoard).toHaveBeenCalledTimes(calls);
		expect(result.current.connectionRevision).toBe(revision);
		expect(result.current.agentEvents).toEqual([]);
		const latest = MockEventSource.instances.at(-1);
		const latestOpen = latest?.onopen;
		unmount();
		latestOpen?.();
		expect(mocks.getBoard).toHaveBeenCalledTimes(calls);
	});
});
