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
import { resetMyWorkMutationsForTests } from "../../lib/workItemMutations";
import type { User } from "../../types";
import type { MyWorkItem, MyWorkListResponse } from "../../types/myWork";

const {
	mockListActive,
	mockListAll,
	mockGetDetail,
	mockMarkMyWorkDone,
	mockGetWorkspaces,
	mockGetBoard,
	mockGetMetrics,
	mockGetActivity,
	mockGetSettings,
	mockHeartbeat,
	mockGetPresence,
	mockFocusConfig,
	mockUseNotificationsContext,
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
		mockMarkMyWorkDone: vi.fn(),
		mockGetWorkspaces: vi.fn(),
		mockGetBoard: vi.fn(),
		mockGetMetrics: vi.fn(),
		mockGetActivity: vi.fn(),
		mockGetSettings: vi.fn(),
		mockHeartbeat: vi.fn(),
		mockGetPresence: vi.fn(),
		mockFocusConfig: vi.fn(),
		mockUseNotificationsContext: vi.fn(),
		MockApiError: HoistedApiError,
	};
});

vi.mock("../../api", () => ({
	api: {
		listActiveMyWorkCandidates: (...args: unknown[]) => mockListActive(...args),
		listMyWork: (...args: unknown[]) => mockListAll(...args),
		getMyWorkItem: (...args: unknown[]) => mockGetDetail(...args),
		markMyWorkDone: (...args: unknown[]) => mockMarkMyWorkDone(...args),
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

vi.mock("../../context/NotificationsContext", () => ({
	useNotificationsContext: (...args: unknown[]) =>
		mockUseNotificationsContext(...args),
}));

import { BoardProvider, useBoard } from "../../context/BoardContext";
import { MobileNav } from "../../layout/sidebar/MobileNav";
import Sidebar from "../../layout/sidebar/Sidebar";
import { WorkspaceOverlays } from "../../layout/sidebar/WorkspaceModals";
import { WorkspaceSwitcher } from "../../layout/sidebar/WorkspaceSwitcher";
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
			<WorkspaceSwitcher />
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

function MobileClosedSourceRouteBoundary() {
	return (
		<>
			<WorkspaceOverlays />
			<MobileNav
				open={false}
				onClose={vi.fn()}
				mode="kanban"
				onModeChange={vi.fn()}
			/>
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
		</>
	);
}

function ShellSourceRouteBoundary({ mobileOpen }: { mobileOpen: boolean }) {
	return (
		<>
			<WorkspaceOverlays />
			<div data-testid="desktop-sidebar">
				<Sidebar
					collapsed={false}
					onToggle={vi.fn()}
					mode="kanban"
					onModeChange={vi.fn()}
				/>
			</div>
			<div data-testid="mobile-nav">
				<MobileNav
					open={mobileOpen}
					onClose={vi.fn()}
					mode="kanban"
					onModeChange={vi.fn()}
				/>
			</div>
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
		</>
	);
}

function renderMobileClosedWithBoard(initialEntry: string) {
	return render(
		<MemoryRouter initialEntries={[initialEntry]}>
			<BoardProvider user={testUser} onSignedOut={vi.fn()}>
				<MobileClosedSourceRouteBoundary />
			</BoardProvider>
			<LocationProbe />
		</MemoryRouter>,
	);
}

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

function renderShellWithBoard(initialEntry: string, mobileOpen: boolean) {
	return render(
		<MemoryRouter initialEntries={[initialEntry]}>
			<BoardProvider user={testUser} onSignedOut={vi.fn()}>
				<ShellSourceRouteBoundary mobileOpen={mobileOpen} />
			</BoardProvider>
			<LocationProbe />
		</MemoryRouter>,
	);
}

async function openDetailWhilePending(item: MyWorkItem) {
	let settle: (value: MyWorkItem | PromiseLike<MyWorkItem>) => void = () => {};
	let fail: (reason?: unknown) => void = () => {};
	const pending = new Promise<MyWorkItem>((resolve, reject) => {
		settle = resolve;
		fail = reject;
	});
	mockListActive.mockResolvedValueOnce(response([item]));
	mockGetDetail.mockReturnValueOnce(pending);
	renderWithBoard("/my-work");
	await waitFor(() => expect(screen.getByText(item.key)).toBeTruthy());
	fireEvent.click(
		screen.getByRole("button", {
			name: new RegExp(`open ${item.key}`, "i"),
		}),
	);
	const detail = await screen.findByRole("dialog", {
		name: new RegExp(item.key, "i"),
	});
	return { detail, settle, fail };
}

async function openShellDetail({
	item,
	mobileOpen,
}: {
	item: MyWorkItem;
	mobileOpen: boolean;
}) {
	mockListActive.mockResolvedValueOnce(response([item]));
	mockGetDetail.mockResolvedValueOnce(item);
	renderShellWithBoard(
		"/my-work?scope=active&workspaceId=7&page=2",
		mobileOpen,
	);
	await waitFor(() =>
		expect(screen.getByTestId("active-workspace").textContent).toBe("999"),
	);
	await waitFor(() => expect(screen.getByText(item.key)).toBeTruthy());
	fireEvent.click(
		screen.getByRole("button", {
			name: new RegExp(`open ${item.key}`, "i"),
		}),
	);
	const detail = await screen.findByRole("dialog", {
		name: new RegExp(item.key, "i"),
	});
	await waitFor(() =>
		expect(within(detail).getByText(item.title)).toBeTruthy(),
	);
	fireEvent.click(screen.getByRole("button", { name: "Require confirmation" }));
	return detail;
}

beforeEach(() => {
	localStorage.clear();
	localStorage.setItem("activeWorkspaceId", "999");
	TestEventSource.instances = [];
	mockListActive.mockReset();
	mockListAll.mockReset();
	mockGetDetail.mockReset();
	mockMarkMyWorkDone.mockReset();
	mockGetWorkspaces.mockReset();
	mockGetBoard.mockReset();
	mockGetMetrics.mockReset();
	mockGetActivity.mockReset();
	mockGetSettings.mockReset();
	mockHeartbeat.mockReset();
	mockGetPresence.mockReset();
	mockFocusConfig.mockReset();
	mockUseNotificationsContext.mockReset();
	mockUseNotificationsContext.mockReturnValue({ unreadCount: 0 });
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
	resetMyWorkMutationsForTests();
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

	it("traps focus inside detail and restores the invoking row trigger on close", async () => {
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

		renderWithBoard("/my-work?scope=active&workspaceId=7&page=2");
		const trigger = await screen.findByRole("button", {
			name: /open AT-17 fix atlas sync/i,
		});
		trigger.focus();
		fireEvent.click(trigger);

		const detail = await screen.findByRole("dialog", { name: /AT-17/i });
		const closeButton = within(detail).getByRole("button", {
			name: /close/i,
		});
		const sourceButton = await within(detail).findByRole("button", {
			name: "Open in Board",
		});
		await waitFor(() => expect(document.activeElement).toBe(closeButton));

		sourceButton.focus();
		fireEvent.keyDown(sourceButton, { key: "Tab" });
		expect(document.activeElement).toBe(closeButton);
		closeButton.focus();
		fireEvent.keyDown(closeButton, { key: "Tab", shiftKey: true });
		expect(document.activeElement).toBe(sourceButton);
		expect(document.activeElement).not.toBe(trigger);
		expect(document.activeElement).not.toBe(
			screen.getByRole("button", { name: "Allow transition" }),
		);

		fireEvent.click(closeButton);
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(document.activeElement).toBe(trigger);
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

	it("shows the pending loading surface then the ready detail", async () => {
		const item = makeItem({
			id: 17,
			key: "AT-17",
			title: "Atlas loading title",
			workspaceId: 7,
			workspaceName: "Atlas",
			source: "board",
		});
		const { detail, settle } = await openDetailWhilePending(item);

		const loading = within(detail).getByTestId("my-work-detail-loading");
		expect(loading.getAttribute("aria-live")).toBe("polite");
		expect(within(detail).getByText("Loading AT-17…")).toBeTruthy();
		expect(within(detail).queryByText("Atlas loading title")).toBeNull();

		settle(item);
		await waitFor(() =>
			expect(within(detail).getByText("Atlas loading title")).toBeTruthy(),
		);
		expect(within(detail).queryByTestId("my-work-detail-loading")).toBeNull();
	});

	it("shows the pending loading surface then unavailable after reauthorization fails", async () => {
		const item = makeItem({
			id: 17,
			key: "AT-17",
			title: "Atlas loading title",
			workspaceId: 7,
			workspaceName: "Atlas",
			source: "board",
		});
		const { detail, fail } = await openDetailWhilePending(item);

		expect(within(detail).getByTestId("my-work-detail-loading")).toBeTruthy();
		expect(within(detail).queryByText("Atlas loading title")).toBeNull();

		fail({ status: 404, code: "not_found" });
		await waitFor(() =>
			expect(
				within(detail).getByTestId("my-work-detail-unavailable"),
			).toBeTruthy(),
		);
		expect(within(detail).queryByText("Atlas loading title")).toBeNull();
		expect(within(detail).queryByTestId("my-work-detail-loading")).toBeNull();
	});

	it("animates the mobile sheet vertically and the desktop dock from the right", async () => {
		const item = makeItem({
			id: 17,
			key: "AT-17",
			title: "Atlas loading title",
			workspaceId: 7,
			workspaceName: "Atlas",
			source: "board",
		});
		mockListActive.mockResolvedValueOnce(response([item]));
		mockGetDetail.mockResolvedValueOnce(item);
		renderWithBoard("/my-work");
		await waitFor(() => expect(screen.getByText("AT-17")).toBeTruthy());
		fireEvent.click(
			screen.getByRole("button", {
				name: /open AT-17 atlas loading title/i,
			}),
		);
		const detail = await screen.findByRole("dialog", { name: /AT-17/i });
		expect(detail.className).toContain("animate-sheet-in");
		expect(detail.className).toContain("md:animate-panel-in");
		expect(detail.className).toContain("motion-reduce:animate-none");
		expect(detail.className).toContain("md:motion-reduce:animate-none");
	});

	it.each([
		{
			label: "a version conflict",
			error: { status: 409, code: "version_conflict", message: "stale" },
			keepsDetail: true,
		},
		{
			label: "a transient failure",
			error: { status: 503, message: "Service unavailable" },
			keepsDetail: true,
		},
		{
			label: "a revoked assignment",
			error: { status: 404, code: "not_found", message: "Not found" },
			keepsDetail: false,
		},
	])("refreshes the page rollup after detail Mark done $label", async ({
		error,
		keepsDetail,
	}) => {
		const item = makeItem({
			id: 17,
			key: "AT-17",
			title: "Detail recovery work",
			workspaceId: 7,
			workspaceName: "Atlas",
			source: "board",
		});
		mockListActive
			.mockResolvedValueOnce(response([item]))
			.mockResolvedValueOnce(response([]));
		mockGetDetail.mockResolvedValue(item);
		mockMarkMyWorkDone.mockRejectedValueOnce(error);

		renderWithBoard("/my-work?scope=active&workspaceId=7");
		await waitFor(() => expect(screen.getByText(item.title)).toBeTruthy());
		fireEvent.click(
			screen.getByRole("button", {
				name: /open AT-17 detail recovery work/i,
			}),
		);
		const detail = await screen.findByRole("dialog", { name: /AT-17/i });
		await waitFor(() =>
			expect(within(detail).getByText(item.title)).toBeTruthy(),
		);

		fireEvent.click(within(detail).getByRole("button", { name: "Mark done" }));

		await waitFor(() =>
			expect(mockMarkMyWorkDone).toHaveBeenCalledWith(7, "board", "AT-17", 1),
		);
		await waitFor(() => expect(mockListActive).toHaveBeenCalledTimes(2));
		if (keepsDetail) {
			expect(screen.getByRole("dialog", { name: /AT-17/i })).toBeTruthy();
			expect(
				within(screen.getByRole("dialog", { name: /AT-17/i })).getByText(
					item.title,
				),
			).toBeTruthy();
			expect(mockGetDetail).toHaveBeenCalledTimes(2);
			expect(screen.getByRole("alert").textContent).toMatch(
				/version|service unavailable|updated this item/i,
			);
		} else {
			await waitFor(() =>
				expect(screen.queryByRole("dialog", { name: /AT-17/i })).toBeNull(),
			);
			expect(screen.queryByText(item.title)).toBeNull();
			expect(screen.queryByTestId("my-work-row-7-board-AT-17")).toBeNull();
			expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();
			expect(screen.queryByText(/marked done/i)).toBeNull();
		}
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

	it("gives the workspace confirmation popover focus ownership", async () => {
		const item = makeItem({
			id: 17,
			key: "AT-17",
			title: "Unsaved Atlas work",
			workspaceId: 7,
			workspaceName: "Atlas",
			source: "board",
		});
		mockListActive.mockResolvedValueOnce(response([item]));
		mockGetDetail.mockResolvedValueOnce(item);

		renderWithBoard("/my-work?scope=active&workspaceId=7&page=2");
		const trigger = await screen.findByRole("button", {
			name: /open AT-17 unsaved atlas work/i,
		});
		trigger.focus();
		fireEvent.click(trigger);
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

		const confirmation = await screen.findByRole("dialog", {
			name: "Confirm workspace switch",
		});
		const cancel = within(confirmation).getByRole("button", {
			name: "Cancel",
		});
		const switchButton = within(confirmation).getByRole("button", {
			name: "Switch",
		});
		await waitFor(() => expect(document.activeElement).toBe(cancel));

		switchButton.focus();
		fireEvent.keyDown(switchButton, { key: "Tab" });
		expect(document.activeElement).toBe(cancel);
		cancel.focus();
		fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
		expect(document.activeElement).toBe(switchButton);

		fireEvent.keyDown(cancel, { key: "Escape" });
		await waitFor(() =>
			expect(
				screen.queryByRole("dialog", { name: "Confirm workspace switch" }),
			).toBeNull(),
		);
		expect(screen.getByRole("dialog", { name: /AT-17/i })).toBeTruthy();
		expect(screen.getByTestId("active-workspace").textContent).toBe("999");
		expect(screen.getByTestId("location").textContent).toBe(
			"/my-work?scope=active&workspaceId=7&page=2&detailWorkspaceId=7&detailSource=board&detailKey=AT-17",
		);
		expect(screen.queryByTestId("board-route")).toBeNull();

		fireEvent.click(
			within(screen.getByRole("dialog", { name: /AT-17/i })).getByRole(
				"button",
				{ name: /close/i },
			),
		);
		await waitFor(() =>
			expect(screen.queryByRole("dialog", { name: /AT-17/i })).toBeNull(),
		);
		expect(document.activeElement).toBe(trigger);
	});

	it("shows mobile-closed confirmation and completes guarded source navigation", async () => {
		const item = makeItem({
			id: 17,
			key: "AT-17",
			title: "Unsaved Atlas work",
			workspaceId: 7,
			workspaceName: "Atlas",
			source: "board",
		});
		mockListActive.mockResolvedValueOnce(response([item]));
		mockGetDetail.mockResolvedValueOnce(item);

		renderMobileClosedWithBoard("/my-work?scope=active&workspaceId=7&page=2");
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

		const confirmation = await screen.findByRole("dialog", {
			name: "Confirm workspace switch",
		});
		expect(screen.queryByRole("button", { name: "Close menu" })).toBeNull();
		const cancel = within(confirmation).getByRole("button", {
			name: "Cancel",
		});
		await waitFor(() => expect(document.activeElement).toBe(cancel));
		fireEvent.click(cancel);
		await waitFor(() =>
			expect(screen.getByTestId("switch-confirm-open").textContent).toBe(
				"false",
			),
		);
		expect(screen.getByTestId("active-workspace").textContent).toBe("999");
		expect(screen.getByTestId("location").textContent).toBe(
			"/my-work?scope=active&workspaceId=7&page=2&detailWorkspaceId=7&detailSource=board&detailKey=AT-17",
		);
		expect(screen.queryByTestId("board-route")).toBeNull();
		expect(screen.getByRole("dialog", { name: /AT-17/i })).toBeTruthy();

		const sourceButton = within(detail).getByRole("button", {
			name: "Open in Board",
		});
		await waitFor(() =>
			expect((sourceButton as HTMLButtonElement).disabled).toBe(false),
		);
		fireEvent.click(sourceButton);
		const secondConfirmation = await screen.findByRole("dialog", {
			name: "Confirm workspace switch",
		});
		fireEvent.click(
			within(secondConfirmation).getByRole("button", { name: "Switch" }),
		);

		await waitFor(() => expect(screen.getByTestId("board-route")).toBeTruthy());
		expect(screen.getByTestId("active-workspace").textContent).toBe("7");
		expect(screen.getByTestId("location").textContent).toBe("/board/card/17");
	});

	it("keeps the desktop list selection from canceling external confirmation", async () => {
		const item = makeItem({
			id: 17,
			key: "AT-17",
			title: "Unsaved Atlas work",
			workspaceId: 7,
			workspaceName: "Atlas",
			source: "board",
		});
		const detail = await openShellDetail({ item, mobileOpen: false });
		const desktop = screen.getByTestId("desktop-sidebar");
		fireEvent.click(within(desktop).getByRole("button", { name: /Orbit/i }));
		fireEvent.click(within(desktop).getByRole("option", { name: /Atlas/i }));

		const confirmation = await screen.findByRole("dialog", {
			name: "Confirm workspace switch",
		});
		const cancel = within(confirmation).getByRole("button", {
			name: "Cancel",
		});
		fireEvent.mouseDown(cancel);
		expect(
			screen.getByRole("dialog", { name: "Confirm workspace switch" }),
		).toBeTruthy();
		fireEvent.click(cancel);

		await waitFor(() =>
			expect(
				screen.queryByRole("dialog", { name: "Confirm workspace switch" }),
			).toBeNull(),
		);
		expect(screen.getByTestId("switch-confirm-open").textContent).toBe("false");
		expect(screen.getByTestId("active-workspace").textContent).toBe("999");
		expect(screen.getByTestId("location").textContent).toBe(
			"/my-work?scope=active&workspaceId=7&page=2&detailWorkspaceId=7&detailSource=board&detailKey=AT-17",
		);
		expect(screen.getByRole("dialog", { name: /AT-17/i })).toBe(detail);
	});

	it("keeps the mobile list selection switch actionable", async () => {
		const item = makeItem({
			id: 17,
			key: "AT-17",
			title: "Unsaved Atlas work",
			workspaceId: 7,
			workspaceName: "Atlas",
			source: "board",
		});
		const detail = await openShellDetail({ item, mobileOpen: true });
		const mobile = screen.getByTestId("mobile-nav");
		fireEvent.click(within(mobile).getByRole("button", { name: /Orbit/i }));
		fireEvent.click(within(mobile).getByRole("option", { name: /Atlas/i }));

		const confirmation = await screen.findByRole("dialog", {
			name: "Confirm workspace switch",
		});
		const switchButton = within(confirmation).getByRole("button", {
			name: "Switch",
		});
		fireEvent.mouseDown(switchButton);
		expect(
			screen.getByRole("dialog", { name: "Confirm workspace switch" }),
		).toBeTruthy();
		fireEvent.click(switchButton);

		await waitFor(() =>
			expect(screen.getByTestId("active-workspace").textContent).toBe("7"),
		);
		expect(screen.getByTestId("switch-confirm-open").textContent).toBe("false");
		expect(screen.getByTestId("location").textContent).toBe(
			"/my-work?scope=active&workspaceId=7&page=2&detailWorkspaceId=7&detailSource=board&detailKey=AT-17",
		);
		expect(screen.getByRole("dialog", { name: /AT-17/i })).toBe(detail);
	});

	it.each([
		{
			label: "desktop Board",
			mobileOpen: false,
			source: "board" as const,
			id: 17,
			key: "AT-17",
			title: "Desktop Atlas work",
			expectedRoute: "/board/card/17",
			routeTestId: "board-route",
		},
		{
			label: "mobile Tracker",
			mobileOpen: true,
			source: "tracker" as const,
			id: 4,
			key: "OR-4",
			title: "Mobile Atlas work",
			expectedRoute: "/tracker/OR-4",
			routeTestId: "tracker-route",
		},
	])("keeps an external source confirmation actionable with the $label list open", async ({
		mobileOpen,
		source,
		id,
		key,
		title,
		expectedRoute,
		routeTestId,
	}) => {
		const item = makeItem({
			id,
			key,
			title,
			workspaceId: 7,
			workspaceName: "Atlas",
			source,
		});
		const detail = await openShellDetail({ item, mobileOpen });
		const shell = screen.getByTestId(
			mobileOpen ? "mobile-nav" : "desktop-sidebar",
		);
		fireEvent.click(within(shell).getByRole("button", { name: /Orbit/i }));
		const sourceButton = within(detail).getByRole("button", {
			name: `Open in ${source === "board" ? "Board" : "Tracker"}`,
		});
		fireEvent.click(sourceButton);

		const confirmation = await screen.findByRole("dialog", {
			name: "Confirm workspace switch",
		});
		const switchButton = within(confirmation).getByRole("button", {
			name: "Switch",
		});
		fireEvent.mouseDown(switchButton);
		expect(
			screen.getByRole("dialog", { name: "Confirm workspace switch" }),
		).toBeTruthy();
		fireEvent.click(switchButton);

		await waitFor(() => expect(screen.getByTestId(routeTestId)).toBeTruthy());
		expect(screen.getByTestId("active-workspace").textContent).toBe("7");
		expect(screen.getByTestId("location").textContent).toBe(expectedRoute);
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
