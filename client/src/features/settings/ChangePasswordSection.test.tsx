import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const changePassword = vi.fn();

vi.mock("../../api", () => ({
	api: {
		changePassword: (...a: unknown[]) => changePassword(...a),
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
import ChangePasswordSection from "./ChangePasswordSection";

beforeEach(() => {
	changePassword.mockResolvedValue({ ok: true });
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function fillPasswords(
	current = "current-pass",
	next = "new-password-123",
	confirm = next,
) {
	fireEvent.change(screen.getByLabelText("Current password"), {
		target: { value: current },
	});
	fireEvent.change(screen.getByLabelText("New password"), {
		target: { value: next },
	});
	fireEvent.change(screen.getByLabelText("Confirm new password"), {
		target: { value: confirm },
	});
}

function submitForm() {
	const form = screen.getByLabelText("Current password").closest("form");
	if (!form) throw new Error("password fields are not wrapped in a form");
	fireEvent.submit(form);
}

function fillAndSubmit(
	current?: string,
	next?: string,
	confirm?: string,
) {
	fillPasswords(current, next, confirm);
	submitForm();
}

describe("ChangePasswordSection", () => {
	it("submits both passwords via the form and toasts on success", async () => {
		render(<ChangePasswordSection />);

		fillAndSubmit();

		await waitFor(() => {
			expect(changePassword).toHaveBeenCalledWith(
				"current-pass",
				"new-password-123",
			);
		});
		await waitFor(() => {
			expect(showToast).toHaveBeenCalledWith("Password changed", "success");
		});
		expect(
			(screen.getByLabelText("Current password") as HTMLInputElement).value,
		).toBe("");
		expect(
			(screen.getByLabelText("Confirm new password") as HTMLInputElement)
				.value,
		).toBe("");
	});

	it("keeps the autocomplete hints for password managers", () => {
		render(<ChangePasswordSection />);

		expect(screen.getByLabelText("Current password")).toHaveAttribute(
			"autoComplete",
			"current-password",
		);
		expect(screen.getByLabelText("New password")).toHaveAttribute(
			"autoComplete",
			"new-password",
		);
		expect(screen.getByLabelText("Confirm new password")).toHaveAttribute(
			"autoComplete",
			"new-password",
		);
	});

	it("disables submission while the new password is shorter than 8 characters", () => {
		render(<ChangePasswordSection />);

		fireEvent.change(screen.getByLabelText("Current password"), {
			target: { value: "current-pass" },
		});
		fireEvent.change(screen.getByLabelText("New password"), {
			target: { value: "short" },
		});

		expect(
			screen.getByRole("button", { name: "Change Password" }),
		).toHaveProperty("disabled", true);
		expect(changePassword).not.toHaveBeenCalled();
	});

	it("rejects a mismatched confirmation without calling the API", async () => {
		render(<ChangePasswordSection />);

		fillAndSubmit("current-pass", "new-password-123", "different-pass");

		await waitFor(() => {
			expect(showToast).toHaveBeenCalledWith("Passwords don't match", "error");
		});
		expect(changePassword).not.toHaveBeenCalled();
	});

	it("surfaces the server error when the current password is wrong", async () => {
		changePassword.mockRejectedValue(
			new ApiError("Current password is incorrect.", 403),
		);

		render(<ChangePasswordSection />);

		fillAndSubmit();

		await waitFor(() => {
			expect(showToast).toHaveBeenCalledWith(
				"Current password is incorrect.",
				"error",
			);
		});
	});
});
