// Integration tests for two auth.ts fixes:
//   1. /login must not crash bcrypt.compare() when password_hash is null
//      (OAuth-only users).
//   2. /register must apply pending workspace_invites, not just fetch them.
//
// Requires a running PostgreSQL instance. Gated behind RUN_INTEGRATION=1.
// Run:
//   RUN_INTEGRATION=1 npx vitest run src/auth.integration.test.ts
import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db/redis.js", () => ({
	getRedisClient: vi.fn(),
	connectRedis: vi.fn(),
}));

import { createAuthRouter } from "./auth.js";
import { pool } from "./db/pool.js";

function createTestApp() {
	const app = express();
	app.use(express.json());
	app.use(cookieParser());
	app.use("/api/auth", createAuthRouter());
	return app;
}

const app = createTestApp();

beforeEach(async () => {
	await pool.query("DELETE FROM users WHERE username LIKE 'test_authit_%'");
	await pool.query("DELETE FROM workspaces WHERE name LIKE 'authit-%'");
	await pool.query(
		"DELETE FROM workspace_invites WHERE username LIKE 'test_authit_%'",
	);
});

afterAll(async () => {
	await pool.query("DELETE FROM users WHERE username LIKE 'test_authit_%'");
	await pool.query("DELETE FROM workspaces WHERE name LIKE 'authit-%'");
	await pool.query(
		"DELETE FROM workspace_invites WHERE username LIKE 'test_authit_%'",
	);
});

describe.skipIf(!process.env.RUN_INTEGRATION)("POST /api/auth/login", () => {
	it("returns 401 (not 500) for an OAuth-only user with no password_hash", async () => {
		await pool.query(
			`INSERT INTO users (username, display_name, password_hash, email, email_verified)
       VALUES ($1, $2, NULL, $3, true)`,
			["test_authit_oauth", "OAuth User", "oauth@example.com"],
		);

		const res = await request(app)
			.post("/api/auth/login")
			.send({ username: "test_authit_oauth", password: "whatever123" });

		expect(res.status).toBe(401);
		expect(res.body.error).toMatch(/wrong username or password/i);
	});
});

describe.skipIf(!process.env.RUN_INTEGRATION)("POST /api/auth/register", () => {
	it("grants membership in an invited workspace and consumes the invite", async () => {
		const owner = await pool.query(
			`INSERT INTO users (username, display_name, password_hash)
         VALUES ($1, $2, $3) RETURNING id`,
			["test_authit_owner", "Owner", "hashed"],
		);
		const ownerId = owner.rows[0].id;

		const ws = await pool.query(
			`INSERT INTO workspaces (name, owner_user_id, is_personal)
         VALUES ($1, $2, false) RETURNING id`,
			["authit-invited-ws", ownerId],
		);
		const wsId = ws.rows[0].id;

		await pool.query(
			`INSERT INTO workspace_invites (workspace_id, username, role)
         VALUES ($1, $2, 'member')`,
			[wsId, "test_authit_invitee"],
		);

		const res = await request(app).post("/api/auth/register").send({
			username: "test_authit_invitee",
			password: "password123",
			displayName: "Invitee",
		});

		expect(res.status).toBe(201);
		const newUserId = res.body.user.id;

		const membership = await pool.query(
			"SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
			[wsId, newUserId],
		);
		expect(membership.rows).toHaveLength(1);
		expect(membership.rows[0].role).toBe("member");

		const remainingInvite = await pool.query(
			"SELECT 1 FROM workspace_invites WHERE workspace_id = $1 AND username = $2",
			[wsId, "test_authit_invitee"],
		);
		expect(remainingInvite.rows).toHaveLength(0);
	});
});
