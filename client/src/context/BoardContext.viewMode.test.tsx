import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBoardViewMode, writeBoardViewMode } from "../lib/boardViewPrefs";
import type { User } from "../types";

const mockGetBoard = vi.fn();
const mockGetWorkspaces = vi.fn();
const mockGetMetrics = vi.fn();
const mockGetActivity = vi.fn();
const mockGetSettings = vi.fn();
const mockHeartbeat = vi.fn();
const mockGetPresence = vi.fn();

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
	readSavedWorkspaceId: () => 7,
	persistWorkspaceId: vi.fn(),
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
			{ id: 7, name: "Workspace A", role: "member", isPersonal: false, memberCount: 2 },
			{ id: 9, name: "Workspace B", role: "member", isPersonal: false, memberCount: 3 },
		],
		invites: [],
	});
	mockGetBoard.mockResolvedValue({ columns: [] });
	mockGetMetrics.mockResolvedValue(null);
	mockGetActivity.mockResolvedValue([]);
	mockGetSettings.mockResolvedValue({ settings: {} });
	mockHeartbeat.mockResolvedValue({ ok: true });
	mockGetPresence.mockResolvedValue({ users: [] });
}

import { BoardProvider, useBoard } from "./BoardContext";

function ViewModeProbe() {
	const { boardViewMode, switchWorkspace, setBoardViewMode } = useBoard();
	return (
		<>
			<span data-testid="view-mode">{boardViewMode}</span>
			<button type="button" data-testid="switch-to-9" onClick={() => switchWorkspace(9)}>
				Switch to B
			</button>
			<button type="button" data-testid="set-calendar" onClick={() => setBoardViewMode("calendar")}>
				Set calendar
			</button>
		</>
	);
}

async function renderBoard() {
	await act(async () => {
		render(
			<BoardProvider user={testUser} onSignedOut={vi.fn()}>
				<ViewModeProbe />
			</BoardProvider>,
		);
	});
	await waitFor(() => expect(screen.getByTestId("view-mode")).toBeTruthy());
}

describe("BoardContext view mode", () => {
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

	it("defaults to board when no preference stored", async () => {
		await renderBoard();
		expect(screen.getByTestId("view-mode").textContent).toBe("board");
	});

	it("restores stored view mode for active workspace", async () => {
		writeBoardViewMode(7, "list");
		await renderBoard();
		expect(screen.getByTestId("view-mode").textContent).toBe("list");
	});

	it("re-resolves view mode immediately on workspace switch", async () => {
		writeBoardViewMode(7, "list");
		writeBoardViewMode(9, "calendar");
		await renderBoard();
		expect(screen.getByTestId("view-mode").textContent).toBe("list");
		await act(async () => {
			fireEvent.click(screen.getByTestId("switch-to-9"));
		});
		await waitFor(() =>
			expect(screen.getByTestId("view-mode").textContent).toBe("calendar"),
		);
	});

	it("persists view mode via setBoardViewMode per workspace", async () => {
		await renderBoard();
		await act(async () => {
			fireEvent.click(screen.getByTestId("set-calendar"));
		});
		expect(screen.getByTestId("view-mode").textContent).toBe("calendar");
		expect(readBoardViewMode(7)).toBe("calendar");
		expect(readBoardViewMode(9)).toBe("board");
	});

	it("falls back to board when localStorage read fails on workspace switch", async () => {
		writeBoardViewMode(9, "calendar");
		const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		await renderBoard();
		await act(async () => {
			fireEvent.click(screen.getByTestId("switch-to-9"));
		});
		await waitFor(() =>
			expect(screen.getByTestId("view-mode").textContent).toBe("board"),
		);
		getItem.mockRestore();
	});
});
