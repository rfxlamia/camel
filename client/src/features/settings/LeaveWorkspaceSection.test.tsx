import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "../../types";

const leaveWorkspace = vi.fn();

vi.mock("../../api", () => ({
	api: {
		leaveWorkspace: (...a: unknown[]) => leaveWorkspace(...a),
	},
	ApiError: class ApiError extends Error {
		status: number;
		constructor(message: string, status: number) {
			super(message);
			this.status = status;
		}
	},
}));

const showToast = vi.fn();
const reloadWorkspaces = vi.fn();
const switchWorkspace = vi.fn();

const memberWorkspace: Workspace = {
	id: 7,
	name: "Beta WS",
	role: "member",
	isPersonal: false,
	memberCount: 5,
};
const personalWorkspace: Workspace = {
	id: 1,
	name: "Personal",
	role: "owner",
	isPersonal: true,
	memberCount: 1,
};

const mockUseWorkspace = vi.fn();

vi.mock("../../shared/WorkspaceContext", () => ({
	useWorkspace: () => mockUseWorkspace(),
}));

vi.mock("../../shared/ToastContext", () => ({
	useShowToast: () => showToast,
}));

import { ApiError } from "../../api";
import LeaveWorkspaceSection from "./LeaveWorkspaceSection";

/** The section header toggle and the action button share the accessible name. */
function getLeaveButton() {
	const buttons = screen.getAllByRole("button", { name: "Leave workspace" });
	return buttons[buttons.length - 1]!;
}

function renderSection() {
	render(<LeaveWorkspaceSection />);
}

beforeEach(() => {
	mockUseWorkspace.mockReturnValue({
		activeWorkspace: memberWorkspace,
		activeWorkspaceId: 7,
		reloadWorkspaces,
		switchWorkspace,
	});
	reloadWorkspaces.mockResolvedValue([personalWorkspace]);
	leaveWorkspace.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("LeaveWorkspaceSection", () => {
	it("renders nothing for the workspace owner", () => {
		mockUseWorkspace.mockReturnValue({
			activeWorkspace: { ...memberWorkspace, role: "owner" },
			activeWorkspaceId: 7,
			reloadWorkspaces,
			switchWorkspace,
		});

		const { container } = render(<LeaveWorkspaceSection />);

		expect(container.innerHTML).toBe("");
	});

	it("offers a leave button to non-owner members", () => {
		renderSection();

		expect(
			screen.getByText("Leave workspace", { selector: "button" }),
		).toBeTruthy();
		expect(getLeaveButton()).toBeTruthy();
	});

	it("leaves on confirm, switches to the personal workspace, and toasts", async () => {
		renderSection();

		fireEvent.click(getLeaveButton());
		const dialog = await screen.findByRole("dialog");
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Confirm leave" }),
		);

		await waitFor(() => {
			expect(leaveWorkspace).toHaveBeenCalledWith(7);
		});
		await waitFor(() => {
			expect(switchWorkspace).toHaveBeenCalledWith(1);
		});
		expect(reloadWorkspaces).toHaveBeenCalled();
		await waitFor(() => {
			expect(showToast).toHaveBeenCalledWith("You left Beta WS.", "success");
		});
	});

	it("shows the server error when leaving fails", async () => {
		leaveWorkspace.mockRejectedValue(
			new ApiError("Cannot leave this workspace", 403),
		);

		renderSection();

		fireEvent.click(getLeaveButton());
		const dialog = await screen.findByRole("dialog");
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Confirm leave" }),
		);

		await waitFor(() => {
			expect(showToast).toHaveBeenCalledWith(
				"Cannot leave this workspace",
				"error",
			);
		});
		expect(switchWorkspace).not.toHaveBeenCalled();
	});
});
