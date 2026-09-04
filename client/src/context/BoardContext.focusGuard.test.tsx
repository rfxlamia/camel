// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../types";

const mockGetBoard = vi.fn();
const mockGetWorkspaces = vi.fn();
const mockGetMetrics = vi.fn();
const mockGetActivity = vi.fn();
const mockGetSettings = vi.fn();
const mockHeartbeat = vi.fn();
const mockGetPresence = vi.fn();
const mockFocusGetConfig = vi.fn();
const mockPersistWorkspaceId = vi.fn();

vi.mock("../api", () => ({
	api: {
		getBoard: (...a: unknown[]) => mockGetBoard(...a),
		getWorkspaces: (...a: unknown[]) => mockGetWorkspaces(...a),
		getMetrics: (...a: unknown[]) => mockGetMetrics(...a),
		getActivity: (...a: unknown[]) => mockGetActivity(...a),
		getSettings: (...a: unknown[]) => mockGetSettings(...a),
		heartbeat: (...a: unknown[]) => mockHeartbeat(...a),
		getPresence: (...a: unknown[]) => mockGetPresence(...a),
		ticketIntake: {
			getConfig: vi.fn().mockResolvedValue({ enabled: false }),
		},
		focus: {
			getConfig: (...a: unknown[]) => mockFocusGetConfig(...a),
		},
	},
	ApiError: class ApiError extends Error {
		status: number;
		constructor(message: string, status = 0) {
			super(message);
			this.status = status;
		}
	},
}));

vi.mock("../lib/workspaceSelection", () => ({
	chooseInitialWorkspace: ({
		workspaces,
		savedWorkspaceId,
	}: {
		workspaces: { id: number }[];
		savedWorkspaceId: number | null;
	}) => {
		if (savedWorkspaceId !== null) {
			const saved = workspaces.find((w) => w.id === savedWorkspaceId);
			if (saved) {
				return {
					activeWorkspaceId: saved.id,
					pickerRequired: false,
					clearSavedWorkspace: false,
				};
			}
		}
		return {
			activeWorkspaceId: workspaces[0]?.id ?? null,
			pickerRequired: false,
			clearSavedWorkspace: false,
		};
	},
	readSavedWorkspaceId: () => 1,
	persistWorkspaceId: (...a: unknown[]) => mockPersistWorkspaceId(...a),
	clearSavedWorkspaceId: vi.fn(),
	planWorkspaceRefresh: () => ({}),
	getRemovalRedirect: vi.fn(),
}));

class MockEventSource {
	static instances: MockEventSource[] = [];
	url: string;
	close = vi.fn();
	constructor(url: string) {
		this.url = url;
		MockEventSource.instances.push(this);
	}
}
vi.stubGlobal("EventSource", MockEventSource);

const testUser: User = {
	id: 1,
	username: "alice",
	displayName: "Alice",
	emailVerified: true,
	needsUsername: false,
};

function setupApiMocks() {
	mockGetWorkspaces.mockResolvedValue({
		workspaces: [
			{
				id: 1,
				name: "Workspace A",
				role: "member",
				isPersonal: false,
				memberCount: 2,
			},
			{
				id: 2,
				name: "Workspace B",
				role: "member",
				isPersonal: false,
				memberCount: 3,
			},
		],
		invites: [],
	});
	mockGetBoard.mockResolvedValue({ columns: [] });
	mockGetMetrics.mockResolvedValue(null);
	mockGetActivity.mockResolvedValue({ events: [] });
	mockGetSettings.mockResolvedValue({ settings: {} });
	mockHeartbeat.mockResolvedValue({ ok: true });
	mockGetPresence.mockResolvedValue({ users: [] });
	mockFocusGetConfig.mockResolvedValue({ enabled: true });
}

import { BoardProvider, useBoard } from "./BoardContext";
import {
	FOCUS_BLOCKED_TOAST,
	FOCUS_LOADING_TOAST,
} from "../lib/workspaceSwitcher";

function FocusGuardProbe() {
	const {
		activeWorkspaceId,
		attemptSwitchWorkspace,
		setHasActiveFocusSession,
		setFocusSessionHydrated,
		toast,
	} = useBoard();
	return (
		<>
			<span data-testid="active-workspace">{String(activeWorkspaceId)}</span>
			<span data-testid="toast">{toast?.message ?? ""}</span>
			<button
				type="button"
				data-testid="activate-focus"
				onClick={() => {
					setFocusSessionHydrated(true);
					setHasActiveFocusSession(true);
				}}
			>
				Activate focus
			</button>
			<button
				type="button"
				data-testid="hydrate-focus"
				onClick={() => setFocusSessionHydrated(true)}
			>
				Hydrate focus
			</button>
			<button
				type="button"
				data-testid="switch-to-2"
				onClick={() => attemptSwitchWorkspace(2)}
			>
				Switch to B
			</button>
		</>
	);
}

async function renderBoard() {
	await act(async () => {
		render(
			<BoardProvider user={testUser} onSignedOut={vi.fn()}>
				<FocusGuardProbe />
			</BoardProvider>,
		);
	});
	await waitFor(() =>
		expect(screen.getByTestId("active-workspace").textContent).toBe("1"),
	);
	mockPersistWorkspaceId.mockClear();
}

describe("BoardContext focus workspace switch guard", () => {
	beforeEach(() => {
		localStorage.clear();
		MockEventSource.instances = [];
		setupApiMocks();
	});

	afterEach(() => {
		cleanup();
		localStorage.clear();
		vi.clearAllMocks();
	});

	it("blocks workspace switch while a focus session is active", async () => {
		await renderBoard();

		await act(async () => {
			fireEvent.click(screen.getByTestId("activate-focus"));
		});
		await act(async () => {
			fireEvent.click(screen.getByTestId("switch-to-2"));
		});

		expect(screen.getByTestId("active-workspace").textContent).toBe("1");
		expect(mockPersistWorkspaceId).not.toHaveBeenCalled();
		expect(screen.getByTestId("toast").textContent).toBe(FOCUS_BLOCKED_TOAST);
	});

	it("allows workspace switch when focus is hydrated and no session is active", async () => {
		await renderBoard();

		await act(async () => {
			fireEvent.click(screen.getByTestId("hydrate-focus"));
		});
		await act(async () => {
			fireEvent.click(screen.getByTestId("switch-to-2"));
		});

		await waitFor(() =>
			expect(screen.getByTestId("active-workspace").textContent).toBe("2"),
		);
		expect(mockPersistWorkspaceId).toHaveBeenCalledWith(2);
		expect(screen.getByTestId("toast").textContent).toBe("");
	});

	it("blocks workspace switch while focus session is still hydrating", async () => {
		await renderBoard();

		await act(async () => {
			fireEvent.click(screen.getByTestId("switch-to-2"));
		});

		expect(screen.getByTestId("active-workspace").textContent).toBe("1");
		expect(mockPersistWorkspaceId).not.toHaveBeenCalled();
		expect(screen.getByTestId("toast").textContent).toBe(FOCUS_LOADING_TOAST);
	});
});
