// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockStartOAuth = vi.fn();
vi.mock("../api", () => ({
	api: {
		login: vi.fn(),
		startOAuth: (...a: unknown[]) => mockStartOAuth(...a),
	},
	ApiError: class ApiError extends Error {
		status: number;
		constructor(status: number) {
			super("api error");
			this.status = status;
		}
	},
}));

import AuthPage from "./AuthPage";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("AuthPage — OAuth buttons", () => {
	it("renders 'Sign in with Google' and 'Sign in with GitHub' buttons", () => {
		render(<AuthPage onAuth={vi.fn()} />);
		expect(
			screen.getByRole("button", { name: /sign in with google/i }),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: /sign in with github/i }),
		).toBeTruthy();
	});

	it("calls api.startOAuth('google') when Sign in with Google is clicked", () => {
		render(<AuthPage onAuth={vi.fn()} />);
		fireEvent.click(
			screen.getByRole("button", { name: /sign in with google/i }),
		);
		expect(mockStartOAuth).toHaveBeenCalledWith("google");
	});

	it("calls api.startOAuth('github') when Sign in with GitHub is clicked", () => {
		render(<AuthPage onAuth={vi.fn()} />);
		fireEvent.click(
			screen.getByRole("button", { name: /sign in with github/i }),
		);
		expect(mockStartOAuth).toHaveBeenCalledWith("github");
	});

	it("shows 'Login cancelled' message when oauthError prop is 'cancelled'", () => {
		render(<AuthPage onAuth={vi.fn()} oauthError="cancelled" />);
		expect(screen.getByText(/login cancelled/i)).toBeTruthy();
	});
});
