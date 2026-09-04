// @vitest-environment jsdom
import {
	act,
	cleanup,
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
			{
				id: 7,
				name: "Workspace A",
				role: "member",
				isPersonal: false,
				memberCount: 2,
			},
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

function FocusFlagProbe() {
	const { focusModeEnabled } = useBoard();
	return <span data-testid="focus-enabled">{String(focusModeEnabled)}</span>;
}

async function renderBoard() {
	await act(async () => {
		render(
			<BoardProvider user={testUser} onSignedOut={vi.fn()}>
				<FocusFlagProbe />
			</BoardProvider>,
		);
	});
}

describe("BoardContext focusModeEnabled", () => {
	beforeEach(() => {
		localStorage.clear();
		MockEventSource.instances = [];
		setupApiMocks();
		mockFocusGetConfig.mockReset();
	});

	afterEach(() => {
		cleanup();
		localStorage.clear();
		vi.clearAllMocks();
	});

	it("defaults to false while getConfig is pending", async () => {
		let resolve!: (value: { enabled: boolean }) => void;
		mockFocusGetConfig.mockReturnValue(
			new Promise((resolveFn) => {
				resolve = resolveFn;
			}),
		);

		await renderBoard();

		expect(screen.getByTestId("focus-enabled").textContent).toBe("false");

		await act(async () => {
			resolve({ enabled: true });
		});

		await waitFor(() =>
			expect(screen.getByTestId("focus-enabled").textContent).toBe("true"),
		);
	});

	it("sets true when getConfig resolves enabled:true", async () => {
		mockFocusGetConfig.mockResolvedValue({ enabled: true });

		await renderBoard();

		await waitFor(() =>
			expect(screen.getByTestId("focus-enabled").textContent).toBe("true"),
		);
	});

	it("stays false when getConfig rejects without surfacing an error", async () => {
		mockFocusGetConfig.mockRejectedValue(new Error("network"));

		await renderBoard();

		await waitFor(() => expect(mockFocusGetConfig).toHaveBeenCalled());
		expect(screen.getByTestId("focus-enabled").textContent).toBe("false");
	});
});
