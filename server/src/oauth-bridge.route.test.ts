/**
 * Integration tests for the /api/auth/complete-oauth bridge route.
 *
 * Requires a running PostgreSQL instance. Gated behind RUN_INTEGRATION=1.
 *
 * Run:
 *   RUN_INTEGRATION=1 npx vitest run src/oauth-bridge.route.test.ts
 */
import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { db } from "./db/kysely.js";

const { mockGetSession, mockMintSession } = vi.hoisted(() => ({
	mockGetSession: vi.fn(),
	mockMintSession: vi.fn(),
}));

vi.mock("better-auth", () => ({
	betterAuth: vi.fn(() => ({
		api: { getSession: mockGetSession },
	})),
}));

vi.mock("better-auth/node", () => ({
	toNodeHandler: vi.fn(() => vi.fn()),
	fromNodeHeaders: vi.fn((h: unknown) => h),
}));

vi.mock("./config.js", () => ({
	config: {
		DATABASE_URL: process.env.DATABASE_URL,
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

const { createOAuthBridgeRouter } = await import("./oauth-bridge.js");

const SESSION_COOKIE = "camel_session";
const CLIENT_URL = "http://localhost:5173";

function createApp() {
	const app = express();
	app.use(cookieParser());
	app.use("/api/auth", createOAuthBridgeRouter());
	return app;
}

async function makeUser(opts: {
	username: string | null;
	email?: string | null;
	emailVerified?: boolean;
}) {
	const user = await db
		.insertInto("users")
		.values({
			username: opts.username,
			display_name: opts.username ?? "OAuth User",
			password_hash: opts.username ? "hashed" : null,
			email: opts.email ?? null,
			email_verified: opts.emailVerified ?? false,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	return user.id;
}

const cleanupUserIds: number[] = [];
const cleanupTokens: string[] = [];

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"GET /api/auth/complete-oauth (real DB)",
	() => {
		let app: ReturnType<typeof createApp>;

		beforeEach(() => {
			vi.clearAllMocks();
			app = createApp();
		});

		afterEach(() => vi.clearAllMocks());

		afterAll(async () => {
			if (cleanupTokens.length > 0) {
				await db
					.deleteFrom("sessions")
					.where("token", "in", cleanupTokens)
					.execute();
			}
			if (cleanupUserIds.length > 0) {
				await db
					.deleteFrom("users")
					.where("id", "in", cleanupUserIds)
					.execute();
			}
		});

		it("existing password user (has username) linking OAuth: transfers BA account, sets email, redirects to main app", async () => {
			const uniqueSuffix = Date.now();
			const username = `john-${uniqueSuffix}`;
			const email = `john-${uniqueSuffix}@gmail.com`;
			const accountId = `gh-${uniqueSuffix}`;

			const oldUserId = await makeUser({ username, email: null });
			const baUserId = await makeUser({
				username: null,
				email,
				emailVerified: true,
			});
			cleanupUserIds.push(oldUserId, baUserId);

			const token = `old-valid-token-${uniqueSuffix}`;
			cleanupTokens.push(token);
			await db
				.insertInto("sessions")
				.values({
					token,
					user_id: oldUserId,
					expires_at: new Date(Date.now() + 3_600_000),
				})
				.execute();
			await db
				.insertInto("ba_accounts")
				.values({
					id: `acct-${uniqueSuffix}`,
					account_id: accountId,
					provider_id: "github",
					user_id: baUserId,
				})
				.execute();

			mockGetSession.mockResolvedValueOnce({ user: { id: String(baUserId) } });

			const res = await request(app)
				.get("/api/auth/complete-oauth")
				.set("Cookie", `${SESSION_COOKIE}=${token}`);

			expect(res.status).toBe(302);
			expect(res.headers.location).toBe(CLIENT_URL);
			// Session minted for the EXISTING user, not the orphan
			expect(mockMintSession).toHaveBeenCalledWith(
				expect.anything(),
				oldUserId,
			);

			// Old session must NOT be deleted (it belongs to the legitimate user)
			const session = await db
				.selectFrom("sessions")
				.select("user_id")
				.where("token", "=", token)
				.executeTakeFirst();
			expect(session?.user_id).toBe(oldUserId);

			// Orphan BA user deleted, ba_accounts transferred, email set on old user
			const orphan = await db
				.selectFrom("users")
				.select("id")
				.where("id", "=", baUserId)
				.executeTakeFirst();
			expect(orphan).toBeUndefined();

			const account = await db
				.selectFrom("ba_accounts")
				.select("user_id")
				.where("account_id", "=", accountId)
				.executeTakeFirst();
			expect(account?.user_id).toBe(oldUserId);

			const oldUser = await db
				.selectFrom("users")
				.select(["email", "email_verified"])
				.where("id", "=", oldUserId)
				.executeTakeFirstOrThrow();
			expect(oldUser.email).toBe(email);
			expect(oldUser.email_verified).toBe(true);
		});

		it("true link collision (old user has NO username): orphans old session, redirects to pick-username", async () => {
			const oldUserId = await makeUser({ username: null });
			const baUserId = await makeUser({ username: null });
			cleanupUserIds.push(oldUserId, baUserId);

			const token = `other-token-${Date.now()}`;
			cleanupTokens.push(token);
			await db
				.insertInto("sessions")
				.values({
					token,
					user_id: oldUserId,
					expires_at: new Date(Date.now() + 3_600_000),
				})
				.execute();

			mockGetSession.mockResolvedValueOnce({ user: { id: String(baUserId) } });

			const res = await request(app)
				.get("/api/auth/complete-oauth")
				.set("Cookie", `${SESSION_COOKIE}=${token}`);

			expect(res.status).toBe(302);
			expect(res.headers.location).toBe(`${CLIENT_URL}/?oauth=pick-username`);
			expect(mockMintSession).toHaveBeenCalledWith(expect.anything(), baUserId);

			const session = await db
				.selectFrom("sessions")
				.select("token")
				.where("token", "=", token)
				.executeTakeFirst();
			expect(session).toBeUndefined();

			const audit = await db
				.selectFrom("auth_audit")
				.select(["actor_id", "event_type"])
				.where("actor_id", "=", oldUserId)
				.where("event_type", "=", "account_orphaned")
				.executeTakeFirst();
			expect(audit).toBeDefined();
		});

		it("no existing session: new OAuth user redirects to pick-username", async () => {
			const baUserId = await makeUser({ username: null });
			cleanupUserIds.push(baUserId);

			mockGetSession.mockResolvedValueOnce({ user: { id: String(baUserId) } });

			const res = await request(app).get("/api/auth/complete-oauth");

			expect(res.status).toBe(302);
			expect(res.headers.location).toBe(`${CLIENT_URL}/?oauth=pick-username`);
			expect(mockMintSession).toHaveBeenCalledWith(expect.anything(), baUserId);
		});

		it("no Better Auth session: redirects to oauth_error=cancelled", async () => {
			mockGetSession.mockResolvedValueOnce(null);

			const res = await request(app).get("/api/auth/complete-oauth");

			expect(res.status).toBe(302);
			expect(res.headers.location).toBe(`${CLIENT_URL}/?oauth_error=cancelled`);
			expect(mockMintSession).not.toHaveBeenCalled();
		});
	},
);
