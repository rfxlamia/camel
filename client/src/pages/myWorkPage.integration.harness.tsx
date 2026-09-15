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
import { afterEach, beforeEach, expect, vi } from "vitest";
import {
	configureRequestBoundaryForTests,
	resetRequestBoundaryForTests,
} from "../api";
import { BoardProvider, useBoard } from "../context/BoardContext";
import { ToastProvider, useToastState } from "../context/ToastContext";
import { WorkspaceOverlays } from "../layout/sidebar/WorkspaceModals";
import { sourceItem } from "../lib/myWorkTestSupport";
import { resetMyWorkMutationsForTests } from "../lib/workItemMutations";
import type { User, Workspace } from "../types";
import type { MyWorkItem, MyWorkListResponse } from "../types/myWork";
import MyWorkPage from "./MyWorkPage";

export type FetchHandler = (
	url: URL,
	init: RequestInit | undefined,
) => Response | Promise<Response>;

export const testUser: User = {
	id: 1,
	username: "alice",
	displayName: "Alice",
	emailVerified: true,
	needsUsername: false,
};

function workspace(id: number, name: string): Workspace {
	return { id, name, role: "member", isPersonal: false, memberCount: 1 };
}

const workspaces: Workspace[] = [
	workspace(999, "Orbit"),
	workspace(7, "Atlas"),
];

export function jsonResponse(body: unknown, status = 200): Response {
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

function shellResponse(url: URL): Response {
	const body =
		url.pathname === "/api/workspaces"
			? { workspaces, pendingInvites: [] }
			: url.pathname === "/api/focus/config" ||
					url.pathname === "/api/ticket-intake/config"
				? { enabled: false }
				: url.pathname.endsWith("/board")
					? { columns: [] }
					: url.pathname.endsWith("/metrics")
						? null
						: url.pathname.includes("/activity")
							? { events: [] }
							: url.pathname.endsWith("/settings")
								? { boardName: "Camel", logoPath: "/logo.png", version: 0 }
								: url.pathname.endsWith("/presence")
									? { users: [] }
									: url.pathname.endsWith("/presence/heartbeat")
										? { ok: true }
										: {};
	return jsonResponse(body);
}

export function createNetwork(myWorkHandler?: FetchHandler) {
	const handler =
		myWorkHandler ?? (() => jsonResponse({ items: [], nextCursor: null }));
	const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
		const url = requestUrl(input);
		return url.pathname === "/api/my-work" ||
			url.pathname.startsWith("/api/my-work/")
			? handler(url, init)
			: shellResponse(url);
	});
	configureRequestBoundaryForTests({ fetchImpl });
	return fetchImpl;
}

export function response(
	items: MyWorkItem[],
	nextCursor: string | null = null,
): MyWorkListResponse {
	return { items, nextCursor };
}

export function networkFor(item: MyWorkItem, list = response([item])) {
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
	const { activeWorkspaceId } = useBoard();
	const toast = useToastState();
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

export function renderSurface(initialEntry: string) {
	return render(
		<MemoryRouter initialEntries={[initialEntry]}>
			<ToastProvider>
				<BoardProvider user={testUser} onSignedOut={vi.fn()}>
					<RouteBoundary />
				</BoardProvider>
			</ToastProvider>
			<LocationProbe />
		</MemoryRouter>,
	);
}

export function makeItem(
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

export function setViewportWidth(width: number) {
	Object.defineProperty(window, "innerWidth", {
		configurable: true,
		value: width,
	});
	window.dispatchEvent(new Event("resize"));
}

export async function openDetailFor(item: MyWorkItem) {
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
	constructor(_url: string) {
		void _url;
	}
	close() {
		return;
	}
}

vi.stubGlobal("EventSource", TestEventSource);
