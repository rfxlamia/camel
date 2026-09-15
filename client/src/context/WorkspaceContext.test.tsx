// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../types";
import { ToastProvider } from "./ToastContext";
import { useWorkspace, WorkspaceProvider } from "./WorkspaceContext";

const mockGetWorkspaces = vi.fn();
const mockGetSettings = vi.fn();

vi.mock("../api", () => ({
	api: {
		getWorkspaces: (...a: unknown[]) => mockGetWorkspaces(...a),
		getSettings: (...a: unknown[]) => mockGetSettings(...a),
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
	const { workspacesReady, activeWorkspaceId, settings, switchWorkspace } =
		useWorkspace();
	return (
		<>
			<span data-testid="ready">{String(workspacesReady)}</span>
			<span data-testid="workspace">{String(activeWorkspaceId)}</span>
			<span data-testid="board-name">{settings.boardName}</span>
			<span data-testid="settings-version">{String(settings.version)}</span>
			<button type="button" onClick={() => switchWorkspace(9)}>
				Switch
			</button>
		</>
	);
}

describe("WorkspaceContext", () => {
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
			boardName: "Atlas Board",
			logoPath: "/logo.png",
			version: 1,
		});
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("throws outside WorkspaceProvider", () => {
		expect(() => render(<Probe />)).toThrow(
			"useWorkspace must be used within WorkspaceProvider",
		);
	});

	it("bootstraps active workspace and loads settings on enter", async () => {
		await act(async () => {
			render(
				<ToastProvider>
					<WorkspaceProvider user={testUser} onSignedOut={vi.fn()}>
						<Probe />
					</WorkspaceProvider>
				</ToastProvider>,
			);
		});

		await waitFor(() =>
			expect(screen.getByTestId("ready").textContent).toBe("true"),
		);
		expect(screen.getByTestId("workspace").textContent).toBe("7");
		await waitFor(() =>
			expect(screen.getByTestId("board-name").textContent).toBe("Atlas Board"),
		);
	});

	it("ignores stale settings responses after workspace switch", async () => {
		let resolveAtlasSettings: (value: {
			boardName: string;
			logoPath: string;
			version: number;
		}) => void = () => {};
		mockGetSettings.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveAtlasSettings = resolve;
				}),
		);
		mockGetSettings.mockResolvedValue({
			boardName: "Orbit Board",
			logoPath: "/orbit.png",
			version: 3,
		});

		await act(async () => {
			render(
				<ToastProvider>
					<WorkspaceProvider user={testUser} onSignedOut={vi.fn()}>
						<Probe />
					</WorkspaceProvider>
				</ToastProvider>,
			);
		});

		await waitFor(() =>
			expect(screen.getByTestId("workspace").textContent).toBe("7"),
		);
		await waitFor(() => expect(mockGetSettings).toHaveBeenCalledWith(7));

		await act(async () => {
			screen.getByRole("button", { name: "Switch" }).click();
		});
		await waitFor(() =>
			expect(screen.getByTestId("workspace").textContent).toBe("9"),
		);
		await waitFor(() =>
			expect(screen.getByTestId("board-name").textContent).toBe("Orbit Board"),
		);

		await act(async () => {
			resolveAtlasSettings({
				boardName: "Stale Atlas",
				logoPath: "/stale.png",
				version: 99,
			});
		});

		expect(screen.getByTestId("board-name").textContent).toBe("Orbit Board");
		expect(screen.getByTestId("settings-version").textContent).toBe("3");
	});
});
