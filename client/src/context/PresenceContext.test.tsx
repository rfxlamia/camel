// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../types";
import { PresenceProvider, usePresence } from "./PresenceContext";
import { ToastProvider } from "./ToastContext";
import { WorkspaceProvider } from "./WorkspaceContext";

const mockGetWorkspaces = vi.fn();
const mockGetSettings = vi.fn();
const mockHeartbeat = vi.fn();
const mockGetPresence = vi.fn();

vi.mock("../api", () => ({
	api: {
		getWorkspaces: (...a: unknown[]) => mockGetWorkspaces(...a),
		getSettings: (...a: unknown[]) => mockGetSettings(...a),
		heartbeat: (...a: unknown[]) => mockHeartbeat(...a),
		getPresence: (...a: unknown[]) => mockGetPresence(...a),
		ticketIntake: {
			getConfig: vi.fn().mockResolvedValue({ enabled: false }),
		},
		focus: {
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
	chooseInitialWorkspace: () => ({
		activeWorkspaceId: 7,
		pickerRequired: false,
		clearSavedWorkspace: false,
	}),
	readSavedWorkspaceId: () => 7,
	persistWorkspaceId: vi.fn(),
	clearSavedWorkspaceId: vi.fn(),
	getRemovalRedirect: vi.fn(),
}));

const testUser: User = {
	id: 1,
	username: "alice",
	displayName: "Alice",
	emailVerified: true,
	needsUsername: false,
};

function Probe() {
	const { presence } = usePresence();
	return <span data-testid="presence-count">{String(presence.length)}</span>;
}

describe("PresenceContext", () => {
	beforeEach(() => {
		localStorage.clear();
		mockGetWorkspaces.mockResolvedValue({
			workspaces: [
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
		mockGetSettings.mockResolvedValue({
			boardName: "Camel",
			logoPath: "/logo.png",
			version: 0,
		});
		mockHeartbeat.mockResolvedValue({ ok: true });
		mockGetPresence.mockResolvedValue({
			users: [
				{
					id: 1,
					username: "alice",
					displayName: "Alice",
					emailVerified: true,
					needsUsername: false,
				},
			],
		});
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("throws outside PresenceProvider", () => {
		expect(() => render(<Probe />)).toThrow(
			"usePresence must be used within PresenceProvider",
		);
	});

	it("loads presence for the active workspace", async () => {
		await act(async () => {
			render(
				<ToastProvider>
					<WorkspaceProvider user={testUser} onSignedOut={vi.fn()}>
						<PresenceProvider>
							<Probe />
						</PresenceProvider>
					</WorkspaceProvider>
				</ToastProvider>,
			);
		});

		await waitFor(() =>
			expect(screen.getByTestId("presence-count").textContent).toBe("1"),
		);
		expect(mockHeartbeat).toHaveBeenCalledWith(7);
		expect(mockGetPresence).toHaveBeenCalledWith(7);
	});
});
