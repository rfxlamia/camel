import { afterEach, beforeEach, describe, expect, it } from "vitest";

const shouldRun = !!process.env.RUN_LLM_IT;

// Lazy imports — only loaded when the integration test gate passes
// to avoid config.ts process.exit(1) when env vars are missing.
let rotateSessionToken: typeof import("../auth")["rotateSessionToken"];
let pool: typeof import("../db/pool")["pool"];

if (shouldRun) {
	const authMod = await import("../auth");
	rotateSessionToken = authMod.rotateSessionToken;
	const poolMod = await import("../db/pool");
	pool = poolMod.pool;
}

describe.skipIf(!shouldRun)("Session token rotation", () => {
	beforeEach(async () => {
		await pool.query(
			"DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)",
			["test_%"],
		);
		await pool.query("DELETE FROM users WHERE username LIKE $1", ["test_%"]);
	});

	afterEach(async () => {
		await pool.query(
			"DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)",
			["test_%"],
		);
		await pool.query("DELETE FROM users WHERE username LIKE $1", ["test_%"]);
	});

	it("rotates a session token and invalidates the old one", async () => {
		const { rows: u } = await pool.query(
			`INSERT INTO users (username, display_name, password_hash)
       VALUES ($1, $2, $3) RETURNING id`,
			["test_user", "Test User", "hashed_password"],
		);
		const userId = u[0].id;

		await pool.query(
			`INSERT INTO sessions (token, user_id, expires_at)
       VALUES ($1, $2, now() + interval '30 days')`,
			["initial_token", userId],
		);

		const newToken = await rotateSessionToken(userId, "initial_token");
		expect(newToken).not.toBeNull();

		const fresh = await pool.query(
			"SELECT user_id FROM sessions WHERE token = $1",
			[newToken],
		);
		expect(fresh.rows.length).toBe(1);
		expect(fresh.rows[0].user_id).toBe(userId);

		const old = await pool.query("SELECT 1 FROM sessions WHERE token = $1", [
			"initial_token",
		]);
		expect(old.rows.length).toBe(0);
	});

	it("does NOT affect the user's other sessions", async () => {
		const { rows: u } = await pool.query(
			`INSERT INTO users (username, display_name, password_hash)
       VALUES ($1, $2, $3) RETURNING id`,
			["test_multi", "Test Multi", "hashed_password"],
		);
		const userId = u[0].id;
		for (const t of ["dev_a", "dev_b", "dev_c"]) {
			await pool.query(
				`INSERT INTO sessions (token, user_id, expires_at)
         VALUES ($1, $2, now() + interval '30 days')`,
				[t, userId],
			);
		}

		const newToken = await rotateSessionToken(userId, "dev_b");
		expect(newToken).not.toBeNull();

		const { rows } = await pool.query(
			"SELECT token FROM sessions WHERE user_id = $1",
			[userId],
		);
		const tokens = rows.map((r) => r.token);
		expect(tokens).toContain("dev_a");
		expect(tokens).toContain("dev_c");
		expect(tokens).not.toContain("dev_b");
		expect(tokens).toContain(newToken as string);
		expect(tokens.length).toBe(3);
	});

	it("returns null for a non-existent session", async () => {
		const result = await rotateSessionToken(99999, "non_existent_token");
		expect(result).toBeNull();
	});
});
