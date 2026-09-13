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
import {
	configureRequestBoundaryForTests,
	resetRequestBoundaryForTests,
} from "../api";
import { BoardProvider, useBoard } from "../context/BoardContext";
import { WorkspaceOverlays } from "../layout/sidebar/WorkspaceModals";
import { sourceItem } from "../lib/myWorkTestSupport";
import { resetMyWorkMutationsForTests } from "../lib/workItemMutations";
import type { User, Workspace } from "../types";
import type { MyWorkItem, MyWorkListResponse } from "../types/myWork";
import MyWorkPage from "./MyWorkPage";

type FetchHandler = (
	url: URL,
	init: RequestInit | undefined,
) => Response | Promise<Response>;

const testUser: User = {
	id: 1,
	username: "alice",
	displayName: "Alice",
	emailVerified: true,
	needsUsername: false,
};

const workspaces: Workspace[] = [
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
];

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function requestUrl(input: RequestInfo | URL): URL {
	if (typeof input === "string") return new URL(input, "http://camel.test");
	if (input instanceof URL) return input;
	return new URL(input.url, "http://camel.test");
}

function defaultShellResponse(url: URL): Response {
	if (url.pathname === "/api/workspaces") {
		return jsonResponse({ workspaces, pendingInvites: [] });
	}
	if (url.pathname === "/api/focus/config") {
		return jsonResponse({ enabled: false });
	}
	if (url.pathname === "/api/ticket-intake/config") {
		return jsonResponse({ enabled: false });
	}
	if (url.pathname.endsWith("/board")) {
		return jsonResponse({ columns: [] });
	}
	if (url.pathname.endsWith("/metrics")) {
		return jsonResponse(null);
	}
	if (url.pathname.includes("/activity")) {
		return jsonResponse({ events: [] });
	}
	if (url.pathname.endsWith("/settings")) {
		return jsonResponse({
			boardName: "Camel",
			logoPath: "/logo.png",
			version: 0,
		});
	}
	if (url.pathname.endsWith("/presence")) {
		return jsonResponse({ users: [] });
	}
	if (url.pathname.endsWith("/presence/heartbeat")) {
		return jsonResponse({ ok: true });
	}
	return jsonResponse({});
}

function createNetwork(myWorkHandler?: FetchHandler) {
	const handler =
		myWorkHandler ?? (() => jsonResponse({ items: [], nextCursor: null }));
	const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
		const url = requestUrl(input);
		if (
			url.pathname === "/api/my-work" ||
			url.pathname.startsWith("/api/my-work/")
		) {
			return handler(url, init);
		}
		return defaultShellResponse(url);
	});
	configureRequestBoundaryForTests({ fetchImpl });
	return fetchImpl;
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
	const { activeWorkspaceId, toast } = useBoard();
	return (
		<>
			<output data-testid="active-workspace">{activeWorkspaceId}</output>
			<output data-testid="guard-toast">{toast?.message ?? ""}</output>
		</>
	);
}

function GuardControls() {
	const {
		setFocusSessionHydrated,
		setHasActiveFocusSession,
		setHasUnsavedCardEdits,
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
		</div>
	);
}

function RouteBoundary() {
	const navigate = useNavigate();
	return (
		<>
			<WorkspaceOverlays />
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

function renderSurface(initialEntry: string) {
	return render(
		<MemoryRouter initialEntries={[initialEntry]}>
			<BoardProvider user={testUser} onSignedOut={vi.fn()}>
				<RouteBoundary />
			</BoardProvider>
			<LocationProbe />
		</MemoryRouter>,
	);
}

function makeItem(
	overrides: Partial<MyWorkItem> & { id: number; key: string },
): MyWorkItem {
	const workspaceId = overrides.workspaceId ?? 7;
	const workspaceName = overrides.workspaceName ?? "Atlas";
	const source = overrides.source ?? "board";
	return sourceItem(overrides.id, source, overrides.key, {
		workspaceId,
		workspace: {
			id: workspaceId,
			name: workspaceName,
			timezone: "Asia/Jakarta",
		},
		title: overrides.title ?? overrides.key,
		description: overrides.description ?? "A detail description",
		columnName: "In progress",
		canMarkDone: true,
		markDoneReason: null,
		...overrides,
	});
}

function response(
	items: MyWorkItem[],
	nextCursor: string | null = null,
): MyWorkListResponse {
	return { items, nextCursor };
}

function setViewportWidth(width: number) {
	Object.defineProperty(window, "innerWidth", {
		configurable: true,
		value: width,
	});
	window.dispatchEvent(new Event("resize"));
}

beforeEach(() => {
	localStorage.clear();
	localStorage.setItem("activeWorkspaceId", "999");
});

afterEach(() => {
	cleanup();
	resetRequestBoundaryForTests();
	resetMyWorkMutationsForTests();
	localStorage.clear();
	setViewportWidth(1024);
	vi.clearAllMocks();
});

class TestEventSource {
	onopen: (() => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;

	constructor(_url: string) {}

	close() {}
}

vi.stubGlobal("EventSource", TestEventSource);

async function openDetailFor(item: MyWorkItem) {
	fireEvent.click(
		screen.getByRole("button", { name: new RegExp(`open ${item.key}`, "i") }),
	);
	const detail = await screen.findByRole("dialog", {
		name: new RegExp(item.key, "i"),
	});
	await waitFor(() =>
		expect(within(detail).getByText(item.title)).toBeTruthy(),
	);
	return detail;
}

describe("MyWorkPage cross-component integration", () => {
	// Cycle 1 — route/detail/back state.
	it("preserves URL view state and active workspace across filters, detail, and back", async () => {
		const items = Array.from({ length: 51 }, (_, index) =>
			makeItem({
				id: 100 + index,
				key: `AT-${100 + index}`,
				title: `Atlas work ${index + 1}`,
				source: "board",
				workspaceId: 7,
			}),
		);
		const item = items[50]!;
		createNetwork((url) => {
			if (url.pathname === "/api/my-work") return jsonResponse(response(items));
			return jsonResponse(item);
		});

		renderSurface("/my-work");
		await waitFor(() => expect(screen.getByText(items[0]!.key)).toBeTruthy());
		await waitFor(() =>
			expect(screen.getByTestId("active-workspace").textContent).toBe("999"),
		);

		fireEvent.change(screen.getByLabelText("Filter by workspace"), {
			target: { value: "7" },
		});
		await waitFor(() =>
			expect(screen.getByTestId("location").textContent).toContain(
				"workspaceId=7",
			),
		);
		fireEvent.change(screen.getByLabelText("Filter by source"), {
			target: { value: "board" },
		});
		await waitFor(() =>
			expect(screen.getByTestId("location").textContent).toContain(
				"source=board",
			),
		);
		fireEvent.click(screen.getByRole("button", { name: /next page/i }));
		await waitFor(() => expect(screen.getByText(item.key)).toBeTruthy());

		const detail = await openDetailFor(item);
		await waitFor(() =>
			expect(within(detail).getByText(item.title)).toBeTruthy(),
		);
		expect(screen.getByTestId("location").textContent).toBe(
			`/my-work?workspaceId=7&source=board&page=2&detailWorkspaceId=7&detailSource=board&detailKey=${item.key}`,
		);
		expect(screen.getByTestId("active-workspace").textContent).toBe("999");

		fireEvent.click(
			within(detail).getByRole("button", { name: "Close details" }),
		);
		await waitFor(() =>
			expect(screen.getByTestId("location").textContent).toBe(
				`/my-work?workspaceId=7&source=board&page=2`,
			),
		);
		expect(
			screen.queryByRole("dialog", { name: new RegExp(item.key) }),
		).toBeNull();
		expect(screen.getByTestId("active-workspace").textContent).toBe("999");
	});

	// Cycle 2 — guarded source navigation.
	it("navigates to the allowed Board source after the real workspace guard", async () => {
		const item = makeItem({
			id: 17,
			key: "AT-17",
			title: "Allowed Atlas work",
			source: "board",
			workspaceId: 7,
		});
		createNetwork((url) => {
			if (url.pathname === "/api/my-work")
				return jsonResponse(response([item]));
			return jsonResponse(item);
		});

		renderSurface("/my-work?scope=active&workspaceId=7&page=2");
		await waitFor(() => expect(screen.getByText(item.key)).toBeTruthy());
		const detail = await openDetailFor(item);

		fireEvent.click(screen.getByRole("button", { name: "Allow transition" }));
		fireEvent.click(
			within(detail).getByRole("button", { name: "Open in Board" }),
		);

		await waitFor(() => expect(screen.getByTestId("board-route")).toBeTruthy());
		expect(screen.getByTestId("active-workspace").textContent).toBe("7");
		expect(screen.getByTestId("location").textContent).toBe("/board/card/17");
	});

	it("keeps the detail route when the real focus guard blocks Board navigation", async () => {
		const item = makeItem({
			id: 18,
			key: "AT-18",
			title: "Focus-protected Atlas work",
			source: "board",
			workspaceId: 7,
		});
		createNetwork((url) => {
			if (url.pathname === "/api/my-work")
				return jsonResponse(response([item]));
			return jsonResponse(item);
		});

		renderSurface("/my-work?scope=active&workspaceId=7&page=2");
		await waitFor(() => expect(screen.getByText(item.key)).toBeTruthy());
		const detail = await openDetailFor(item);

		fireEvent.click(screen.getByRole("button", { name: "Block focus" }));
		fireEvent.click(
			within(detail).getByRole("button", { name: "Open in Board" }),
		);

		await waitFor(() =>
			expect(screen.getByTestId("guard-toast").textContent).toMatch(
				/finish your focus session/i,
			),
		);
		expect(screen.getByTestId("active-workspace").textContent).toBe("999");
		expect(screen.getByTestId("location").textContent).toContain("/my-work");
		expect(screen.queryByTestId("board-route")).toBeNull();
		expect(screen.getByRole("dialog", { name: /AT-18/i })).toBeTruthy();
	});

	it("keeps My Work when the real unsaved-edit confirmation is canceled", async () => {
		const item = makeItem({
			id: 19,
			key: "AT-19",
			title: "Unsaved Atlas work",
			source: "board",
			workspaceId: 7,
		});
		createNetwork((url) => {
			if (url.pathname === "/api/my-work")
				return jsonResponse(response([item]));
			return jsonResponse(item);
		});

		renderSurface("/my-work?scope=active&workspaceId=7&page=2");
		await waitFor(() => expect(screen.getByText(item.key)).toBeTruthy());
		const detail = await openDetailFor(item);

		fireEvent.click(
			screen.getByRole("button", { name: "Require confirmation" }),
		);
		fireEvent.click(
			within(detail).getByRole("button", { name: "Open in Board" }),
		);
		const confirmation = await screen.findByRole("dialog", {
			name: "Confirm workspace switch",
		});
		fireEvent.click(
			within(confirmation).getByRole("button", { name: "Cancel" }),
		);

		await waitFor(() =>
			expect(
				screen.queryByRole("dialog", { name: "Confirm workspace switch" }),
			).toBeNull(),
		);
		expect(screen.getByTestId("active-workspace").textContent).toBe("999");
		expect(screen.getByTestId("location").textContent).toContain("/my-work");
		expect(screen.queryByTestId("board-route")).toBeNull();
		expect(screen.getByRole("dialog", { name: /AT-19/i })).toBeTruthy();
	});

	// Cycle 3 — mobile detail bottom sheet.
	it("renders and closes the real detail bottom sheet at a mobile viewport", async () => {
		setViewportWidth(390);
		const item = makeItem({
			id: 20,
			key: "OR-20",
			title: "Mobile Orbit work",
			source: "tracker",
			workspaceId: 7,
		});
		createNetwork((url) => {
			if (url.pathname === "/api/my-work")
				return jsonResponse(response([item]));
			return jsonResponse(item);
		});

		renderSurface("/my-work?scope=active");
		await waitFor(() => expect(screen.getByText(item.key)).toBeTruthy());
		expect(window.innerWidth).toBe(390);
		const detail = await openDetailFor(item);
		const backdrop = detail.parentElement;
		expect(backdrop?.className).toContain("fixed");
		expect(backdrop?.className).toContain("items-end");
		expect(detail.className).toContain("w-full");
		expect(detail.className).toContain("rounded-t-lg");

		fireEvent.click(
			within(detail).getByRole("button", { name: "Close details" }),
		);
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(screen.getByTestId("location").textContent).toBe(
			"/my-work?scope=active",
		);
	});

	// Cycle 4 — transient whole-page error/retry.
	it("shows a whole-page error and retries the complete request", async () => {
		const item = makeItem({
			id: 21,
			key: "AT-21",
			title: "Recovered Atlas work",
			source: "board",
			workspaceId: 7,
		});
		let listCalls = 0;
		createNetwork((url) => {
			if (url.pathname === "/api/my-work") {
				listCalls += 1;
				return listCalls === 1
					? jsonResponse({ error: "Request timed out" }, 503)
					: jsonResponse(response([item]));
			}
			return jsonResponse(item);
		});

		renderSurface("/my-work");
		await waitFor(() =>
			expect(screen.getByTestId("my-work-error")).toBeTruthy(),
		);
		expect(screen.getByRole("alert").textContent).toMatch(/timed out/i);
		expect(screen.queryByText(item.title)).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: /try again/i }));
		await waitFor(() => expect(screen.getByText(item.title)).toBeTruthy());
		expect(listCalls).toBe(2);
	});

	// Cycle 5 — Active empty state.
	it("offers All navigation from an empty Active scope with history available", async () => {
		const historical = makeItem({
			id: 22,
			key: "OR-22",
			title: "Completed Orbit handoff",
			source: "tracker",
			workspaceId: 7,
			statusCategory: "completed",
		});
		let activeCalls = 0;
		let allCalls = 0;
		createNetwork((url) => {
			if (url.pathname === "/api/my-work") {
				if (url.searchParams.get("scope") === "all") {
					allCalls += 1;
					return jsonResponse(response([historical]));
				}
				activeCalls += 1;
				return jsonResponse(response([]));
			}
			return jsonResponse(historical);
		});

		renderSurface("/my-work");
		await waitFor(() =>
			expect(screen.getByTestId("my-work-empty-active")).toBeTruthy(),
		);
		fireEvent.click(screen.getByRole("button", { name: /view all work/i }));
		await waitFor(() =>
			expect(screen.getByText(historical.title)).toBeTruthy(),
		);
		expect(screen.getByTestId("location").textContent).toBe(
			"/my-work?scope=all",
		);
		expect(activeCalls).toBe(1);
		expect(allCalls).toBe(1);
	});

	// Cycle 6A — server-backed All query/cursor.
	it("uses server cursors for All pages and starts a bounded query request", async () => {
		const firstPage = makeItem({
			id: 23,
			key: "AT-23",
			title: "First history page",
			statusCategory: "completed",
		});
		const secondPage = makeItem({
			id: 24,
			key: "AT-24",
			title: "Second history page",
			statusCategory: "completed",
		});
		const queryPage = makeItem({
			id: 25,
			key: "AT-25",
			title: "Search result page",
			statusCategory: "completed",
		});
		const allRequests: URL[] = [];
		createNetwork((url) => {
			if (url.pathname === "/api/my-work") {
				allRequests.push(url);
				if (allRequests.length === 1) {
					return jsonResponse(response([firstPage], "history-1"));
				}
				if (allRequests.length === 2) {
					return jsonResponse(response([secondPage]));
				}
				return jsonResponse(response([queryPage]));
			}
			return jsonResponse(queryPage);
		});

		renderSurface("/my-work?scope=all");
		await waitFor(() => expect(screen.getByText(firstPage.title)).toBeTruthy());
		fireEvent.click(screen.getByRole("button", { name: /next page/i }));
		await waitFor(() =>
			expect(screen.getByText(secondPage.title)).toBeTruthy(),
		);
		expect(allRequests[1]?.searchParams.get("cursor")).toBe("history-1");

		fireEvent.change(screen.getByLabelText("Search My Work"), {
			target: { value: "needle" },
		});
		await waitFor(() => expect(screen.getByText(queryPage.title)).toBeTruthy());
		expect(allRequests).toHaveLength(3);
		expect(
			allRequests.every(
				(request) =>
					request.searchParams.get("scope") === "all" &&
					request.searchParams.get("limit") === "50",
			),
		).toBe(true);
		expect(allRequests[2]?.searchParams.get("q")).toBe("needle");
		expect(allRequests[2]?.searchParams.get("cursor")).toBeNull();
	});

	// Cycle 6B — Mark done conflict rollback/refresh race.
	it("rolls back a conflicted Mark done and ignores an older refresh snapshot", async () => {
		const item = makeItem({
			id: 26,
			key: "AT-26",
			title: "Race-protected Atlas work",
			source: "board",
			workspaceId: 7,
		});
		let activeListCalls = 0;
		let releaseOlder: ((value: Response) => void) | undefined;
		let releaseNewer: ((value: Response) => void) | undefined;
		const olderRefresh = new Promise<Response>((resolve) => {
			releaseOlder = resolve;
		});
		const newerRefresh = new Promise<Response>((resolve) => {
			releaseNewer = resolve;
		});
		createNetwork((url) => {
			if (url.pathname === "/api/my-work") {
				activeListCalls += 1;
				if (activeListCalls === 1) return jsonResponse(response([item]));
				if (activeListCalls === 2) return olderRefresh;
				return newerRefresh;
			}
			if (url.pathname.endsWith("/done")) {
				return jsonResponse({ error: "stale", code: "version_conflict" }, 409);
			}
			return jsonResponse(item);
		});

		renderSurface("/my-work?scope=active&workspaceId=7");
		await waitFor(() => expect(screen.getByText(item.title)).toBeTruthy());
		const detail = await openDetailFor(item);

		fireEvent.click(screen.getByRole("button", { name: "Refresh My Work" }));
		await waitFor(() => expect(activeListCalls).toBe(2));
		fireEvent.click(within(detail).getByRole("button", { name: "Mark done" }));
		await waitFor(() => expect(activeListCalls).toBe(3));
		await waitFor(() =>
			expect(within(detail).getByRole("alert").textContent).toMatch(
				/someone else updated this item first/i,
			),
		);

		releaseNewer?.(jsonResponse(response([])));
		await waitFor(() =>
			expect(screen.getByTestId("my-work-empty-active")).toBeTruthy(),
		);
		releaseOlder?.(jsonResponse(response([item])));
		await waitFor(() => {
			expect(screen.getByTestId("my-work-empty-active")).toBeTruthy();
			expect(screen.queryByTestId("my-work-row-7-board-AT-26")).toBeNull();
		});
		expect(screen.getByRole("dialog", { name: /AT-26/i })).toBeTruthy();
	});
});
