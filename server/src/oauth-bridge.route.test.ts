import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockGetSession, mockPool, mockMintSession, mockPoolClient } =
	vi.hoisted(() => {
		const mockPoolClient = { query: vi.fn(), release: vi.fn() };
		return {
			mockGetSession: vi.fn(),
			mockPool: {
				query: vi.fn(),
				connect: vi.fn(() => Promise.resolve(mockPoolClient)),
			},
			mockMintSession: vi.fn(),
			mockPoolClient,
		};
	});

vi.mock("better-auth", () => ({
	betterAuth: vi.fn(() => ({
		api: { getSession: mockGetSession },
	})),
}));

vi.mock("better-auth/node", () => ({
	toNodeHandler: vi.fn(() => vi.fn()),
	fromNodeHeaders: vi.fn((h: unknown) => h),
}));

vi.mock("./db/pool.js", () => ({ pool: mockPool }));

vi.mock("./config.js", () => ({
	config: {
		CLIENT_URL: "http://localhost:5173",
		BETTER_AUTH_SECRET: "test-secret",
		APP_BASE_URL: "http://localhost:3001",
		OAUTH_ENABLED: "true",
		GOOGLE_CLIENT_ID: undefined,
		GOOGLE_CLIENT_SECRET: undefined,
		GITHUB_CLIENT_ID: undefined,
		GITHUB_CLIENT_SECRET: undefined,
	},
}));

vi.mock("./auth.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./auth.js")>();
	return { ...actual, mintCamelSession: mockMintSession };
});

import { createOAuthBridgeRouter } from "./oauth-bridge.js";

const SESSION_COOKIE = "camel_session";
const CLIENT_URL = "http://localhost:5173";

function createApp() {
	const app = express();
	app.use(cookieParser());
	app.use("/api/auth", createOAuthBridgeRouter());
	return app;
}

describe("GET /api/auth/complete-oauth", () => {
	let app: ReturnType<typeof createApp>;

	beforeEach(() => {
		vi.clearAllMocks();
		app = createApp();
	});

	afterEach(() => vi.clearAllMocks());

	it("existing password user (has username) linking OAuth: transfers BA account, sets email, redirects to main app", async () => {
		// Better Auth created orphan user id=99 (no username, fresh OAuth)
		mockGetSession.mockResolvedValueOnce({ user: { id: "99" } });

		// All queries inside the if (oldToken) block are now transactional (poolClient.query):
		// BEGIN → session lookup → username check → SELECT email → UPDATE ba_accounts → DELETE orphan → UPDATE email → COMMIT
		mockPoolClient.query
			.mockResolvedValueOnce(undefined) // BEGIN
			.mockResolvedValueOnce({ rows: [{ user_id: 42 }] }) // session lookup
			.mockResolvedValueOnce({ rows: [{ username: "john" }] }) // username check
			.mockResolvedValueOnce({
				rows: [{ email: "john@gmail.com", email_verified: true }],
			}) // SELECT email from baUser
			.mockResolvedValueOnce(undefined) // UPDATE ba_accounts SET user_id
			.mockResolvedValueOnce(undefined) // DELETE FROM users (orphan)
			.mockResolvedValueOnce(undefined) // UPDATE users SET email (on oldUser)
			.mockResolvedValueOnce(undefined); // COMMIT

		const res = await request(app)
			.get("/api/auth/complete-oauth")
			.set("Cookie", `${SESSION_COOKIE}=old-valid-token`);

		expect(res.status).toBe(302);
		expect(res.headers.location).toBe(CLIENT_URL);
		// Session minted for the EXISTING user (42), not the orphan (99)
		expect(mockMintSession).toHaveBeenCalledWith(expect.anything(), 42);
		// Old session must NOT be deleted (it belongs to the legitimate user)
		const deleteCalls = (
			mockPoolClient.query as ReturnType<typeof vi.fn>
		).mock.calls.filter(
			(c: unknown[]) =>
				typeof c[0] === "string" && c[0].includes("DELETE FROM sessions"),
		);
		expect(deleteCalls).toHaveLength(0);
		expect(mockPoolClient.release).toHaveBeenCalledOnce();
	});

	it("true link collision (old user has NO username): orphans old session, redirects to pick-username", async () => {
		mockGetSession.mockResolvedValueOnce({ user: { id: "55" } });

		// All queries inside the if (oldToken) block are now transactional:
		// BEGIN → session lookup → username check → DELETE sessions → INSERT auth_audit → COMMIT
		// Then non-transactional: SELECT username for baUser
		mockPoolClient.query
			.mockResolvedValueOnce(undefined) // BEGIN
			.mockResolvedValueOnce({ rows: [{ user_id: 77 }] }) // session lookup
			.mockResolvedValueOnce({ rows: [{ username: null }] }) // username check
			.mockResolvedValueOnce(undefined) // DELETE sessions
			.mockResolvedValueOnce(undefined) // INSERT auth_audit
			.mockResolvedValueOnce(undefined); // COMMIT

		mockPool.query.mockResolvedValueOnce({ rows: [{ username: null }] }); // baUser username

		const res = await request(app)
			.get("/api/auth/complete-oauth")
			.set("Cookie", `${SESSION_COOKIE}=other-token`);

		expect(res.status).toBe(302);
		expect(res.headers.location).toBe(`${CLIENT_URL}/?oauth=pick-username`);
		expect(mockMintSession).toHaveBeenCalledWith(expect.anything(), 55);
	});

	it("no existing session: new OAuth user redirects to pick-username", async () => {
		mockGetSession.mockResolvedValueOnce({ user: { id: "10" } });

		// No old session cookie — only mintCamelSession + username check
		mockPool.query.mockResolvedValueOnce({ rows: [{ username: null }] }); // baUser username

		const res = await request(app).get("/api/auth/complete-oauth");

		expect(res.status).toBe(302);
		expect(res.headers.location).toBe(`${CLIENT_URL}/?oauth=pick-username`);
		expect(mockMintSession).toHaveBeenCalledWith(expect.anything(), 10);
	});

	it("no Better Auth session: redirects to oauth_error=cancelled", async () => {
		mockGetSession.mockResolvedValueOnce(null);

		const res = await request(app).get("/api/auth/complete-oauth");

		expect(res.status).toBe(302);
		expect(res.headers.location).toBe(`${CLIENT_URL}/?oauth_error=cancelled`);
		expect(mockMintSession).not.toHaveBeenCalled();
	});
});
