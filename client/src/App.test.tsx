// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock lottie-web before lottie-react can import it (prevents module-level canvas code)
vi.mock("lottie-web", () => ({ default: { loadAnimation: vi.fn() } }));
vi.mock("lottie-react", () => ({
	default: (props: Record<string, unknown>) => (
		<div data-testid="lottie" {...(props as Record<string, unknown>)} />
	),
}));

// Mock api module — api.me() rejects by default (simulates 401 / no session)
const mockMe = vi.fn().mockRejectedValue(new Error("unauthorized"));
vi.mock("../api", () => ({
	api: {
		me: (...a: unknown[]) => mockMe(...a),
		login: vi.fn(),
		startOAuth: vi.fn(),
	},
	ApiError: class ApiError extends Error {
		status: number;
		constructor(status: number) {
			super("api error");
			this.status = status;
		}
	},
}));

// Must import App after the mock is wired up.
import App from "./App";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

describe("App — oauth_error wiring", () => {
	it("shows 'Login cancelled' in AuthPage when oauth_error=cancelled and api.me() rejects (401)", async () => {
		// Simulate the browser arriving with ?oauth_error=cancelled
		Object.defineProperty(window, "location", {
			value: new URL("http://localhost/?oauth_error=cancelled"),
			writable: true,
		});

		render(<App />);

		// Wait for authChecked to flip (api.me() rejects → .finally sets authChecked)
		// AuthPage renders <h1>Welcome back</h1> in login mode when user is null
		await waitFor(() => {
			expect(
				screen.getByRole("heading", { name: "Welcome back" }),
			).toBeTruthy();
		});

		// AuthPage should have received oauthError="cancelled" and render the message
		expect(screen.getByText(/login cancelled — try again/i)).toBeTruthy();
	});

	it("renders the landing page (not the auth form) at / when logged out and no oauth_error", async () => {
		Object.defineProperty(window, "location", {
			value: new URL("http://localhost/"),
			writable: true,
		});

		render(<App />);

		// Logged-out visitors land on the marketing page, not the sign-in form.
		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: /create your board/i }),
			).toBeTruthy();
		});

		// Auth form is gated behind the CTAs, so it should not be on screen yet.
		expect(screen.queryByRole("heading", { name: "Welcome back" })).toBeNull();
		expect(screen.queryByText(/login cancelled/i)).toBeNull();
	});
});
