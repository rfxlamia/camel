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

vi.mock("../../api", () => ({
	api: {
		getWorkspaceMembers: (...a: unknown[]) => getWorkspaceMembers(...a),
		removeWorkspaceMember: (...a: unknown[]) => removeWorkspaceMember(...a),
		updateWorkspaceMemberRole: (...a: unknown[]) =>
			updateWorkspaceMemberRole(...a),
	},
	ApiError: class ApiError extends Error {
		status: number;
		constructor(message: string, status: number) {
			super(message);
			this.status = status;
		}
	},
}));

import ManageMembersSection from "./ManageMembersSection";
import { ApiError } from "../../api";

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
		fireEvent.change(
			screen.getByLabelText("Role for Member User"),
			{ target: { value: "admin" } },
		);
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
		fireEvent.change(
			screen.getByLabelText("Role for Member User"),
			{ target: { value: "admin" } },
		);
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
			expect(showToast).toHaveBeenCalledWith(
				"Cannot remove yourself",
				"error",
			);
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
