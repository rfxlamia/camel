// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockSetUsername = vi.fn();
vi.mock("../api", () => ({
	api: {
		setUsername: (...a: unknown[]) => mockSetUsername(...a),
		me: vi.fn(),
	},
	ApiError: class ApiError extends Error {
		status: number;
		constructor(msg: string, status = 400) {
			super(msg);
			this.status = status;
		}
	},
}));

import PickUsernamePage from "./PickUsernamePage";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("PickUsernamePage", () => {
	it("calls api.setUsername with the submitted username", async () => {
		mockSetUsername.mockResolvedValue({ ok: true });
		const onComplete = vi.fn();

		render(<PickUsernamePage onComplete={onComplete} />);

		const input = screen.getByRole("textbox");
		fireEvent.change(input, { target: { value: "ana" } });
		fireEvent.click(
			screen.getByRole("button", { name: /submit|choose|confirm|continue/i }),
		);

		await waitFor(() => expect(mockSetUsername.mock.calls[0]?.[0]).toBe("ana"));
	});

	it("invokes onComplete callback after api.setUsername resolves ok", async () => {
		const updatedUser = {
			id: 1,
			username: "ana",
			displayName: "Ana",
			emailVerified: true,
			needsUsername: false,
		};
		mockSetUsername.mockResolvedValue({ ok: true });
		const { api } = await import("../api");
		(api.me as ReturnType<typeof vi.fn>).mockResolvedValue({
			user: updatedUser,
		});
		const onComplete = vi.fn();

		render(<PickUsernamePage onComplete={onComplete} />);

		const input = screen.getByRole("textbox");
		fireEvent.change(input, { target: { value: "ana" } });
		fireEvent.click(
			screen.getByRole("button", { name: /submit|choose|confirm|continue/i }),
		);

		await waitFor(() => expect(onComplete).toHaveBeenCalledWith(updatedUser));
	});

	it("shows 'Username already taken' error when api.setUsername rejects with that message", async () => {
		const { ApiError } = await import("../api");
		mockSetUsername.mockRejectedValue(
			new ApiError("Username already taken", 409),
		);
		const onComplete = vi.fn();

		render(<PickUsernamePage onComplete={onComplete} />);

		const input = screen.getByRole("textbox");
		fireEvent.change(input, { target: { value: "budi" } });
		fireEvent.click(
			screen.getByRole("button", { name: /submit|choose|confirm|continue/i }),
		);

		await waitFor(() =>
			expect(screen.getByText(/username already taken/i)).toBeTruthy(),
		);
		expect(onComplete).not.toHaveBeenCalled();
	});
});
