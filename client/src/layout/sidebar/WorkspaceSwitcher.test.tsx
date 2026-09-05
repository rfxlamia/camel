// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Workspace, WorkspaceInvite } from "../../types";

const {
	mockUseBoard,
	mockGetSwitchAttemptState,
	mockGetInvitePopoverState,
	mockAttemptSwitchWorkspace,
} = vi.hoisted(() => ({
	mockUseBoard: vi.fn(),
	mockGetSwitchAttemptState: vi.fn(),
	mockGetInvitePopoverState: vi.fn(),
	mockAttemptSwitchWorkspace: vi.fn(),
}));

vi.mock("../../context/BoardContext", () => ({
	useBoard: () => mockUseBoard(),
}));

vi.mock("../../lib/workspaceSwitcher", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../lib/workspaceSwitcher")>();
	return {
		...actual,
		getSwitchAttemptState: (...args: unknown[]) =>
			mockGetSwitchAttemptState(...args),
		getInvitePopoverState: (...args: unknown[]) =>
			mockGetInvitePopoverState(...args),
	};
});

import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

const workspaceA: Workspace = {
	id: 1,
	name: "Alpha",
	role: "member",
	isPersonal: false,
	memberCount: 2,
};

const workspaceB: Workspace = {
	id: 2,
	name: "Beta",
	role: "member",
	isPersonal: false,
	memberCount: 3,
};

function setupBoard(overrides: Record<string, unknown> = {}) {
	mockUseBoard.mockReturnValue({
		activeWorkspace: workspaceA,
		activeWorkspaceId: 1,
		workspaces: [workspaceA, workspaceB],
		settings: { boardName: "Camel", logoPath: "/logo.png", version: 0 },
		pendingInvites: [] as WorkspaceInvite[],
		remindedInviteIds: [] as number[],
		hasUnsavedCardEdits: false,
		hasActiveFocusSession: true,
		focusSessionHydrated: false,
		attemptSwitchWorkspace: mockAttemptSwitchWorkspace,
		switchConfirm: { open: false },
		confirmPendingSwitch: vi.fn(),
		cancelPendingSwitch: vi.fn(),
		openCreateWorkspace: vi.fn(),
		acceptWorkspaceInvite: vi.fn(),
		declineWorkspaceInvite: vi.fn(),
		...overrides,
	});
	mockGetInvitePopoverState.mockReturnValue({ visible: false, invites: [] });
	mockGetSwitchAttemptState.mockReturnValue({ status: "focus-loading" });
}

describe("WorkspaceSwitcher focus guard wiring", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("forwards focus flags to getSwitchAttemptState and closes the menu", () => {
		setupBoard();

		render(<WorkspaceSwitcher />);

		fireEvent.click(screen.getByRole("button", { name: /alpha/i }));
		expect(screen.getByRole("listbox")).toBeTruthy();

		fireEvent.click(screen.getByRole("option", { name: /beta/i }));

		expect(mockGetSwitchAttemptState).toHaveBeenCalledWith({
			activeWorkspaceId: 1,
			targetWorkspaceId: 2,
			hasUnsavedCardEdits: false,
			hasActiveFocusSession: true,
			focusSessionHydrated: false,
		});
		expect(mockAttemptSwitchWorkspace).toHaveBeenCalledWith(2);
		expect(screen.queryByRole("listbox")).toBeNull();
	});

	it("keeps the menu open when confirmation is required", () => {
		setupBoard({
			hasActiveFocusSession: false,
			focusSessionHydrated: true,
			hasUnsavedCardEdits: true,
		});
		mockGetSwitchAttemptState.mockReturnValue({
			status: "confirm-required",
			pendingWorkspaceId: 2,
		});

		render(<WorkspaceSwitcher />);

		fireEvent.click(screen.getByRole("button", { name: /alpha/i }));
		fireEvent.click(screen.getByRole("option", { name: /beta/i }));

		expect(screen.getByRole("listbox")).toBeTruthy();
	});
});
