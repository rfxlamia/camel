import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceMember } from "../../types";

const getWorkspaceMembers = vi.fn();
const removeWorkspaceMember = vi.fn();
const updateWorkspaceMemberRole = vi.fn();
const transferWorkspaceOwnership = vi.fn();
const cancelWorkspaceInvite = vi.fn();

vi.mock("../../api", () => ({
	api: {
		getWorkspaceMembers: (...a: unknown[]) => getWorkspaceMembers(...a),
		removeWorkspaceMember: (...a: unknown[]) => removeWorkspaceMember(...a),
		updateWorkspaceMemberRole: (...a: unknown[]) =>
			updateWorkspaceMemberRole(...a),
		transferWorkspaceOwnership: (...a: unknown[]) =>
			transferWorkspaceOwnership(...a),
		cancelWorkspaceInvite: (...a: unknown[]) => cancelWorkspaceInvite(...a),
	},
	ApiError: class ApiError extends Error {
		status: number;
		constructor(message: string, status: number) {
			super(message);
			this.status = status;
		}
	},
}));

import { ApiError } from "../../api";
import ManageMembersSection from "./ManageMembersSection";

const owner: WorkspaceMember = {
	userId: 1,
	username: "owner",
	displayName: "Owner User",
	role: "owner",
};
const admin: WorkspaceMember = {
	userId: 2,
	username: "admin",
	displayName: "Admin User",
	role: "admin",
};
const member: WorkspaceMember = {
	userId: 3,
	username: "member",
	displayName: "Member User",
	role: "member",
};

const showToast = vi.fn();

function renderSection(role: "owner" | "admin" | "member", userId = 99) {
	render(
		<ManageMembersSection
			workspaceId={7}
			currentUserId={userId}
			currentUserRole={role}
			showToast={showToast}
		/>,
	);
}

beforeEach(() => {
	getWorkspaceMembers.mockResolvedValue({
		members: [owner, admin, member],
	});
	removeWorkspaceMember.mockResolvedValue(undefined);
	transferWorkspaceOwnership.mockResolvedValue({ ok: true });
	cancelWorkspaceInvite.mockResolvedValue(undefined);
	updateWorkspaceMemberRole.mockImplementation(
		async (_ws: number, userId: number, body: { role: string }) => ({
			...(userId === 3 ? member : admin),
			role: body.role,
		}),
	);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("ManageMembersSection permissions", () => {
	it("member viewer sees badges only, no Remove buttons", async () => {
		renderSection("member");
		await waitFor(() => {
			expect(screen.getByText("Admin User")).toBeTruthy();
		});
		expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
		expect(screen.queryByRole("combobox")).toBeNull();
		expect(screen.getAllByText("Admin").length).toBeGreaterThan(0);
	});

	it("admin viewer sees Remove for non-owner rows but no role dropdown", async () => {
		renderSection("admin", 2);
		await waitFor(() => {
			expect(screen.getByText("Member User")).toBeTruthy();
		});
		const removeButtons = screen.getAllByRole("button", { name: "Remove" });
		expect(removeButtons.length).toBe(1);
		expect(screen.queryByRole("combobox")).toBeNull();
	});

	it("owner viewer sees role dropdowns and Remove for non-owner rows", async () => {
		renderSection("owner", 1);
		await waitFor(() => {
			expect(screen.getByText("Member User")).toBeTruthy();
		});
		expect(screen.getAllByRole("combobox").length).toBe(2);
		expect(screen.getAllByRole("button", { name: "Remove" }).length).toBe(2);
	});
});

describe("ManageMembersSection interactions", () => {
	it("confirms remove and calls API", async () => {
		renderSection("admin", 2);
		await waitFor(() => {
			expect(screen.getByText("Member User")).toBeTruthy();
		});
		fireEvent.click(screen.getByRole("button", { name: "Remove" }));
		const dialog = screen.getByRole("dialog", { name: /Remove Member User\?/ });
		expect(within(dialog).getByText(/Remove Member User\?/)).toBeTruthy();
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Confirm remove" }),
		);
		await waitFor(() => {
			expect(removeWorkspaceMember).toHaveBeenCalledWith(7, 3);
		});
	});

	it("calls PATCH on role change", async () => {
		renderSection("owner", 1);
		await waitFor(() => {
			expect(screen.getByText("Member User")).toBeTruthy();
		});
		fireEvent.change(screen.getByLabelText("Role for Member User"), {
			target: { value: "admin" },
		});
		await waitFor(() => {
			expect(updateWorkspaceMemberRole).toHaveBeenCalledWith(7, 3, {
				role: "admin",
			});
		});
	});

	it("shows error toast when role update fails", async () => {
		updateWorkspaceMemberRole.mockRejectedValueOnce(
			new ApiError("Not found", 404),
		);
		renderSection("owner", 1);
		await waitFor(() => {
			expect(screen.getByText("Member User")).toBeTruthy();
		});
		fireEvent.change(screen.getByLabelText("Role for Member User"), {
			target: { value: "admin" },
		});
		await waitFor(() => {
			expect(showToast).toHaveBeenCalledWith("Not found", "error");
		});
		expect(
			(screen.getByLabelText("Role for Member User") as HTMLSelectElement)
				.value,
		).toBe("member");
	});

	it("dismisses remove dialog on Escape", async () => {
		renderSection("admin", 2);
		await waitFor(() => {
			expect(screen.getByText("Member User")).toBeTruthy();
		});
		fireEvent.click(screen.getByRole("button", { name: "Remove" }));
		expect(
			screen.getByRole("dialog", { name: /Remove Member User\?/ }),
		).toBeTruthy();
		fireEvent.keyDown(document, { key: "Escape" });
		expect(
			screen.queryByRole("dialog", { name: /Remove Member User\?/ }),
		).toBeNull();
	});

	it("shows error toast when remove fails", async () => {
		removeWorkspaceMember.mockRejectedValueOnce(
			new ApiError("Cannot remove yourself", 403),
		);
		renderSection("admin", 2);
		await waitFor(() => {
			expect(screen.getByText("Member User")).toBeTruthy();
		});
		fireEvent.click(screen.getByRole("button", { name: "Remove" }));
		fireEvent.click(
			within(
				screen.getByRole("dialog", { name: /Remove Member User\?/ }),
			).getByRole("button", { name: "Confirm remove" }),
		);
		await waitFor(() => {
			expect(showToast).toHaveBeenCalledWith("Cannot remove yourself", "error");
		});
	});

	it("shows retry UI when member list fails to load", async () => {
		getWorkspaceMembers.mockRejectedValueOnce(new Error("network"));
		renderSection("member");
		await waitFor(() => {
			expect(screen.getByText("Couldn't load members.")).toBeTruthy();
		});
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
		expect(showToast).toHaveBeenCalledWith(
			"Couldn't load members. Try again.",
			"error",
		);
	});

	it("re-fetches when refreshKey changes", async () => {
		const { rerender } = render(
			<ManageMembersSection
				workspaceId={7}
				currentUserId={1}
				currentUserRole="owner"
				refreshKey={0}
				showToast={showToast}
			/>,
		);
		await waitFor(() => expect(getWorkspaceMembers).toHaveBeenCalledTimes(1));
		rerender(
			<ManageMembersSection
				workspaceId={7}
				currentUserId={1}
				currentUserRole="owner"
				refreshKey={1}
				showToast={showToast}
			/>,
		);
		await waitFor(() => expect(getWorkspaceMembers).toHaveBeenCalledTimes(2));
	});

	it("keeps member list visible when refreshKey changes", async () => {
		const { rerender } = render(
			<ManageMembersSection
				workspaceId={7}
				currentUserId={1}
				currentUserRole="owner"
				refreshKey={0}
				showToast={showToast}
			/>,
		);
		await waitFor(() => {
			expect(screen.getByText("Member User")).toBeTruthy();
		});
		rerender(
			<ManageMembersSection
				workspaceId={7}
				currentUserId={1}
				currentUserRole="owner"
				refreshKey={1}
				showToast={showToast}
			/>,
		);
		expect(screen.getByText("Member User")).toBeTruthy();
		await waitFor(() => expect(getWorkspaceMembers).toHaveBeenCalledTimes(2));
	});
});

describe("Transfer ownership", () => {
	it("offers Make owner only to the owner viewer, on non-owner rows", async () => {
		renderSection("owner", 1);
		await waitFor(() => {
			expect(screen.getByText("Member User")).toBeTruthy();
		});
		expect(screen.getAllByRole("button", { name: "Make owner" }).length).toBe(
			2,
		);

		cleanup();
		renderSection("admin", 2);
		await waitFor(() => {
			expect(screen.getByText("Member User")).toBeTruthy();
		});
		expect(screen.queryByRole("button", { name: "Make owner" })).toBeNull();
	});

	it("confirms transfer, updates roles, and signals members changed", async () => {
		const onMembersChanged = vi.fn();
		render(
			<ManageMembersSection
				workspaceId={7}
				currentUserId={1}
				currentUserRole="owner"
				onMembersChanged={onMembersChanged}
				showToast={showToast}
			/>,
		);
		await waitFor(() => {
			expect(screen.getByText("Admin User")).toBeTruthy();
		});

		fireEvent.click(screen.getAllByRole("button", { name: "Make owner" })[0]!);
		const dialog = screen.getByRole("dialog", {
			name: /Transfer ownership to Admin User\?/,
		});
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Confirm transfer" }),
		);

		await waitFor(() => {
			expect(transferWorkspaceOwnership).toHaveBeenCalledWith(7, {
				newOwnerId: 2,
				previousOwnerRole: "admin",
			});
		});
		await waitFor(() => {
			expect(onMembersChanged).toHaveBeenCalled();
		});
		// The promoted member's role dropdown disappears (owner badge instead).
		await waitFor(() => {
			expect(screen.queryByLabelText("Role for Admin User")).toBeNull();
		});
	});

	it("shows an error toast and keeps roles when transfer fails", async () => {
		transferWorkspaceOwnership.mockRejectedValueOnce(
			new ApiError("Not found", 404),
		);
		renderSection("owner", 1);
		await waitFor(() => {
			expect(screen.getByText("Admin User")).toBeTruthy();
		});

		fireEvent.click(screen.getAllByRole("button", { name: "Make owner" })[0]!);
		fireEvent.click(
			within(
				screen.getByRole("dialog", {
					name: /Transfer ownership to Admin User\?/,
				}),
			).getByRole("button", { name: "Confirm transfer" }),
		);

		await waitFor(() => {
			expect(showToast).toHaveBeenCalledWith("Not found", "error");
		});
		expect(screen.getByLabelText("Role for Admin User")).toBeTruthy();
	});
});

describe("Pending invites integration (from #228)", () => {
	const pendingInvites = [
		{ id: 11, username: "carol", role: "member" },
		{ id: 12, username: "dave", role: "admin" },
	];

	it("shows pending invites to owner and cancelling removes the row", async () => {
		getWorkspaceMembers.mockResolvedValue({
			members: [owner, member],
			invites: pendingInvites,
		});
		const onMembersChanged = vi.fn();
		render(
			<ManageMembersSection
				workspaceId={7}
				currentUserId={1}
				currentUserRole="owner"
				onMembersChanged={onMembersChanged}
				showToast={showToast}
			/>,
		);
		await waitFor(() => {
			expect(screen.getByText("Pending invites")).toBeTruthy();
		});
		expect(screen.getByText("@carol")).toBeTruthy();
		expect(screen.getByText("@dave")).toBeTruthy();

		fireEvent.click(screen.getAllByRole("button", { name: /cancel/i })[0]!);

		await waitFor(() => {
			expect(cancelWorkspaceInvite).toHaveBeenCalledWith(7, 11);
		});
		await waitFor(() => {
			expect(screen.queryByText("@carol")).toBeNull();
		});
		expect(screen.getByText("@dave")).toBeTruthy();
		expect(onMembersChanged).toHaveBeenCalled();
	});

	it("shows pending invites to admin but not to ordinary members", async () => {
		getWorkspaceMembers.mockResolvedValue({
			members: [owner, admin, member],
			invites: pendingInvites,
		});

		cleanup();
		renderSection("admin", 2);
		await waitFor(() => {
			expect(screen.getByText("Member User")).toBeTruthy();
		});
		expect(screen.getByText("Pending invites")).toBeTruthy();

		cleanup();
		renderSection("member", 3);
		await waitFor(() => {
			expect(screen.getByText("Member User")).toBeTruthy();
		});
		expect(screen.queryByText("Pending invites")).toBeNull();
	});

	it("keeps showing pending invites for an owner with no members yet", async () => {
		getWorkspaceMembers.mockResolvedValue({
			members: [],
			invites: pendingInvites,
		});
		renderSection("owner", 1);
		await waitFor(() => {
			expect(screen.getByText("Pending invites")).toBeTruthy();
		});
		expect(screen.queryByText("No members yet")).toBeNull();
	});
});

describe("Transfer ownership integration contracts", () => {
	it("cancelling the confirmation dialog never calls the transfer API", async () => {
		renderSection("owner", 1);
		await waitFor(() => {
			expect(screen.getByText("Member User")).toBeTruthy();
		});

		fireEvent.click(screen.getAllByRole("button", { name: "Make owner" })[0]!);
		const dialog = screen.getByRole("dialog", {
			name: /Transfer ownership to Admin User\?/,
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

		expect(screen.queryByRole("dialog")).toBeNull();
		expect(transferWorkspaceOwnership).not.toHaveBeenCalled();

		fireEvent.click(screen.getAllByRole("button", { name: "Make owner" })[0]!);
		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(transferWorkspaceOwnership).not.toHaveBeenCalled();
	});

	it("removes owner-only controls once the refreshed role arrives after a transfer", async () => {
		const onMembersChanged = vi.fn();
		const { rerender } = render(
			<ManageMembersSection
				workspaceId={7}
				currentUserId={1}
				currentUserRole="owner"
				onMembersChanged={onMembersChanged}
				showToast={showToast}
			/>,
		);
		await waitFor(() => {
			expect(screen.getByText("Admin User")).toBeTruthy();
		});

		fireEvent.click(screen.getAllByRole("button", { name: "Make owner" })[0]!);
		fireEvent.click(
			within(
				screen.getByRole("dialog", {
					name: /Transfer ownership to Admin User\?/,
				}),
			).getByRole("button", { name: "Confirm transfer" }),
		);

		await waitFor(() => {
			expect(onMembersChanged).toHaveBeenCalled();
		});
		// SettingsPage reacts to onMembersChanged with reloadWorkspaces(), which
		// updates activeWorkspace.role to "admin" for the previous owner. The
		// refreshed currentUserRole prop must strip every owner-only control.
		rerender(
			<ManageMembersSection
				workspaceId={7}
				currentUserId={1}
				currentUserRole="admin"
				onMembersChanged={onMembersChanged}
				showToast={showToast}
			/>,
		);

		expect(screen.queryByRole("button", { name: "Make owner" })).toBeNull();
		expect(screen.queryByRole("combobox")).toBeNull();
		// The promoted member shows the Owner badge; the previous owner is
		// demoted to Admin in the local member list.
		expect(screen.getByText("Owner")).toBeTruthy();
		expect(screen.getAllByText("Admin").length).toBeGreaterThanOrEqual(1);
	});

	it("keeps the local member list untouched when the transfer fails", async () => {
		transferWorkspaceOwnership.mockRejectedValueOnce(
			new ApiError("Server error", 500),
		);
		renderSection("owner", 1);
		await waitFor(() => {
			expect(screen.getByText("Member User")).toBeTruthy();
		});

		// "Make owner" buttons: [0] = Admin User row, [1] = Member User row.
		fireEvent.click(screen.getAllByRole("button", { name: "Make owner" })[1]!);
		fireEvent.click(
			within(
				screen.getByRole("dialog", {
					name: /Transfer ownership to Member User\?/,
				}),
			).getByRole("button", { name: "Confirm transfer" }),
		);

		await waitFor(() => {
			expect(showToast).toHaveBeenCalledWith("Server error", "error");
		});
		// Roles unchanged: Admin User still editable, Member User still a member,
		// and no "Ownership transferred" success toast was shown.
		expect(screen.getByLabelText("Role for Admin User")).toBeTruthy();
		expect(showToast).not.toHaveBeenCalledWith(
			"Ownership transferred",
			"success",
		);
	});
});

describe("Transfer ownership stale-role handling", () => {
	it("hides owner-only controls immediately after transfer, before the reload lands", async () => {
		const onMembersChanged = vi.fn();
		render(
			<ManageMembersSection
				workspaceId={7}
				currentUserId={1}
				currentUserRole="owner"
				onMembersChanged={onMembersChanged}
				showToast={showToast}
			/>,
		);
		await waitFor(() => {
			expect(screen.getByText("Admin User")).toBeTruthy();
		});
		fireEvent.click(screen.getAllByRole("button", { name: "Make owner" })[0]!);
		fireEvent.click(
			within(
				screen.getByRole("dialog", {
					name: /Transfer ownership to Admin User\?/,
				}),
			).getByRole("button", { name: "Confirm transfer" }),
		);
		await waitFor(() => {
			expect(onMembersChanged).toHaveBeenCalled();
		});

		// The workspace reload triggered by onMembersChanged has not resolved
		// yet, so the currentUserRole prop is still the stale "owner" — but the
		// local demotion must already remove every owner-only control.
		expect(screen.queryByRole("button", { name: "Make owner" })).toBeNull();
		expect(screen.queryByRole("combobox")).toBeNull();
		expect(screen.getByText("Owner")).toBeTruthy();
	});

	it("keeps owner-only controls hidden when the reload fails and the role prop stays stale", async () => {
		const onMembersChanged = vi.fn();
		const { rerender } = render(
			<ManageMembersSection
				workspaceId={7}
				currentUserId={1}
				currentUserRole="owner"
				onMembersChanged={onMembersChanged}
				showToast={showToast}
			/>,
		);
		await waitFor(() => {
			expect(screen.getByText("Admin User")).toBeTruthy();
		});
		fireEvent.click(screen.getAllByRole("button", { name: "Make owner" })[0]!);
		fireEvent.click(
			within(
				screen.getByRole("dialog", {
					name: /Transfer ownership to Admin User\?/,
				}),
			).getByRole("button", { name: "Confirm transfer" }),
		);
		await waitFor(() => {
			expect(onMembersChanged).toHaveBeenCalled();
		});

		// Simulate a failed reloadWorkspaces(): the parent re-renders with the
		// same stale "owner" role prop and the section must not leak the
		// owner-only controls back.
		rerender(
			<ManageMembersSection
				workspaceId={7}
				currentUserId={1}
				currentUserRole="owner"
				onMembersChanged={onMembersChanged}
				showToast={showToast}
			/>,
		);
		expect(screen.queryByRole("button", { name: "Make owner" })).toBeNull();
		expect(screen.queryByRole("combobox")).toBeNull();
	});

	it("restores role controls when switching to another workspace after a transfer", async () => {
		const onMembersChanged = vi.fn();
		const { rerender } = render(
			<ManageMembersSection
				workspaceId={7}
				currentUserId={1}
				currentUserRole="owner"
				onMembersChanged={onMembersChanged}
				showToast={showToast}
			/>,
		);
		await waitFor(() => {
			expect(screen.getByText("Admin User")).toBeTruthy();
		});
		fireEvent.click(screen.getAllByRole("button", { name: "Make owner" })[0]!);
		fireEvent.click(
			within(
				screen.getByRole("dialog", {
					name: /Transfer ownership to Admin User\?/,
				}),
			).getByRole("button", { name: "Confirm transfer" }),
		);
		await waitFor(() => {
			expect(onMembersChanged).toHaveBeenCalled();
		});

		// The user switches to a different workspace they still own: the local
		// demotion must not leak into it.
		rerender(
			<ManageMembersSection
				workspaceId={8}
				currentUserId={1}
				currentUserRole="owner"
				onMembersChanged={onMembersChanged}
				showToast={showToast}
			/>,
		);
		await waitFor(() => {
			expect(screen.getByText("Admin User")).toBeTruthy();
		});
		expect(screen.getAllByRole("button", { name: "Make owner" }).length).toBe(
			2,
		);
		expect(screen.getAllByRole("combobox").length).toBe(2);
	});
});
