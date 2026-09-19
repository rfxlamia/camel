// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockStartOAuth = vi.fn();
vi.mock("../api", () => ({
	api: {
		startOAuth: (...a: unknown[]) => mockStartOAuth(...a),
	},
}));

import EmailGatePage from "./EmailGatePage";

const GATED_USER = {
	id: 5,
	username: "lama",
	displayName: "Lama",
	emailVerified: false,
	needsUsername: false,
};

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("EmailGatePage", () => {
	it("renders both Link Google and Link GitHub buttons", () => {
		render(<EmailGatePage user={GATED_USER} onComplete={vi.fn()} />);
		expect(screen.getByRole("button", { name: /link google/i })).toBeTruthy();
		expect(screen.getByRole("button", { name: /link github/i })).toBeTruthy();
	});

	it("calls api.startOAuth('google') when Link Google is clicked", () => {
		render(<EmailGatePage user={GATED_USER} onComplete={vi.fn()} />);
		fireEvent.click(screen.getByRole("button", { name: /link google/i }));
		expect(mockStartOAuth).toHaveBeenCalledWith("google");
	});

	it("calls api.startOAuth('github') when Link GitHub is clicked", () => {
		render(<EmailGatePage user={GATED_USER} onComplete={vi.fn()} />);
		fireEvent.click(screen.getByRole("button", { name: /link github/i }));
		expect(mockStartOAuth).toHaveBeenCalledWith("github");
	});
});
