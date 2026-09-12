// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import {
	MemoryRouter,
	Route,
	Routes,
	useLocation,
	useNavigate,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../../types";
import type { MyWorkItem, MyWorkListResponse } from "../../types/myWork";

const {
	mockListActive,
	mockListAll,
	mockGetDetail,
	mockGetWorkspaces,
	mockGetBoard,
	mockGetMetrics,
	mockGetActivity,
	mockGetSettings,
	mockHeartbeat,
	mockGetPresence,
	mockFocusConfig,
	MockApiError,
} = vi.hoisted(() => {
	class HoistedApiError extends Error {
		status: number;
		code?: string;

		constructor(message: string, status: number, code?: string) {
			super(message);
			this.status = status;
			this.code = code;
		}
	}

	return {
		mockListActive: vi.fn(),
		mockListAll: vi.fn(),
		mockGetDetail: vi.fn(),
		mockGetWorkspaces: vi.fn(),
		mockGetBoard: vi.fn(),
		mockGetMetrics: vi.fn(),
		mockGetActivity: vi.fn(),
		mockGetSettings: vi.fn(),
		mockHeartbeat: vi.fn(),
		mockGetPresence: vi.fn(),
		mockFocusConfig: vi.fn(),
		MockApiError: HoistedApiError,
	};
});

vi.mock("../../api", () => ({
	api: {
		listActiveMyWorkCandidates: (...args: unknown[]) => mockListActive(...args),
		listMyWork: (...args: unknown[]) => mockListAll(...args),
		getMyWorkItem: (...args: unknown[]) => mockGetDetail(...args),
		getWorkspaces: (...args: unknown[]) => mockGetWorkspaces(...args),
		getBoard: (...args: unknown[]) => mockGetBoard(...args),
		getMetrics: (...args: unknown[]) => mockGetMetrics(...args),
		getActivity: (...args: unknown[]) => mockGetActivity(...args),
		getSettings: (...args: unknown[]) => mockGetSettings(...args),
		heartbeat: (...args: unknown[]) => mockHeartbeat(...args),
		getPresence: (...args: unknown[]) => mockGetPresence(...args),
		ticketIntake: { getConfig: vi.fn().mockResolvedValue({ enabled: false }) },
		focus: { getConfig: (...args: unknown[]) => mockFocusConfig(...args) },
	},
	ApiError: MockApiError,
}));

import { BoardProvider, useBoard } from "../../context/BoardContext";
import MyWorkPage from "../../pages/MyWorkPage";

function makeItem(
	overrides: Partial<MyWorkItem> & { id: number; key: string },
): MyWorkItem {
	const { id, key, ...rest } = overrides;
	const workspaceId = overrides.workspaceId ?? 7;
	const workspaceName = overrides.workspaceName ?? "Atlas";
	const source = overrides.source ?? "board";
	const statusCategory = overrides.statusCategory ?? "started";
	return {
		id,
		key,
		title: overrides.title ?? overrides.key,
		description: overrides.description ?? "A detail description",
		source,
		status: {
			id: overrides.id,
			kind: "status",
			name: "In progress",
			position: overrides.id,
			colour: "#4e759d",
			category: statusCategory,
			slot: "in_progress",
		},
		priority: null,
		labels: [],
		assignees: [],
		version: 1,
		createdAt: "2026-09-11T00:00:00.000Z",
		updatedAt: "2026-09-11T00:00:00.000Z",
		workspace: {
			id: workspaceId,
			name: workspaceName,
			timezone: "Asia/Jakarta",
		},
		workspaceId,
		workspaceName,
		identity: { workspaceId, source, key: overrides.key },
		statusCategory,
		canMarkDone: true,
		markDoneReason: null,
		columnId: 3,
		columnName: "In progress",
		dueDate: null,
		doneAt: null,
		startedAt: null,
		...rest,
	};
}

function response(items: MyWorkItem[]): MyWorkListResponse {
	return { items, nextCursor: null };
}

function LocationProbe() {
	const location = useLocation();
	return (
		<output data-testid="location">
			{location.pathname}
			{location.search}
		</output>
	);
}

function ActiveWorkspaceProbe() {
	const { activeWorkspaceId, switchConfirm } = useBoard();
	return (
		<>
			<output data-testid="active-workspace">{activeWorkspaceId}</output>
			<output data-testid="switch-confirm-open">
				{String(switchConfirm.open)}
			</output>
		</>
	);
}

function GuardControls() {
	const {
		setFocusSessionHydrated,
		setHasActiveFocusSession,
		setHasUnsavedCardEdits,
		confirmPendingSwitch,
		cancelPendingSwitch,
	} = useBoard();
	return (
		<div>
			<button
				type="button"
				onClick={() => {
					setFocusSessionHydrated(true);
					setHasActiveFocusSession(false);
					setHasUnsavedCardEdits(false);
				}}
			>
				Allow transition
			</button>
			<button
				type="button"
				onClick={() => {
					setFocusSessionHydrated(true);
					setHasActiveFocusSession(true);
				}}
			>
				Block focus
			</button>
			<button
				type="button"
				onClick={() => {
					setFocusSessionHydrated(true);
					setHasUnsavedCardEdits(true);
				}}
			>
				Require confirmation
			</button>
			<button type="button" onClick={confirmPendingSwitch}>
				Confirm workspace switch
			</button>
			<button type="button" onClick={cancelPendingSwitch}>
				Cancel workspace switch
			</button>
		</div>
	);
}

function SourceRouteBoundary() {
	const navigate = useNavigate();
	return (
		<>
			<Routes>
				<Route path="/my-work" element={<MyWorkPage />} />
				<Route
					path="/board/card/:cardId"
					element={<output data-testid="board-route">Board card</output>}
				/>
				<Route
					path="/tracker/:key"
					element={<output data-testid="tracker-route">Tracker item</output>}
				/>
			</Routes>
			<ActiveWorkspaceProbe />
			<GuardControls />
			<button type="button" onClick={() => navigate("/my-work")}>
				Back to My Work
			</button>
		</>
	);
}

const testUser: User = {
	id: 1,
	username: "alice",
	displayName: "Alice",
	emailVerified: true,
	needsUsername: false,
};

class TestEventSource {
	static instances: TestEventSource[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;

	constructor(_url: string) {
		TestEventSource.instances.push(this);
	}

	close() {}
}

vi.stubGlobal("EventSource", TestEventSource);

function renderWithBoard(initialEntry: string) {
	return render(
		<MemoryRouter initialEntries={[initialEntry]}>
			<BoardProvider user={testUser} onSignedOut={vi.fn()}>
				<SourceRouteBoundary />
			</BoardProvider>
			<LocationProbe />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	localStorage.clear();
	localStorage.setItem("activeWorkspaceId", "999");
	TestEventSource.instances = [];
	mockListActive.mockReset();
	mockListAll.mockReset();
	mockGetDetail.mockReset();
	mockGetWorkspaces.mockReset();
	mockGetBoard.mockReset();
	mockGetMetrics.mockReset();
	mockGetActivity.mockReset();
	mockGetSettings.mockReset();
	mockHeartbeat.mockReset();
	mockGetPresence.mockReset();
	mockFocusConfig.mockReset();
	mockGetWorkspaces.mockResolvedValue({
		workspaces: [
			{
				id: 999,
				name: "Orbit",
				role: "member",
				isPersonal: false,
				memberCount: 1,
			},
			{
				id: 7,
				name: "Atlas",
				role: "member",
				isPersonal: false,
				memberCount: 1,
			},
		],
		pendingInvites: [],
	});
	mockGetBoard.mockResolvedValue({ columns: [] });
	mockGetMetrics.mockResolvedValue(null);
	mockGetActivity.mockResolvedValue({ events: [] });
	mockGetSettings.mockResolvedValue({
		version: 0,
		boardName: "Camel",
		logoPath: "/logo.png",
	});
	mockHeartbeat.mockResolvedValue({ ok: true });
	mockGetPresence.mockResolvedValue({ users: [] });
	mockFocusConfig.mockResolvedValue({ enabled: false });
});

afterEach(() => {
	cleanup();
	localStorage.clear();
	vi.clearAllMocks();
});

describe("MyWorkDetailSheet", () => {
	it("preserves global context and URL view state while opening and closing detail", async () => {
		const item = makeItem({
			id: 17,
			key: "AT-17",
			title: "Fix Atlas sync",
			workspaceId: 7,
			workspaceName: "Atlas",
			source: "board",
		});
		mockListActive.mockResolvedValueOnce(response([item]));
		mockGetDetail.mockResolvedValueOnce(item);

		renderWithBoard(
			"/my-work?scope=active&workspaceId=7&source=board&q=atlas&page=2",
		);

		await waitFor(() => expect(screen.getByText("AT-17")).toBeTruthy());
		fireEvent.click(
			screen.getByRole("button", { name: /open AT-17 fix atlas sync/i }),
		);

		await waitFor(() =>
			expect(screen.getByRole("dialog", { name: /AT-17/i })).toBeTruthy(),
		);
		const detail = screen.getByRole("dialog", { name: /AT-17/i });
		expect(within(detail).getByText("Fix Atlas sync")).toBeTruthy();
		expect(within(detail).getByText("Atlas")).toBeTruthy();
		expect(within(detail).getByText("Board")).toBeTruthy();
		expect(mockGetDetail).toHaveBeenCalledWith(7, "board", "AT-17");
		expect(screen.getByTestId("active-workspace").textContent).toBe("999");
		expect(screen.getByTestId("location").textContent).toContain(
			"scope=active&workspaceId=7&source=board&q=atlas&page=2",
		);

		fireEvent.click(
			within(screen.getByRole("dialog", { name: /AT-17/i })).getByRole(
				"button",
				{ name: /close/i },
			),
		);

		await waitFor(() =>
			expect(screen.getByTestId("location").textContent).toBe(
				"/my-work?scope=active&workspaceId=7&source=board&q=atlas&page=2",
			),
		);
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(screen.getByTestId("active-workspace").textContent).toBe("999");
	});

	it("hides cached content and source actions after detail reauthorization fails", async () => {
		const item = makeItem({
			id: 17,
			key: "AT-17",
			title: "Revoked Atlas secret",
			workspaceId: 7,
			workspaceName: "Atlas",
			source: "board",
		});
		mockListActive.mockResolvedValueOnce(response([item]));
		mockGetDetail.mockRejectedValueOnce({ status: 404, code: "not_found" });

		renderWithBoard("/my-work");

		await waitFor(() => expect(screen.getByText("AT-17")).toBeTruthy());
		fireEvent.click(
			screen.getByRole("button", {
				name: /open AT-17 revoked atlas secret/i,
			}),
		);

		const detail = await screen.findByRole("dialog", { name: /AT-17/i });
		await waitFor(() =>
			expect(
				within(detail).getByTestId("my-work-detail-unavailable"),
			).toBeTruthy(),
		);
		expect(within(detail).queryByText("Revoked Atlas secret")).toBeNull();
		expect(
			within(detail).queryByRole("button", { name: /open in/i }),
		).toBeNull();
	});

	it("uses the real workspace guard before an allowed Board transition", async () => {
		const item = makeItem({
			id: 17,
			key: "AT-17",
			title: "Fix Atlas sync",
			workspaceId: 7,
			workspaceName: "Atlas",
			source: "board",
		});
		mockListActive.mockResolvedValueOnce(response([item]));
		mockGetDetail.mockResolvedValueOnce(item);

		renderWithBoard("/my-work?scope=active&q=atlas&page=2");
		await waitFor(() => expect(screen.getByText("AT-17")).toBeTruthy());
		fireEvent.click(
			screen.getByRole("button", { name: /open AT-17 fix atlas sync/i }),
		);
		const detail = await screen.findByRole("dialog", { name: /AT-17/i });
		await waitFor(() =>
			expect(within(detail).getByText("Fix Atlas sync")).toBeTruthy(),
		);

		fireEvent.click(screen.getByRole("button", { name: "Allow transition" }));
		fireEvent.click(
			within(detail).getByRole("button", { name: "Open in Board" }),
		);

		await waitFor(() => expect(screen.getByTestId("board-route")).toBeTruthy());
		expect(screen.getByTestId("active-workspace").textContent).toBe("7");
		expect(screen.getByTestId("location").textContent).toBe("/board/card/17");
	});

	it("targets the exact Tracker route after an allowed guarded transition", async () => {
		const item = makeItem({
			id: 4,
			key: "OR-4",
			title: "Orbit deploy",
			workspaceId: 7,
			workspaceName: "Atlas",
			source: "tracker",
		});
		mockListAll.mockResolvedValueOnce(response([item]));
		mockGetDetail.mockResolvedValueOnce(item);

		renderWithBoard("/my-work?scope=all&workspaceId=7&page=2");
		await waitFor(() => expect(screen.getByText("OR-4")).toBeTruthy());
		fireEvent.click(
			screen.getByRole("button", { name: /open OR-4 orbit deploy/i }),
		);
		const detail = await screen.findByRole("dialog", { name: /OR-4/i });
		await waitFor(() =>
			expect(within(detail).getByText("Orbit deploy")).toBeTruthy(),
		);

		fireEvent.click(screen.getByRole("button", { name: "Allow transition" }));
		fireEvent.click(
			within(detail).getByRole("button", { name: "Open in Tracker" }),
		);

		await waitFor(() =>
			expect(screen.getByTestId("tracker-route")).toBeTruthy(),
		);
		expect(screen.getByTestId("active-workspace").textContent).toBe("7");
		expect(screen.getByTestId("location").textContent).toBe("/tracker/OR-4");
	});

	it("preserves My Work when the existing focus guard blocks source navigation", async () => {
		const item = makeItem({
			id: 17,
			key: "AT-17",
			title: "Focus-protected Atlas work",
			workspaceId: 7,
			source: "board",
		});
		mockListActive.mockResolvedValueOnce(response([item]));
		mockGetDetail.mockResolvedValueOnce(item);

		renderWithBoard("/my-work?scope=active&workspaceId=7&page=2");
		await waitFor(() => expect(screen.getByText("AT-17")).toBeTruthy());
		fireEvent.click(
			screen.getByRole("button", {
				name: /open AT-17 focus-protected atlas work/i,
			}),
		);
		const detail = await screen.findByRole("dialog", { name: /AT-17/i });
		await waitFor(() =>
			expect(
				within(detail).getByText("Focus-protected Atlas work"),
			).toBeTruthy(),
		);

		fireEvent.click(screen.getByRole("button", { name: "Block focus" }));
		fireEvent.click(
			within(detail).getByRole("button", { name: "Open in Board" }),
		);

		await waitFor(() =>
			expect(screen.getByTestId("active-workspace").textContent).toBe("999"),
		);
		expect(screen.getByTestId("location").textContent).toContain("/my-work");
		expect(screen.queryByTestId("board-route")).toBeNull();
		expect(screen.getByRole("dialog", { name: /AT-17/i })).toBeTruthy();
	});

	it("preserves My Work when an unsaved-edit transition is canceled", async () => {
		const item = makeItem({
			id: 17,
			key: "AT-17",
			title: "Unsaved Atlas work",
			workspaceId: 7,
			source: "board",
		});
		mockListActive.mockResolvedValueOnce(response([item]));
		mockGetDetail.mockResolvedValueOnce(item);

		renderWithBoard("/my-work?scope=active&workspaceId=7&page=2");
		await waitFor(() => expect(screen.getByText("AT-17")).toBeTruthy());
		fireEvent.click(
			screen.getByRole("button", { name: /open AT-17 unsaved atlas work/i }),
		);
		const detail = await screen.findByRole("dialog", { name: /AT-17/i });
		await waitFor(() =>
			expect(within(detail).getByText("Unsaved Atlas work")).toBeTruthy(),
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Require confirmation" }),
		);
		fireEvent.click(
			within(detail).getByRole("button", { name: "Open in Board" }),
		);
		await waitFor(() =>
			expect(screen.getByTestId("switch-confirm-open").textContent).toBe(
				"true",
			),
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Cancel workspace switch" }),
		);
		await waitFor(() =>
			expect(screen.getByTestId("switch-confirm-open").textContent).toBe(
				"false",
			),
		);
		expect(screen.getByTestId("active-workspace").textContent).toBe("999");
		expect(screen.getByTestId("location").textContent).toContain("/my-work");
		expect(screen.queryByTestId("board-route")).toBeNull();
		expect(screen.getByRole("dialog", { name: /AT-17/i })).toBeTruthy();
	});
});
