import express, { type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../db/kysely.js", () => ({ db: {} }));
vi.mock("./login-limiter.js", () => ({
	accountLockoutMiddleware: ((_req, _res, next: () => void) => {
		next();
	}) as RequestHandler,
	clearLoginFailures: vi.fn(),
}));

import { createAuthRouter } from "./router.js";

const USERNAME_MESSAGE =
	"Username must be 3-32 characters: letters, numbers, underscore.";
const PASSWORD_MESSAGE = "Password must be at least 8 characters.";
const DISPLAY_NAME_LENGTH_MESSAGE = "name must be 50 characters or less";
const DISPLAY_NAME_TYPE_MESSAGE = "name must be a string";
const LOGIN_MESSAGE = "Username and password are required.";

const noopLimiter: RequestHandler = (_req, _res, next) => {
	next();
};

function app() {
	const instance = express();
	instance.use(express.json());
	instance.use("/api/auth", createAuthRouter(noopLimiter));
	return instance;
}

describe("auth router validation preserves legacy 400 bodies", () => {
	it.each([
		["short username", { username: "ab", password: "longenough" }],
		["illegal characters", { username: "a b!", password: "longenough" }],
		["missing username", { password: "longenough" }],
		["non-string username", { username: 12, password: "longenough" }],
		["null username", { username: null, password: "longenough" }],
		[
			"username and password both invalid",
			{ username: "ab", password: "short" },
		],
	])("register rejects %s with the username message", async (_label, body) => {
		const res = await request(app()).post("/api/auth/register").send(body);
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: USERNAME_MESSAGE });
	});

	it("register rejects an undefined body like a missing username", async () => {
		const res = await request(app()).post("/api/auth/register");
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: USERNAME_MESSAGE });
	});

	it.each([
		["short password", { username: "valid_user", password: "short" }],
		["non-string password", { username: "valid_user", password: 12345 }],
		[
			"short password before an invalid displayName",
			{
				username: "valid_user",
				password: "short",
				displayName: "x".repeat(51),
			},
		],
	])("register rejects %s with the password message", async (_label, body) => {
		const res = await request(app()).post("/api/auth/register").send(body);
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: PASSWORD_MESSAGE });
	});

	it("register returns the validator displayName message with no fieldErrors", async () => {
		const tooLong = await request(app())
			.post("/api/auth/register")
			.send({
				username: "valid_user",
				password: "longenough",
				displayName: "x".repeat(51),
			});
		expect(tooLong.status).toBe(400);
		expect(tooLong.body).toEqual({ error: DISPLAY_NAME_LENGTH_MESSAGE });

		const notString = await request(app()).post("/api/auth/register").send({
			username: "valid_user",
			password: "longenough",
			displayName: 12,
		});
		expect(notString.status).toBe(400);
		expect(notString.body).toEqual({ error: DISPLAY_NAME_TYPE_MESSAGE });
	});

	it.each([
		["non-string username", { username: 12, password: "longenough" }],
		["non-string password", { username: "valid_user", password: 12 }],
		["missing password", { username: "valid_user" }],
	])("login rejects %s", async (_label, body) => {
		const res = await request(app()).post("/api/auth/login").send(body);
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: LOGIN_MESSAGE });
	});
});
