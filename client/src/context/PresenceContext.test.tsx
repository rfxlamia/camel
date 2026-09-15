// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../types";
import { PresenceProvider, usePresence } from "./PresenceContext";
import { ToastProvider } from "./ToastContext";
import { useWorkspace, WorkspaceProvider } from "./WorkspaceContext";

const mockGetWorkspaces = vi.fn();
const mockGetSettings = vi.fn();
const mockHeartbeat = vi.fn();
const mockGetPresence = vi.fn();
const mockPersistWorkspaceId = vi.fn();

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
	persistWorkspaceId: (...a: unknown[]) => mockPersistWorkspaceId(...a),
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

const alice = {
	id: 1,
	username: "alice",
	displayName: "Alice",
	emailVerified: true,
	needsUsername: false,
};

const bob = {
	id: 2,
	username: "bob",
	displayName: "Bob",
	emailVerified: true,
	needsUsername: false,
};

function Probe() {
	const { presence } = usePresence();
	const { activeWorkspaceId, switchWorkspace } = useWorkspace();
	return (
		<>
			<span data-testid="presence-count">{String(presence.length)}</span>
			<span data-testid="workspace">{String(activeWorkspaceId)}</span>
			<button type="button" onClick={() => switchWorkspace(9)}>
				Switch
			</button>
		</>
	);
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
				{
					id: 9,
					name: "Orbit",
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
		mockGetPresence.mockResolvedValue({ users: [alice] });
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

	it("ignores in-flight presence responses after workspace switch", async () => {
		let resolveFirstPresence: (value: { users: typeof alice[] }) => void =
			() => {};
		mockGetPresence.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveFirstPresence = resolve;
				}),
		);
		mockGetPresence.mockResolvedValue({ users: [] });

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

		await waitFor(() => expect(screen.getByTestId("workspace").textContent).toBe("7"));
		await waitFor(() => expect(mockGetPresence).toHaveBeenCalledWith(7));

		await act(async () => {
			screen.getByRole("button", { name: "Switch" }).click();
		});
		await waitFor(() =>
			expect(screen.getByTestId("workspace").textContent).toBe("9"),
		);
		expect(screen.getByTestId("presence-count").textContent).toBe("0");

		await act(async () => {
			resolveFirstPresence({ users: [bob] });
		});

		expect(screen.getByTestId("presence-count").textContent).toBe("0");
	});
});
