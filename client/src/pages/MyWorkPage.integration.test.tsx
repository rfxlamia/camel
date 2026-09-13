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

function networkFor(item: MyWorkItem, list = response([item])) {
	return createNetwork((url) =>
		url.pathname === "/api/my-work" ? jsonResponse(list) : jsonResponse(item),
	);
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
		networkFor(item, response(items));

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
	const sourceGuardScenarios = [
		["Board allowed", "board", 17, "AT-17", "allowed"],
		["Tracker allowed", "tracker", 27, "OR-27", "allowed"],
		["Board focus-blocked", "board", 18, "AT-18", "blocked"],
		["Tracker focus-blocked", "tracker", 28, "OR-28", "blocked"],
		["Board confirmation-canceled", "board", 19, "AT-19", "canceled"],
		["Tracker confirmation-canceled", "tracker", 29, "OR-29", "canceled"],
	] as const;

	async function runSourceGuardScenario(
		item: MyWorkItem,
		outcome: (typeof sourceGuardScenarios)[number][4],
	) {
		const sourceLabel = item.source === "board" ? "Board" : "Tracker";
		const routeTestId = `${item.source}-route`;
		const detail = await openDetailFor(item);
		if (outcome === "allowed") {
			fireEvent.click(screen.getByRole("button", { name: "Allow transition" }));
			fireEvent.click(
				within(detail).getByRole("button", {
					name: `Open in ${sourceLabel}`,
				}),
			);
			await waitFor(() => expect(screen.getByTestId(routeTestId)).toBeTruthy());
			expect(screen.getByTestId("active-workspace").textContent).toBe("7");
			expect(screen.getByTestId("location").textContent).toBe(
				item.source === "board"
					? `/board/card/${item.id}`
					: `/tracker/${item.key}`,
			);
			return;
		}
		if (outcome === "blocked") {
			fireEvent.click(screen.getByRole("button", { name: "Block focus" }));
			fireEvent.click(
				within(detail).getByRole("button", {
					name: `Open in ${sourceLabel}`,
				}),
			);
			await waitFor(() =>
				expect(screen.getByTestId("guard-toast").textContent).toMatch(
					/finish your focus session/i,
				),
			);
		} else {
			fireEvent.click(
				screen.getByRole("button", { name: "Require confirmation" }),
			);
			fireEvent.click(
				within(detail).getByRole("button", {
					name: `Open in ${sourceLabel}`,
				}),
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
		}
		expect(screen.getByTestId("active-workspace").textContent).toBe("999");
		expect(screen.getByTestId("location").textContent).toContain("/my-work");
		expect(screen.queryByTestId(routeTestId)).toBeNull();
		expect(
			screen.getByRole("dialog", { name: new RegExp(item.key) }),
		).toBeTruthy();
	}

	it.each(
		sourceGuardScenarios,
	)("handles %s through the real workspace guard", async (label, source, id, key, outcome) => {
		const item = makeItem({
			id,
			key,
			title: `${label} work`,
			source,
			workspaceId: 7,
		});
		networkFor(item);
		renderSurface("/my-work?scope=active&workspaceId=7&page=2");
		await waitFor(() => expect(screen.getByText(item.key)).toBeTruthy());
		await runSourceGuardScenario(item, outcome);
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
		networkFor(item);

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

	// Cycle 6 — server-backed All query/cursor.
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

	// Cycle 7 — Mark done conflict rollback/refresh race.
	it("observes optimistic removal, conflict rollback, and stale refresh protection", async () => {
		const item = makeItem({
			id: 26,
			key: "AT-26",
			title: "Race-protected Atlas work",
			source: "board",
			workspaceId: 7,
		});
		const retained = makeItem({
			id: 26,
			key: "AT-26",
			title: "Fresh conflict snapshot",
			source: "board",
			workspaceId: 7,
			version: 2,
		});
		const stale = makeItem({
			id: 26,
			key: "AT-26",
			title: "Stale older snapshot",
			source: "board",
			workspaceId: 7,
		});
		let activeListCalls = 0;
		let mutationCalls = 0;
		let mutationMethod: string | undefined;
		let releaseMutation: ((value: Response) => void) | undefined;
		let releaseOlder: ((value: Response) => void) | undefined;
		let releaseNewer: ((value: Response) => void) | undefined;
		const mutationResponse = new Promise<Response>((resolve) => {
			releaseMutation = resolve;
		});
		const olderRefresh = new Promise<Response>((resolve) => {
			releaseOlder = resolve;
		});
		const newerRefresh = new Promise<Response>((resolve) => {
			releaseNewer = resolve;
		});
		createNetwork((url, init) => {
			if (url.pathname === "/api/my-work") {
				activeListCalls += 1;
				if (activeListCalls === 1) return jsonResponse(response([item]));
				if (activeListCalls === 2) return olderRefresh;
				return newerRefresh;
			}
			if (url.pathname.endsWith("/done")) {
				mutationCalls += 1;
				mutationMethod = init?.method;
				return mutationResponse;
			}
			return jsonResponse(item);
		});

		renderSurface("/my-work?scope=active&workspaceId=7");
		await waitFor(() => expect(screen.getByText(item.title)).toBeTruthy());
		const detail = await openDetailFor(item);
		const rowId = "my-work-row-7-board-AT-26";
		expect(screen.getByTestId(rowId)).toBeTruthy();

		fireEvent.click(within(detail).getByRole("button", { name: "Mark done" }));
		await waitFor(() => expect(screen.queryByTestId(rowId)).toBeNull());
		await waitFor(() => expect(mutationCalls).toBe(1));
		expect(mutationMethod).toBe("POST");

		fireEvent.click(screen.getByRole("button", { name: "Refresh My Work" }));
		await waitFor(() => expect(activeListCalls).toBe(2));
		releaseMutation?.(
			jsonResponse({ error: "stale", code: "version_conflict" }, 409),
		);
		await waitFor(() => expect(activeListCalls).toBe(3));
		await waitFor(() =>
			expect(within(detail).getByRole("alert").textContent).toMatch(
				/someone else updated this item first/i,
			),
		);

		releaseNewer?.(jsonResponse(response([retained])));
		const retainedRow = await screen.findByTestId(rowId);
		expect(within(retainedRow).getByText(retained.title)).toBeTruthy();
		expect(within(retainedRow).getByRole("alert").textContent).toMatch(
			/someone else updated this item first/i,
		);

		releaseOlder?.(jsonResponse(response([stale])));
		await waitFor(() => {
			expect(screen.getByTestId(rowId)).toBe(retainedRow);
			expect(screen.getByTestId(rowId).textContent).toContain(retained.title);
			expect(screen.queryByText(stale.title)).toBeNull();
		});
		expect(activeListCalls).toBe(3);
	});
});
