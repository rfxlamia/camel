// Route + DB integration test for POST /auth/change-password.
//
// Proves the real session semantics against a running PostgreSQL: the presented
// session stays valid after the change, every other session is revoked (401),
// the password hash actually changes, wrong current passwords are rejected, and
// repeated failures lock the user out and kill the presented session.
//
// Requires a running PostgreSQL instance. Gated behind RUN_INTEGRATION=1.
// Run:
//   RUN_INTEGRATION=1 npx vitest run src/modules/auth/change-password.integration.test.ts
import "dotenv/config";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

// Keep the per-user failure tracking deterministic: no Redis, in-memory
// fallback only (same fail-closed code path a Redis-less deploy takes).
vi.mock("../../db/redis.js", () => ({
	getRedisClient: vi.fn(() => undefined),
	connectRedis: vi.fn(),
}));

import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { SESSION_COOKIE } from "../../auth.js";
import { pool } from "../../db/pool.js";
import { clearPasswordChangeFailures } from "./login-limiter.js";
import { createAuthRouter } from "./router.js";

const RUN = Date.now();
const CURRENT_PASSWORD = "current-password";
const NEW_PASSWORD = "new-password-123";

let userId: number;
let tokenA: string;
let tokenB: string;

const app = express()
	.use(express.json())
	.use(cookieParser())
	.use("/api/auth", createAuthRouter());

async function seedUser(): Promise<number> {
	const hash = await bcrypt.hash(CURRENT_PASSWORD, 4);
	const row = await pool.query(
		`INSERT INTO users (username, display_name, password_hash)
     VALUES ($1, 'Change Password IT', $2)
     RETURNING id`,
		[`cpw-user-${RUN}`, hash],
	);
	return row.rows[0].id;
}

async function insertSession(token: string): Promise<void> {
	await pool.query(
		`INSERT INTO sessions (token, user_id, expires_at)
     VALUES ($1, $2, now() + interval '1 day')`,
		[token, userId],
	);
}

async function sessionExists(token: string): Promise<boolean> {
	const row = await pool.query("SELECT 1 FROM sessions WHERE token = $1", [
		token,
	]);
	return row.rowCount === 1;
}

async function storedHash(): Promise<string> {
	const row = await pool.query(
		"SELECT password_hash FROM users WHERE id = $1",
		[userId],
	);
	return row.rows[0].password_hash;
}

function change(body: Record<string, unknown>, token: string) {
	return request(app)
		.post("/api/auth/change-password")
		.set("Cookie", `${SESSION_COOKIE}=${token}`)
		.send(body);
}

function me(token: string) {
	return request(app)
		.get("/api/auth/me")
		.set("Cookie", `${SESSION_COOKIE}=${token}`);
}

beforeEach(async () => {
	userId = await seedUser();
	tokenA = `cpw-a-${RUN}-${Math.random().toString(36).slice(2)}`;
	tokenB = `cpw-b-${RUN}-${Math.random().toString(36).slice(2)}`;
	await insertSession(tokenA);
	await insertSession(tokenB);
});

afterEach(async () => {
	await clearPasswordChangeFailures(userId);
	await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
	await pool.query("DELETE FROM auth_audit WHERE actor_id = $1", [userId]);
	await pool.query("DELETE FROM users WHERE id = $1", [userId]);
});

afterAll(async () => {
	await pool.end();
});

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"POST /api/auth/change-password (integration)",
	() => {
		it("changes the hash, keeps the presented session, revokes the other one", async () => {
			const res = await change(
				{ currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD },
				tokenA,
			);

			expect(res.status).toBe(200);
			expect(res.body).toEqual({ ok: true });

			const hash = await storedHash();
			expect(await bcrypt.compare(NEW_PASSWORD, hash)).toBe(true);
			expect(await bcrypt.compare(CURRENT_PASSWORD, hash)).toBe(false);

			expect(await sessionExists(tokenA)).toBe(true);
			expect(await sessionExists(tokenB)).toBe(false);

			expect((await me(tokenA)).status).toBe(200);
			expect((await me(tokenB)).status).toBe(401);

			const audit = await pool.query(
				"SELECT event_type FROM auth_audit WHERE actor_id = $1",
				[userId],
			);
			expect(audit.rows.map((r) => r.event_type)).toContain("password_changed");
		});

		it("rejects a wrong current password with 403 and leaves the hash untouched", async () => {
			const res = await change(
				{ currentPassword: "totally-wrong", newPassword: NEW_PASSWORD },
				tokenA,
			);

			expect(res.status).toBe(403);
			expect(res.body).toEqual({ error: "Current password is incorrect." });
			const hash = await storedHash();
			expect(await bcrypt.compare(CURRENT_PASSWORD, hash)).toBe(true);
			expect(await bcrypt.compare(NEW_PASSWORD, hash)).toBe(false);
			expect(await sessionExists(tokenA)).toBe(true);
			expect(await sessionExists(tokenB)).toBe(true);
		});

		it("rejects a new password equal to the current one with 400", async () => {
			const res = await change(
				{ currentPassword: CURRENT_PASSWORD, newPassword: CURRENT_PASSWORD },
				tokenA,
			);

			expect(res.status).toBe(400);
			expect(res.body).toEqual({
				error: "New password must be different from the current password.",
			});
		});

		it("locks out after repeated failures and kills the presented session", async () => {
			const statuses: number[] = [];
			for (let i = 0; i < 6; i++) {
				const res = await change(
					{ currentPassword: "totally-wrong", newPassword: NEW_PASSWORD },
					tokenA,
				);
				statuses.push(res.status);
			}

			expect(statuses).toEqual([403, 403, 403, 403, 403, 429]);
			// The guessing cookie is gone; the user's other session survives.
			expect(await sessionExists(tokenA)).toBe(false);
			expect(await sessionExists(tokenB)).toBe(true);

			// Even the correct current password is now refused while locked out.
			const res = await change(
				{ currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD },
				tokenB,
			);
			expect(res.status).toBe(429);
			expect(await sessionExists(tokenB)).toBe(false);
		});
	},
);
