/**
 * Integration tests for the OAuth set-username / set-password routes.
 *
 * Requires a running PostgreSQL instance. Gated behind RUN_INTEGRATION=1.
 *
 * Run:
 *   RUN_INTEGRATION=1 npx vitest run src/routes/oauth.test.ts
 */
import "dotenv/config";
import express from "express";
import request from "supertest";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { db } from "../db/kysely.js";

const testUser: {
	id: number;
	username: string | null;
	displayName: string;
	email: string;
	emailVerified: boolean;
	needsUsername: boolean;
} = {
	id: 0,
	username: null,
	displayName: "Ana",
	email: "ana@gmail.com",
	emailVerified: true,
	needsUsername: true,
};

vi.mock("../auth.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../auth.js")>();
	return {
		...actual,
		requireAuth: (req: any, _res: any, next: any) => {
			req.user = { ...testUser };
			next();
		},
	};
});

vi.mock("bcryptjs", () => ({
	default: { hash: vi.fn(async () => "hashed_password") },
}));

const { oauthRouter } = await import("../routes/oauth.js");

function createApp() {
	const app = express();
	app.use(express.json());
	app.use("/api/auth", oauthRouter);
	return app;
}
const app = createApp();

describe.skipIf(!process.env.RUN_INTEGRATION)("oauth routes (real DB)", () => {
	beforeAll(async () => {
		const user = await db
			.insertInto("users")
			.values({
				username: null,
				display_name: "Ana",
				password_hash: null,
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		testUser.id = user.id;
	});

	afterAll(async () => {
		await db
			.deleteFrom("workspace_members")
			.where("user_id", "=", testUser.id)
			.execute();
		await db
			.deleteFrom("workspaces")
			.where("owner_user_id", "=", testUser.id)
			.execute();
		await db.deleteFrom("users").where("id", "=", testUser.id).execute();
	});

	describe("POST /api/auth/set-username", () => {
		beforeEach(async () => {
			testUser.username = null;
			await db
				.updateTable("users")
				.set({ username: null, display_name: "Ana" })
				.where("id", "=", testUser.id)
				.execute();
			await db
				.deleteFrom("workspaces")
				.where("owner_user_id", "=", testUser.id)
				.execute();
		});

		it("200 — creates username and workspace when username is null and name is unique", async () => {
			const uniqueUsername = `ana${Date.now()}`;
			const res = await request(app)
				.post("/api/auth/set-username")
				.send({ username: uniqueUsername });

			expect(res.status).toBe(200);
			expect(res.body).toEqual({ ok: true });

			const user = await db
				.selectFrom("users")
				.select(["username", "display_name"])
				.where("id", "=", testUser.id)
				.executeTakeFirstOrThrow();
			expect(user.username).toBe(uniqueUsername);

			const workspace = await db
				.selectFrom("workspaces")
				.selectAll()
				.where("owner_user_id", "=", testUser.id)
				.executeTakeFirst();
			expect(workspace).toBeDefined();
			expect(workspace?.is_personal).toBe(true);
		});

		it("409 — 'Username already taken' when DB throws unique violation (23505)", async () => {
			const takenUsername = `taken${Date.now()}`;
			await db
				.insertInto("users")
				.values({
					username: takenUsername,
					display_name: "Someone Else",
					password_hash: "hashed",
				})
				.execute();

			const res = await request(app)
				.post("/api/auth/set-username")
				.send({ username: takenUsername });

			expect(res.status).toBe(409);
			expect(res.body.error).toMatch(/username already taken/i);

			await db
				.deleteFrom("users")
				.where("username", "=", takenUsername)
				.execute();
		});

		it("400 — validation error when username is shorter than 3 characters", async () => {
			const res = await request(app)
				.post("/api/auth/set-username")
				.send({ username: "ab" });

			expect(res.status).toBe(400);
			expect(res.body.error).toMatch(/3/);
		});

		it("409 — 'Username already set' when req.user.username is not null", async () => {
			testUser.username = "existing_name";

			const res = await request(app)
				.post("/api/auth/set-username")
				.send({ username: "newname" });

			expect(res.status).toBe(409);
			expect(res.body.error).toMatch(/username already set/i);
		});

		it("does not double-create a workspace when username is set concurrently (TOCTOU)", async () => {
			// req.user.username is still null (stale session snapshot) — a
			// concurrent request already won the race and set the username in
			// the DB. The transaction's write must be conditional on the DB
			// state, not just the precheck, or this request would overwrite
			// the winner's username and insert a second personal workspace.
			const raceUsername = `race${Date.now()}`;
			await db
				.updateTable("users")
				.set({ username: raceUsername, display_name: "Racer" })
				.where("id", "=", testUser.id)
				.execute();

			const res = await request(app)
				.post("/api/auth/set-username")
				.send({ username: "loser_name" });

			expect(res.status).toBe(409);

			const workspaces = await db
				.selectFrom("workspaces")
				.selectAll()
				.where("owner_user_id", "=", testUser.id)
				.execute();
			expect(workspaces).toHaveLength(0);

			const user = await db
				.selectFrom("users")
				.select("username")
				.where("id", "=", testUser.id)
				.executeTakeFirstOrThrow();
			expect(user.username).toBe(raceUsername);
		});
	});

	describe("POST /api/auth/set-password", () => {
		beforeEach(async () => {
			testUser.username = "ana";
		});

		it("200 — sets password_hash when password_hash is currently null", async () => {
			await db
				.updateTable("users")
				.set({ password_hash: null })
				.where("id", "=", testUser.id)
				.execute();

			const res = await request(app)
				.post("/api/auth/set-password")
				.send({ password: "secret123" });

			expect(res.status).toBe(200);
			expect(res.body).toEqual({ ok: true });

			const user = await db
				.selectFrom("users")
				.select("password_hash")
				.where("id", "=", testUser.id)
				.executeTakeFirstOrThrow();
			expect(user.password_hash).toBe("hashed_password");
		});

		it("400 — rejects password shorter than 8 characters", async () => {
			const res = await request(app)
				.post("/api/auth/set-password")
				.send({ password: "short" });

			expect(res.status).toBe(400);
			expect(res.body.error).toMatch(/at least 8 characters/i);
		});

		it("409 — 'Password already set' when password_hash is not null", async () => {
			await db
				.updateTable("users")
				.set({ password_hash: "$2a$10$existing_hash" })
				.where("id", "=", testUser.id)
				.execute();

			const res = await request(app)
				.post("/api/auth/set-password")
				.send({ password: "secret123" });

			expect(res.status).toBe(409);
			expect(res.body.error).toMatch(/password already set/i);
		});

		it("does not overwrite a password set concurrently between precheck and update (TOCTOU)", async () => {
			await db
				.updateTable("users")
				.set({ password_hash: null })
				.where("id", "=", testUser.id)
				.execute();

			// A concurrent request wins the race and sets password_hash during
			// this request's bcrypt.hash call — the window between the
			// select precheck and the update.
			const bcrypt = (await import("bcryptjs")).default;
			vi.mocked(bcrypt.hash).mockImplementationOnce(async () => {
				await db
					.updateTable("users")
					.set({ password_hash: "$2a$10$winner_hash" })
					.where("id", "=", testUser.id)
					.execute();
				return "loser_hash";
			});

			const res = await request(app)
				.post("/api/auth/set-password")
				.send({ password: "secret123" });

			expect(res.status).toBe(409);

			const user = await db
				.selectFrom("users")
				.select("password_hash")
				.where("id", "=", testUser.id)
				.executeTakeFirstOrThrow();
			expect(user.password_hash).toBe("$2a$10$winner_hash");
		});
	});
});
