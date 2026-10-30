import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cancelWorkspaceInvite = vi.fn();

vi.mock("../../api", () => ({
	api: {
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

const showToast = vi.fn();

vi.mock("../../shared/ToastContext", () => ({
	useShowToast: () => showToast,
}));

import { ApiError } from "../../api";
import PendingInvitesSection from "./PendingInvitesSection";

const invites = [
	{ id: 3, username: "bob", role: "member" },
	{ id: 4, username: "carol", role: "admin" },
];

const onCancelled = vi.fn();

beforeEach(() => {
	cancelWorkspaceInvite.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("PendingInvitesSection", () => {
	it("lists pending invites with their roles", () => {
		render(
			<PendingInvitesSection
				workspaceId={7}
				invites={invites}
				onCancelled={onCancelled}
				showToast={showToast}
			/>,
		);

		expect(screen.getByText("Pending invites")).toBeTruthy();
		expect(screen.getByText("@bob")).toBeTruthy();
		expect(screen.getByText("@carol")).toBeTruthy();
	});

	it("cancels an invite and reports it via onCancelled", async () => {
		render(
			<PendingInvitesSection
				workspaceId={7}
				invites={invites}
				onCancelled={onCancelled}
				showToast={showToast}
			/>,
		);

		fireEvent.click(screen.getAllByRole("button", { name: /cancel/i })[0]!);

		await waitFor(() => {
			expect(cancelWorkspaceInvite).toHaveBeenCalledWith(7, 3);
		});
		await waitFor(() => {
			expect(onCancelled).toHaveBeenCalledWith(3);
		});
		expect(showToast).toHaveBeenCalledWith("Invite cancelled", "success");
	});

	it("shows the server error when cancelling fails", async () => {
		cancelWorkspaceInvite.mockRejectedValue(
			new ApiError("Invite is already gone", 404),
		);

		render(
			<PendingInvitesSection
				workspaceId={7}
				invites={invites}
				onCancelled={onCancelled}
				showToast={showToast}
			/>,
		);

		fireEvent.click(screen.getAllByRole("button", { name: /cancel/i })[0]!);

		await waitFor(() => {
			expect(showToast).toHaveBeenCalledWith("Invite is already gone", "error");
		});
		expect(onCancelled).not.toHaveBeenCalled();
	});
});
