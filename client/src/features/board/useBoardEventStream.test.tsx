import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
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
	workspaces: [] as Array<{
		id: number;
		name: string;
		role: string;
		isPersonal: boolean;
		memberCount: number;
	}>,
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
		workspaces: mocks.workspaces,
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
	mocks.workspaces = [];
	MockEventSource.instances = [];
	mocks.getBoard.mockResolvedValue({ columns: [] });
	mocks.reload.mockResolvedValue([]);
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

describe("membership.removed handling", () => {
	const personalWorkspace = {
		id: 1,
		name: "Personal",
		role: "owner",
		isPersonal: true,
		memberCount: 1,
	};

	function removalEvent(reason?: string) {
		return JSON.stringify({
			type: "membership.removed",
			userId: 1,
			workspaceId: 7,
			workspaceName: "Beta WS",
			...(reason ? { reason } : {}),
		});
	}

	it("redirects to the personal workspace with a warning toast on removal", async () => {
		mocks.workspaces = [personalWorkspace];
		renderHook(useBoard, { wrapper });
		const stream = MockEventSource.instances[0];

		await act(async () => {
			stream.onmessage?.({ data: removalEvent() });
		});

		expect(mocks.toast).toHaveBeenCalledWith(
			"You were removed from Beta WS.",
			"warning",
		);
		await waitFor(() => {
			expect(mocks.switch).toHaveBeenCalledWith(1);
		});
	});

	it("skips the removal redirect for a self-leave echo (reason: left)", async () => {
		mocks.workspaces = [personalWorkspace];
		renderHook(useBoard, { wrapper });
		const stream = MockEventSource.instances[0];

		await act(async () => {
			stream.onmessage?.({ data: removalEvent("left") });
		});

		expect(mocks.toast).not.toHaveBeenCalled();
		expect(mocks.switch).not.toHaveBeenCalled();
		expect(mocks.reload).not.toHaveBeenCalled();
	});
});
