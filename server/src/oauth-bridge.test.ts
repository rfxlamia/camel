import { describe, expect, it, vi } from "vitest";

// ── Module-level mocks (hoisted before any import) ──────────────────────────
vi.mock("better-auth", () => ({
	betterAuth: vi.fn(() => ({
		api: { getSession: vi.fn() },
		handler: vi.fn(),
	})),
}));
vi.mock("better-auth/node", () => ({
	toNodeHandler: vi.fn(() => vi.fn()),
}));
vi.mock("./db/pool.js", () => ({
	pool: { query: vi.fn(), connect: vi.fn() },
}));
vi.mock("./config.js", () => ({
	config: {
		GOOGLE_CLIENT_ID: undefined,
		GOOGLE_CLIENT_SECRET: undefined,
		GITHUB_CLIENT_ID: undefined,
		GITHUB_CLIENT_SECRET: undefined,
		BETTER_AUTH_SECRET: "test-secret",
		APP_BASE_URL: "http://localhost:3001",
		OAUTH_ENABLED: "false",
	},
}));

import { getGitHubPrimaryEmail, isOAuthPendingUser } from "./oauth-bridge.js";

describe("getGitHubPrimaryEmail", () => {
	it("returns null for an empty emails array", () => {
		expect(getGitHubPrimaryEmail([])).toBeNull();
	});

	it("returns the primary verified email when one exists", () => {
		const emails = [
			{ email: "secondary@gh.com", primary: false, verified: true },
			{ email: "primary@gh.com", primary: true, verified: true },
		];
		expect(getGitHubPrimaryEmail(emails)).toBe("primary@gh.com");
	});

	it("returns null when primary email is not verified", () => {
		const emails = [
			{ email: "unverified@gh.com", primary: true, verified: false },
		];
		expect(getGitHubPrimaryEmail(emails)).toBeNull();
	});

	it("returns null when no entry is both primary AND verified", () => {
		const emails = [
			{ email: "a@gh.com", primary: false, verified: true },
			{ email: "b@gh.com", primary: true, verified: false },
		];
		expect(getGitHubPrimaryEmail(emails)).toBeNull();
	});
});

describe("isOAuthPendingUser", () => {
	it("returns true when username is null", () => {
		expect(isOAuthPendingUser(null)).toBe(true);
	});

	it("returns false when username is a non-null string", () => {
		expect(isOAuthPendingUser("ana")).toBe(false);
	});

	it("returns false for an empty string", () => {
		expect(isOAuthPendingUser("")).toBe(false);
	});
});
