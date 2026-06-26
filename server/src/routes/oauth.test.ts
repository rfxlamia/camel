import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockTestUser, mockClient } = vi.hoisted(() => {
	const mockClient = {
		query: vi.fn(),
		release: vi.fn(),
	};
	return {
		mockTestUser: {
			id: 42,
			username: null as string | null,
			displayName: "Ana",
			email: "ana@gmail.com",
			emailVerified: true,
			needsUsername: true,
		},
		mockClient,
	};
});

vi.mock("../db/pool.js", () => ({
	pool: {
		query: vi.fn(),
		connect: vi.fn(() => Promise.resolve(mockClient)),
	},
}));

vi.mock("../auth.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../auth.js")>();
	return {
		...actual,
		requireAuth: (req: any, _res: any, next: any) => {
			req.user = { ...mockTestUser };
			next();
		},
	};
});

vi.mock("bcryptjs", () => ({
	default: { hash: vi.fn(async () => "hashed_password") },
}));

import { pool } from "../db/pool.js";
import { oauthRouter } from "../routes/oauth.js";

function createApp() {
	const app = express();
	app.use(express.json());
	app.use("/api/auth", oauthRouter);
	return app;
}
const app = createApp();

function setupSuccessfulSetUsernameClient() {
	mockClient.query
		.mockResolvedValueOnce(undefined) // BEGIN
		.mockResolvedValueOnce(undefined) // UPDATE users SET username
		.mockResolvedValueOnce({ rows: [] }) // SELECT workspace_invites (no pending)
		.mockResolvedValueOnce({ rows: [{ id: 99 }] }) // INSERT workspaces RETURNING id
		.mockResolvedValueOnce(undefined) // INSERT workspace_members
		.mockResolvedValueOnce(undefined); // COMMIT
}

describe("POST /api/auth/set-username", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockTestUser.username = null;
	});
	afterEach(() => vi.clearAllMocks());

	it("200 — creates username and workspace when username is null and name is unique", async () => {
		setupSuccessfulSetUsernameClient();

		const res = await request(app)
			.post("/api/auth/set-username")
			.send({ username: "ana" });

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ ok: true });
		expect(mockClient.query).toHaveBeenCalledTimes(6);
		expect(mockClient.release).toHaveBeenCalledOnce();
	});

	it("409 — 'Username already taken' when DB throws unique violation (23505)", async () => {
		mockClient.query
			.mockResolvedValueOnce(undefined) // BEGIN
			.mockRejectedValueOnce({ code: "23505" }); // UPDATE throws unique violation

		const res = await request(app)
			.post("/api/auth/set-username")
			.send({ username: "budi" });

		expect(res.status).toBe(409);
		expect(res.body.error).toMatch(/username already taken/i);
		expect(mockClient.release).toHaveBeenCalledOnce();
	});

	it("400 — validation error when username is shorter than 3 characters", async () => {
		const res = await request(app)
			.post("/api/auth/set-username")
			.send({ username: "ab" });

		expect(res.status).toBe(400);
		expect(res.body.error).toMatch(/3/);
		expect(mockClient.query).not.toHaveBeenCalled();
	});

	it("409 — 'Username already set' when req.user.username is not null", async () => {
		mockTestUser.username = "existing_name";

		const res = await request(app)
			.post("/api/auth/set-username")
			.send({ username: "newname" });

		expect(res.status).toBe(409);
		expect(res.body.error).toMatch(/username already set/i);
		expect(mockClient.query).not.toHaveBeenCalled();
	});
});

describe("POST /api/auth/set-password", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockTestUser.username = "ana";
	});
	afterEach(() => vi.clearAllMocks());

	it("200 — sets password_hash when password_hash is currently null", async () => {
		(pool.query as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ rows: [{ password_hash: null }] })
			.mockResolvedValueOnce(undefined);

		const res = await request(app)
			.post("/api/auth/set-password")
			.send({ password: "secret123" });

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ ok: true });
	});

	it("400 — rejects password shorter than 8 characters", async () => {
		const res = await request(app)
			.post("/api/auth/set-password")
			.send({ password: "short" });

		expect(res.status).toBe(400);
		expect(res.body.error).toMatch(/at least 8 characters/i);
		expect(pool.query).not.toHaveBeenCalled();
	});

	it("409 — 'Password already set' when password_hash is not null", async () => {
		(pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			rows: [{ password_hash: "$2a$10$existing_hash" }],
		});

		const res = await request(app)
			.post("/api/auth/set-password")
			.send({ password: "secret123" });

		expect(res.status).toBe(409);
		expect(res.body.error).toMatch(/password already set/i);
	});
});
