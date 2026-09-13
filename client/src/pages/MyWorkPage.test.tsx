// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { useState } from "react";
import {
	MemoryRouter,
	Navigate,
	Route,
	Routes,
	useLocation,
	useNavigate,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AuthPage from "../components/AuthPage";
import type { MyWorkItem, MyWorkListResponse } from "../types/myWork";

const {
	mockListMyWork,
	mockListActiveMyWorkCandidates,
	mockMarkMyWorkDone,
	mockUseBoard,
	MockApiError,
} = vi.hoisted(() => {
	class TestApiError extends Error {
		status: number;
		code?: string;

		constructor(message: string, status: number, code?: string) {
			super(message);
			this.status = status;
			this.code = code;
		}
	}

	return {
		mockListMyWork: vi.fn(),
		mockListActiveMyWorkCandidates: vi.fn(),
		mockMarkMyWorkDone: vi.fn(),
		mockUseBoard: vi.fn(),
		MockApiError: TestApiError,
	};
});

vi.mock("../api", () => ({
	api: {
		listMyWork: (...args: unknown[]) => mockListMyWork(...args),
		listActiveMyWorkCandidates: (...args: unknown[]) =>
			mockListActiveMyWorkCandidates(...args),
		markMyWorkDone: (...args: unknown[]) => mockMarkMyWorkDone(...args),
	},
	ApiError: MockApiError,
}));

vi.mock("../context/BoardContext", () => ({
	useBoard: () => mockUseBoard(),
}));

import MyWorkPage from "./MyWorkPage";

function makeItem(
	overrides: Partial<MyWorkItem> & { id: number; key: string },
): MyWorkItem {
	const { id, key, ...rest } = overrides;
	const workspaceId = overrides.workspaceId ?? 7;
	const workspaceName = overrides.workspaceName ?? "Atlas";
	const source = overrides.source ?? "tracker";
	const statusCategory = overrides.statusCategory ?? "started";
	return {
		id,
		key,
		title: overrides.title ?? key,
		description: overrides.description ?? "",
		source,
		status: {
			id: overrides.id,
			kind: "status",
			name: statusCategory === "started" ? "In progress" : statusCategory,
			position: overrides.id,
			colour: "#4e759d",
			category: statusCategory,
			slot: statusCategory === "started" ? "in_progress" : null,
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

const originalLocation = window.location;
let recoveryNavigate: ((to: string) => void) | undefined;
let recoverySignOut: (() => void) | undefined;

function RecoveryNavigationBridge() {
	const navigate = useNavigate();
	recoveryNavigate = (to) => navigate(to);
	return null;
}

function RecoveryRouterBoundary() {
	const [signedIn, setSignedIn] = useState(true);
	recoverySignOut = () => setSignedIn(false);

	return (
		<>
			<RecoveryNavigationBridge />
			{signedIn ? (
				<Routes>
					<Route path="/my-work" element={<MyWorkPage />} />
					<Route path="*" element={<Navigate to="/board" replace />} />
				</Routes>
			) : (
				<Routes>
					<Route
						path="/login"
						element={<AuthPage onAuth={() => setSignedIn(true)} />}
					/>
					<Route path="*" element={<Navigate to="/" replace />} />
				</Routes>
			)}
		</>
	);
}

beforeEach(() => {
	mockUseBoard.mockReturnValue({ activeWorkspaceId: 999, logout: vi.fn() });
	mockListMyWork.mockReset();
	mockListActiveMyWorkCandidates.mockReset();
	mockMarkMyWorkDone.mockReset();
	recoveryNavigate = undefined;
	recoverySignOut = undefined;
});

afterEach(() => {
	cleanup();
	Object.defineProperty(window, "location", {
		configurable: true,
		value: originalLocation,
	});
	vi.clearAllMocks();
	vi.useRealTimers();
});

describe("MyWorkPage", () => {
	it("renders authorized personal work with grouped rows, filters, and URL state", async () => {
		const activeBoard = makeItem({
			id: 1,
			key: "AT-17",
			title: "Fix Atlas sync",
			source: "board",
			workspaceId: 7,
			workspaceName: "Atlas",
			columnName: "In progress",
			dueDate: "2026-09-10",
		});
		const activeTracker = makeItem({
			id: 2,
			key: "OR-4",
			title: "Orbit deploy",
			workspaceId: 12,
			workspaceName: "Orbit",
		});
		mockListActiveMyWorkCandidates.mockResolvedValueOnce(
			response([activeBoard, activeTracker]),
		);
		mockListMyWork.mockResolvedValue(response([activeBoard, activeTracker]));

		render(
			<MemoryRouter
				initialEntries={["/my-work?workspaceId=7&source=board&page=1"]}
			>
				<MyWorkPage />
				<LocationProbe />
			</MemoryRouter>,
		);

		await waitFor(() => expect(screen.getByText("AT-17")).toBeTruthy());
		expect(screen.getByText("Fix Atlas sync")).toBeTruthy();
		const row = screen.getByTestId("my-work-row-7-board-AT-17");
		expect(within(row).getByText("Atlas")).toBeTruthy();
		expect(within(row).getByText("Board")).toBeTruthy();
		expect(within(row).getAllByText("In progress").length).toBeGreaterThan(0);
		expect(mockListActiveMyWorkCandidates).toHaveBeenCalledWith(
			expect.objectContaining({ workspaceId: 7, source: "board" }),
		);
		expect(mockListActiveMyWorkCandidates.mock.calls[0]?.[0]).not.toEqual(
			expect.objectContaining({ workspaceId: 999 }),
		);

		fireEvent.click(screen.getByRole("tab", { name: /All/ }));
		await waitFor(() =>
			expect(mockListMyWork).toHaveBeenCalledWith(
				expect.objectContaining({
					scope: "all",
					workspaceId: 7,
					source: "board",
				}),
			),
		);
		expect(screen.getByTestId("location").textContent).toContain(
			"scope=all&workspaceId=7&source=board",
		);
	});

	it("shows the page loading surface while the personal request is pending", async () => {
		let resolveRequest: (value: MyWorkListResponse) => void = () => {};
		const pendingRequest = new Promise<MyWorkListResponse>((resolve) => {
			resolveRequest = resolve;
		});
		mockListActiveMyWorkCandidates.mockReturnValueOnce(pendingRequest);

		render(
			<MemoryRouter initialEntries={["/my-work"]}>
				<MyWorkPage />
			</MemoryRouter>,
		);

		expect(await screen.findByTestId("my-work-loading")).toBeTruthy();
		const loadingStatus = screen.getByRole("status", {
			name: "Loading your work",
		});
		expect(loadingStatus.getAttribute("aria-live")).toBe("polite");
		expect(loadingStatus.getAttribute("aria-atomic")).toBe("true");
		expect(screen.queryByTestId(/^my-work-row-/)).toBeNull();
		expect(screen.queryByText("Pending work")).toBeNull();

		resolveRequest(
			response([makeItem({ id: 9, key: "AT-9", title: "Pending work" })]),
		);
		await waitFor(() => expect(screen.getByText("Pending work")).toBeTruthy());
	});

	it("fails the whole page and retries the complete personal request", async () => {
		const item = makeItem({ id: 8, key: "OR-8", title: "Retry this work" });
		mockListActiveMyWorkCandidates
			.mockRejectedValueOnce(new Error("timeout"))
			.mockResolvedValueOnce(response([item]));

		render(
			<MemoryRouter initialEntries={["/my-work"]}>
				<MyWorkPage />
			</MemoryRouter>,
		);

		await waitFor(() =>
			expect(screen.getByTestId("my-work-error")).toBeTruthy(),
		);
		expect(screen.queryByText("Retry this work")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /try again/i }));
		await waitFor(() =>
			expect(screen.getByText("Retry this work")).toBeTruthy(),
		);
		expect(mockListActiveMyWorkCandidates).toHaveBeenCalledTimes(2);
	});

	it("shows an actionable Active empty state while historical work is available", async () => {
		const historical = makeItem({
			id: 22,
			key: "OR-22",
			title: "Completed handoff",
			statusCategory: "completed",
		});
		mockListActiveMyWorkCandidates.mockResolvedValueOnce(response([]));
		mockListMyWork.mockResolvedValueOnce(response([historical]));

		render(
			<MemoryRouter initialEntries={["/my-work"]}>
				<MyWorkPage />
			</MemoryRouter>,
		);

		await waitFor(() =>
			expect(screen.getByTestId("my-work-empty-active")).toBeTruthy(),
		);
		expect(screen.getByRole("button", { name: /view all work/i })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /view all work/i }));
		await waitFor(() =>
			expect(screen.getByText("Completed handoff")).toBeTruthy(),
		);
		expect(mockListMyWork).toHaveBeenCalledWith(
			expect.objectContaining({ scope: "all" }),
		);
	});

	it("refreshes on visibility and keeps the newest response over stale work", async () => {
		const initial = makeItem({ id: 30, key: "AT-30", title: "Initial work" });
		const older = makeItem({ id: 31, key: "AT-31", title: "Older refresh" });
		const newest = makeItem({ id: 32, key: "AT-32", title: "Newest refresh" });
		let resolveOlder: ((value: MyWorkListResponse) => void) | undefined;
		let resolveNewest: ((value: MyWorkListResponse) => void) | undefined;
		mockListActiveMyWorkCandidates
			.mockResolvedValueOnce(response([initial]))
			.mockImplementationOnce(
				() =>
					new Promise<MyWorkListResponse>((resolve) => {
						resolveOlder = resolve;
					}),
			)
			.mockImplementationOnce(
				() =>
					new Promise<MyWorkListResponse>((resolve) => {
						resolveNewest = resolve;
					}),
			);

		render(
			<MemoryRouter initialEntries={["/my-work"]}>
				<MyWorkPage />
			</MemoryRouter>,
		);
		await waitFor(() => expect(screen.getByText("Initial work")).toBeTruthy());

		Object.defineProperty(document, "hidden", {
			configurable: true,
			value: true,
		});
		document.dispatchEvent(new Event("visibilitychange"));
		Object.defineProperty(document, "hidden", {
			configurable: true,
			value: false,
		});
		document.dispatchEvent(new Event("visibilitychange"));
		await waitFor(() =>
			expect(mockListActiveMyWorkCandidates).toHaveBeenCalledTimes(2),
		);

		Object.defineProperty(document, "hidden", {
			configurable: true,
			value: true,
		});
		document.dispatchEvent(new Event("visibilitychange"));
		Object.defineProperty(document, "hidden", {
			configurable: true,
			value: false,
		});
		document.dispatchEvent(new Event("visibilitychange"));
		await waitFor(() =>
			expect(mockListActiveMyWorkCandidates).toHaveBeenCalledTimes(3),
		);

		resolveNewest?.(response([newest]));
		await waitFor(() =>
			expect(screen.getByText("Newest refresh")).toBeTruthy(),
		);
		resolveOlder?.(response([older]));
		await waitFor(() => expect(screen.queryByText("Older refresh")).toBeNull());
		expect(screen.getByText("Newest refresh")).toBeTruthy();
	});

	it("distinguishes an expired session from an empty Active result", async () => {
		mockListActiveMyWorkCandidates.mockRejectedValueOnce(
			new MockApiError("Not authenticated", 401, "session_expired"),
		);

		render(
			<MemoryRouter initialEntries={["/my-work"]}>
				<MyWorkPage />
			</MemoryRouter>,
		);

		await waitFor(() =>
			expect(screen.getByTestId("my-work-session-error")).toBeTruthy(),
		);
		expect(screen.getByText(/session has expired/i)).toBeTruthy();
		expect(screen.queryByTestId("my-work-empty-active")).toBeNull();
		expect(screen.getByRole("button", { name: /sign in again/i })).toBeTruthy();
	});

	it("clears the session and reaches the sign-in surface from the auth error route", async () => {
		const logout = vi.fn(async () => {
			recoverySignOut?.();
		});
		mockUseBoard.mockReturnValue({ activeWorkspaceId: 999, logout });
		mockListActiveMyWorkCandidates.mockRejectedValueOnce(
			new MockApiError("Not authenticated", 401, "session_expired"),
		);
		Object.defineProperty(window, "location", {
			configurable: true,
			value: {
				assign: (to: string) => recoveryNavigate?.(to),
			},
		});

		render(
			<MemoryRouter initialEntries={["/my-work"]}>
				<RecoveryRouterBoundary />
				<LocationProbe />
			</MemoryRouter>,
		);

		await waitFor(() =>
			expect(screen.getByTestId("my-work-session-error")).toBeTruthy(),
		);
		const recoveryAction = within(
			screen.getByTestId("my-work-session-error"),
		).getByText("Sign in again", { selector: "a,button" });
		fireEvent.click(recoveryAction);

		await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
		await waitFor(() =>
			expect(
				screen.getByRole("heading", { name: "Welcome back" }),
			).toBeTruthy(),
		);
		expect(screen.getByTestId("location").textContent).toBe("/login");
	});

	it("refreshes the personal request without changing URL view state", async () => {
		const first = makeItem({ id: 40, key: "AT-40", title: "Before refresh" });
		const second = makeItem({ id: 41, key: "AT-41", title: "After refresh" });
		mockListActiveMyWorkCandidates
			.mockResolvedValueOnce(response([first]))
			.mockResolvedValueOnce(response([second]));

		render(
			<MemoryRouter
				initialEntries={[
					"/my-work?scope=active&workspaceId=7&q=refresh&page=2",
				]}
			>
				<MyWorkPage />
				<LocationProbe />
			</MemoryRouter>,
		);
		await waitFor(() =>
			expect(screen.getByText("Before refresh")).toBeTruthy(),
		);
		const locationBefore = screen.getByTestId("location").textContent;

		fireEvent.click(screen.getByRole("button", { name: /refresh my work/i }));
		await waitFor(() => expect(screen.getByText("After refresh")).toBeTruthy());
		expect(mockListActiveMyWorkCandidates).toHaveBeenCalledTimes(2);
		expect(screen.getByTestId("location").textContent).toBe(locationBefore);
	});

	it.each([
		{
			label: "a version conflict",
			key: "AT-90",
			error: { status: 409, code: "version_conflict", message: "stale" },
		},
		{
			label: "a transient failure",
			key: "AT-91",
			error: { status: 503, message: "Service unavailable" },
		},
		{
			label: "a revoked assignment",
			key: "AT-92",
			error: { status: 404, code: "not_found", message: "Not found" },
		},
	])("refreshes the Active list after Mark done $label and removes stale work", async ({
		key,
		error,
	}) => {
		const item = makeItem({
			id: Number(key.slice(3)),
			key,
			title: `Stale ${key}`,
		});
		mockListActiveMyWorkCandidates
			.mockResolvedValueOnce(response([item]))
			.mockResolvedValueOnce(response([]));
		mockMarkMyWorkDone.mockRejectedValueOnce(error);

		render(
			<MemoryRouter initialEntries={["/my-work"]}>
				<MyWorkPage />
			</MemoryRouter>,
		);

		await waitFor(() => expect(screen.getByText(item.title)).toBeTruthy());
		fireEvent.click(screen.getByTestId("my-work-done-action-7-tracker-" + key));

		await waitFor(() =>
			expect(mockListActiveMyWorkCandidates).toHaveBeenCalledTimes(2),
		);
		await waitFor(() =>
			expect(screen.getByTestId("my-work-empty-active")).toBeTruthy(),
		);
		expect(screen.queryByText(item.title)).toBeNull();
		expect(screen.queryByTestId(`my-work-row-7-tracker-${key}`)).toBeNull();
		expect(
			screen.queryByTestId("my-work-done-action-7-tracker-" + key),
		).toBeNull();
	});

	it("integrates helper-defined status and due ordering across a large Active set", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-09-11T12:00:00.000Z"));
		const overdue = makeItem({
			id: 50,
			key: "AT-50",
			title: "Overdue first",
			source: "board",
			dueDate: "2026-09-10",
		});
		const dueSoon = makeItem({
			id: 51,
			key: "AT-51",
			title: "Due soon",
			source: "board",
			dueDate: "2026-09-12",
		});
		const noDue = makeItem({
			id: 52,
			key: "OR-52",
			title: "No due date",
			updatedAt: "2026-09-11T13:00:00.000Z",
		});
		const remaining = Array.from({ length: 70 }, (_, index) =>
			makeItem({ id: 100 + index, key: `CA-${100 + index}` }),
		);
		mockListActiveMyWorkCandidates.mockResolvedValueOnce(
			response([noDue, ...remaining, dueSoon, overdue]),
		);

		render(
			<MemoryRouter initialEntries={["/my-work"]}>
				<MyWorkPage />
			</MemoryRouter>,
		);
		await waitFor(() => expect(screen.getByText("Overdue first")).toBeTruthy());
		const rows = screen.getAllByTestId(/^my-work-row-/);
		expect(rows).toHaveLength(50);
		expect(rows[0]?.getAttribute("data-work-item-key")).toBe("AT-50");
		expect(rows[1]?.getAttribute("data-work-item-key")).toBe("AT-51");
	});

	it("renders Active work as 50 items then 23 without gaps or duplicates", async () => {
		const items = Array.from({ length: 73 }, (_, index) =>
			makeItem({
				id: 200 + index,
				key: `AT-${200 + index}`,
				title: `Active ${index + 1}`,
			}),
		);
		mockListActiveMyWorkCandidates.mockResolvedValueOnce(response(items));

		render(
			<MemoryRouter initialEntries={["/my-work"]}>
				<MyWorkPage />
				<LocationProbe />
			</MemoryRouter>,
		);
		await waitFor(() => expect(screen.getByText("Active 1")).toBeTruthy());
		expect(screen.getAllByTestId(/^my-work-row-/)).toHaveLength(50);
		expect(screen.queryByText("Active 51")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: /next/i }));
		await waitFor(() => expect(screen.getByText("Active 51")).toBeTruthy());
		expect(screen.getAllByTestId(/^my-work-row-/)).toHaveLength(23);
		const pageTwoKeys = screen
			.getAllByTestId(/^my-work-row-/)
			.map((row) => row.getAttribute("data-work-item-key"));
		expect(pageTwoKeys).toEqual(items.slice(50).map((item) => item.key));
		expect(screen.getByTestId("location").textContent).toContain("page=2");
	});

	it("keeps Active search local and applies workspace filters to the personal request", async () => {
		const atlas = makeItem({
			id: 60,
			key: "AT-60",
			title: "Atlas cleanup",
			workspaceId: 7,
			workspaceName: "Atlas",
		});
		const orbit = makeItem({
			id: 61,
			key: "OR-61",
			title: "Orbit deploy",
			workspaceId: 12,
			workspaceName: "Orbit",
		});
		mockListActiveMyWorkCandidates
			.mockResolvedValueOnce(response([atlas, orbit]))
			.mockResolvedValueOnce(response([orbit]))
			.mockResolvedValueOnce(response([orbit]));

		render(
			<MemoryRouter initialEntries={["/my-work"]}>
				<MyWorkPage />
				<LocationProbe />
			</MemoryRouter>,
		);
		await waitFor(() => expect(screen.getByText("Atlas cleanup")).toBeTruthy());

		fireEvent.change(screen.getByLabelText("Filter by workspace"), {
			target: { value: "12" },
		});
		await waitFor(() => expect(screen.getByText("Orbit deploy")).toBeTruthy());
		expect(mockListActiveMyWorkCandidates).toHaveBeenLastCalledWith(
			expect.objectContaining({ workspaceId: 12 }),
		);
		expect(mockListActiveMyWorkCandidates.mock.calls.at(-1)?.[0]).not.toEqual(
			expect.objectContaining({ q: expect.any(String) }),
		);

		fireEvent.change(screen.getByLabelText("Search My Work"), {
			target: { value: "orbit" },
		});
		await waitFor(() =>
			expect(screen.getByTestId("location").textContent).toContain("q=orbit"),
		);
		expect(mockListActiveMyWorkCandidates).toHaveBeenLastCalledWith(
			expect.objectContaining({ workspaceId: 12 }),
		);
		expect(
			mockListActiveMyWorkCandidates.mock.calls.at(-1)?.[0],
		).not.toHaveProperty("q");
	});

	it("keeps All search server-paginated instead of using the Active candidate drain", async () => {
		const historical = makeItem({
			id: 70,
			key: "OR-70",
			title: "Historical retry",
			statusCategory: "completed",
		});
		mockListMyWork.mockResolvedValueOnce(response([historical]));

		render(
			<MemoryRouter initialEntries={["/my-work?scope=all&q=retry"]}>
				<MyWorkPage />
			</MemoryRouter>,
		);
		await waitFor(() =>
			expect(screen.getByText("Historical retry")).toBeTruthy(),
		);
		expect(mockListActiveMyWorkCandidates).not.toHaveBeenCalled();
		expect(mockListMyWork).toHaveBeenCalledWith(
			expect.objectContaining({ scope: "all", q: "retry", limit: 50 }),
		);
	});

	it("loads All pages through server cursors while rendering 50-item pages", async () => {
		const firstPage = makeItem({
			id: 80,
			key: "AT-80",
			title: "First history page",
			statusCategory: "completed",
		});
		const secondPage = makeItem({
			id: 81,
			key: "AT-81",
			title: "Second history page",
			statusCategory: "canceled",
		});
		mockListMyWork
			.mockResolvedValueOnce({ items: [firstPage], nextCursor: "history-1" })
			.mockResolvedValueOnce({ items: [secondPage], nextCursor: null });

		render(
			<MemoryRouter initialEntries={["/my-work?scope=all"]}>
				<MyWorkPage />
			</MemoryRouter>,
		);
		await waitFor(() =>
			expect(screen.getByText("First history page")).toBeTruthy(),
		);
		fireEvent.click(screen.getByRole("button", { name: /next page/i }));
		await waitFor(() =>
			expect(screen.getByText("Second history page")).toBeTruthy(),
		);
		expect(mockListMyWork).toHaveBeenLastCalledWith(
			expect.objectContaining({ scope: "all", cursor: "history-1", limit: 50 }),
		);
	});
});

export { MockApiError };
